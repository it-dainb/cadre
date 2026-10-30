// Dev-only: a check or setup command in the real jail sees PATH, HOME, LANG, TMPDIR and its own names, never the session's credentials, and no host process environment
// (F4; --clearenv, --unshare-pid, --as-pid-1). node --experimental-transform-types --test tests/git/jail-env.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as G from '../../core/git.ts'

process.env.REDMINE_API_KEY = 'secret-token-1'; process.env.GH_TOKEN = 'secret-token-2'
const run = (argv, init = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: init.env ? { ...process.env, ...init.env } : process.env, timeout: init.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const SPY = 'env; for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null | tr "\\0" "\\n"; done'
const dirs = () => { const d = mkdtempSync(join(tmpdir(), 'cadre-jenv-')), wt = join(d, 'wt'), scratch = join(d, 's'); mkdirSync(wt); mkdirSync(scratch); return { wt, scratch, pkgRoot: wt } }

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
