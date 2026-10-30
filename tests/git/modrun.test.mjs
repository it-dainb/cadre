// The one runner of hooks, providers and modules (plan 2.7, B21), against real processes. A host whose `run` merges its env over the process's, as the kit's does (S0 spike 6):
// the allowlist holds only because of the `env -i` prefix. node --experimental-transform-types --test tests/git/modrun.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { modrun } = await import('../../core/modrun.ts')
const dir = mkdtempSync(join(tmpdir(), 'cadre-modrun-'))
process.env.GH_TOKEN = 'tok-gh'; process.env.REDMINE_API_KEY = 'tok-redmine'; process.env.POISON = 'merged-in'   // the session's environment
const run = (argv, init = {}) => new Promise((res, rej) => execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: init.env ? { ...process.env, ...init.env } : process.env, timeout: init.timeoutMs, killSignal: 'SIGKILL' },
  (err, stdout, stderr) => (err?.killed ? rej(new Error('timeout')) : res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }))))
const host = () => Object.assign(fakeHost(), { run, home: async () => '/home/someone', write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) },
  readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, stat: async (p, o) => { try { const { realpathSync, statSync } = await import('node:fs'); const s = statSync(p); return { kind: s.isDirectory() ? 'dir' : 'file', realPath: o?.resolve ? realpathSync(p) : undefined } } catch { return undefined } } })
const JS = body => ['node', '-e', body]
const go = (h, name, body, o = {}) => modrun(h, { argv: JS(body), cwd: dir, input: { id: 't1' }, scratch: join(dir, name), ...o })
const DUMP = "require('fs').writeFileSync(process.env.CADRE_RESULT, JSON.stringify({ env: process.env, input: JSON.parse(require('fs').readFileSync(process.env.CADRE_INPUT, 'utf8')) }))"

test('the allowlist: PATH, LANG, HOME, TMPDIR and the two CADRE paths only; nothing of the session leaks in, credentials included', async () => {
  const r = await go(host(), 'env', DUMP)
  assert.equal(r.exit, 0)
  const keys = Object.keys(r.result.env).sort(), allowed = ['CADRE_INPUT', 'CADRE_RESULT', 'HOME', 'LANG', 'PATH', 'TMPDIR']
  assert.ok(keys.every(k => allowed.includes(k)), keys.join(',')); assert.equal(r.result.env.HOME, '/home/someone'); assert.equal(r.result.env.TMPDIR, join(dir, 'env'))
  assert.ok(!('POISON' in r.result.env) && !('GH_TOKEN' in r.result.env) && !('REDMINE_API_KEY' in r.result.env))
  assert.deepEqual(r.result.input, { id: 't1' })   // the input file core wrote
})
test('envPass: a hook that declares GH_TOKEN gets it, one that does not, does not; a credentialEnv name nobody declared never arrives', async () => {
  const h = host(), a = await go(h, 'a', DUMP, { envPass: ['GH_TOKEN'] }), b = await go(h, 'b', DUMP)
  assert.equal(a.result.env.GH_TOKEN, 'tok-gh'); assert.ok(!('GH_TOKEN' in b.result.env)); assert.ok(!('REDMINE_API_KEY' in a.result.env) && !('REDMINE_API_KEY' in b.result.env))
})
test('the result file: over 1 MB, a link and a non-JSON file are refused; no file is no result', async () => {
  const h = host(), big = await go(h, 'big', "require('fs').writeFileSync(process.env.CADRE_RESULT, JSON.stringify({ note: 'x'.repeat(1.2e6) }))")
  assert.match(big.bad, /over 1 MB/); assert.equal(big.result, undefined)
  const link = await go(h, 'link', "require('fs').symlinkSync('/etc/hostname', process.env.CADRE_RESULT)"); assert.match(link.bad, /not a regular file/)
  const junk = await go(h, 'junk', "require('fs').writeFileSync(process.env.CADRE_RESULT, 'not json')"); assert.match(junk.bad, /not valid JSON/)
  const none = await go(h, 'none', '0'); assert.deepEqual([none.exit, none.timedOut, none.result, none.bad], [0, false, undefined, undefined])
  const bad = await go(h, 'exit', 'process.exit(3)'); assert.equal(bad.exit, 3)
})
test('a hang is killed at the timeout', async () => {
  const pidFile = join(dir, 'pid'), r = await go(host(), 'hang', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000)`, { timeoutMs: 400 })
  assert.equal(r.timedOut, true)
  assert.throws(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0), /ESRCH/)   // gone, not left running
})
