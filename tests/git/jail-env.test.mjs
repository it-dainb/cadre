// Dev-only: a check or setup command in the real jail sees PATH, HOME, LANG, TMPDIR and its own names, never the session's credentials, and no host process environment
// (F4; --clearenv, --unshare-pid, --as-pid-1). node --experimental-transform-types --test tests/git/jail-env.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as G from '../../core/git.ts'

// a temp HOME (under /var/tmp: the jail binds its scratch over /tmp) with files a check must not read (never the real home); the worktree lives under it, as cadre's do (~/.cache/cadre/...)
const HOME = mkdtempSync('/var/tmp/cadre-home-'); process.env.HOME = HOME
mkdirSync(join(HOME, '.claude'), { recursive: true }); writeFileSync(join(HOME, '.claude/.credentials.json'), '{"token":"home-secret-3"}'); mkdirSync(join(HOME, '.ssh')); writeFileSync(join(HOME, '.ssh/id'), 'home-secret-4')
mkdirSync(join(HOME, '.tool/bin'), { recursive: true }); writeFileSync(join(HOME, '.tool/bin/hello'), '#!/bin/sh\necho toolchain-ok\n'); chmodSync(join(HOME, '.tool/bin/hello'), 0o755)
process.env.PATH = `${join(HOME, '.tool/bin')}:${process.env.PATH}`
process.env.REDMINE_API_KEY = 'secret-token-1'; process.env.GH_TOKEN = 'secret-token-2'
const run = (argv, init = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: init.env ? { ...process.env, ...init.env } : process.env, timeout: init.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const SPY = 'env; for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null | tr "\\0" "\\n"; done'
const dirs = () => { const d = mkdtempSync(join(HOME, 'run-')), wt = join(d, 'wt'), scratch = join(d, 's'); mkdirSync(wt); mkdirSync(scratch); return { wt, scratch, pkgRoot: wt } }

test('an offline check never sees a credential of the session, in its environment or in /proc', async () => {
  const mode = await G.jailMode(run); assert.notEqual(mode, 'none', 'bwrap is a requirement of this test')
  const r = await G.checkRun(run, mode, { ...dirs(), argv: ['sh', '-c', SPY], env: { CADRE_JUNIT: '/tmp/cadre/junit-test.xml' } })
  assert.equal(r.exitCode, 0, r.stderr); assert.ok(!r.stdout.includes('secret-token'), 'a credential reached the jail')
  assert.match(r.stdout, /^PATH=/m); assert.match(r.stdout, /^TMPDIR=\/tmp$/m); assert.match(r.stdout, /^CADRE_JUNIT=\/tmp\/cadre\/junit-test\.xml$/m); assert.match(r.stdout, /^HOME=/m)
})
test('the writable setup jail clears the environment the same way and keeps HOME for a package manager', async () => {
  const j = { ...dirs(), argv: ['sh', '-c', SPY], env: await G.jailEnv(run) }
  const r = await run(G.writableJail(j)); assert.equal(r.exitCode, 0, r.stderr)
  assert.ok(!r.stdout.includes('secret-token')); assert.equal(r.stdout.split('\n').find(l => l.startsWith('HOME=')), `HOME=${process.env.HOME}`)
})

test('N1: an offline check cannot read the home (credentials, keys); its worktree, the JUnit path and a toolchain folder on PATH still work', async () => {
  const mode = await G.jailMode(run), d = dirs(); writeFileSync(join(d.wt, 'mine.txt'), 'worktree-file')
  const r = await G.checkRun(run, mode, { ...d, argv: ['sh', '-c', 'cat "$HOME/.claude/.credentials.json"; cat "$HOME/.ssh/id"; ls -A "$HOME/.claude" "$HOME/.ssh"; echo ---; cat mine.txt; hello; echo j > "$CADRE_JUNIT"'], env: { CADRE_JUNIT: '/tmp/cadre/junit-test.xml', ...await G.jailEnv(run) } })
  assert.ok(!r.stdout.includes('home-secret') && !r.stderr.includes('home-secret'), 'the home was readable'); assert.match(r.stderr, /credentials\.json: No such file/); assert.match(r.stderr, /\.ssh/)
  assert.match(r.stdout, /---\nworktree-filetoolchain-ok/)
})
test('N1: no PATH spelling puts the home back: //, .., a bin right under $HOME or under ~/.claude, $HOME itself', async () => {
  const mode = await G.jailMode(run), d = dirs(), env = await G.jailEnv(run)
  env.PATH = [`${HOME}//bin`, `${HOME}/.local/../.claude`, `${HOME}/.claude/bin`, `${HOME}/.local/bin`, HOME, `${HOME}/`, env.PATH].join(':')
  const r = await G.checkRun(run, mode, { ...d, argv: ['/bin/sh', '-c', 'cat "$HOME/.claude/.credentials.json"; cat "$HOME/.ssh/id"; true'], env: { CADRE_JUNIT: '/tmp/cadre/junit-test.xml', ...env } })
  assert.ok(!r.stdout.includes('home-secret') && !r.stderr.includes('home-secret'), `the home was readable: ${r.stdout}`)
})
test('N1: a real node --test file that writes JUnit to $CADRE_JUNIT still gives per-test results in the jail', async () => {
  const mode = await G.jailMode(run), d = dirs(); mkdirSync(join(d.scratch, 'cadre'), { recursive: true })
  writeFileSync(join(d.wt, 'a.test.mjs'), "import { test } from 'node:test'; import assert from 'node:assert'\ntest('adds', () => assert.equal(1 + 1, 2))\ntest('fails on purpose', () => assert.equal(1, 2))\n")
  const r = await G.checkRun(run, mode, { ...d, argv: ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=/tmp/cadre/junit-test.xml', 'a.test.mjs'], env: { CADRE_JUNIT: '/tmp/cadre/junit-test.xml', ...await G.jailEnv(run) } })
  assert.equal(r.exitCode, 1, r.stderr)   // one test fails: exit 1 is the check's red
  const xml = readFileSync(join(d.scratch, 'cadre/junit-test.xml'), 'utf8'); assert.ok(xml.includes('name="adds"') && xml.includes('name="fails on purpose"') && xml.includes('<failure'), xml.slice(0, 300))
})
test('N1: the network-on setup jail keeps the real home (a package manager\'s caches live there): the accepted exposure', async () => {
  const d = dirs(), r = await run(G.writableJail({ ...d, argv: ['cat', `${HOME}/.ssh/id`], env: await G.jailEnv(run) }))
  assert.equal(r.stdout, 'home-secret-4')
})
