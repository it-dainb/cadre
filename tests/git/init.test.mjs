// Dev-only (ADR 0003, 0014): after the safety confirm cadre commits the setup files; a fresh init then leaves `git status --porcelain` clean. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const I = await import('../../commands/init.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })
const BD = '\n# Beads / Dolt files (added by bd init)\n.dolt/\n*.db\n.beads-credential-key\n.beads/proxieddb/\n*.gate.lock*\n'   // real bd 1.3.1 output (fresh repo)
const put = (d, p, t) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), t) }

const hostOf = (d, gi) => ({ run, store: (m => ({ get: async k => m[k], set: async (k, v) => { m[k] = v } }))({}), cwd: async () => d, write: async (p, t) => writeFileSync(p, t), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, git: cell({ busy: false, epoch: 0 }), secret: cell({ run: { kind: 'init', gi } }) })
const CFG = { branches: { main: 'main', dev: 'dev' }, changelog: { path: 'CHANGELOG.md' } }
const repo = (tracked) => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-init-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  put(d, 'src/a.mjs', 'export const a = 1\n'); for (const [p, t] of Object.entries(tracked)) put(d, p, t); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'chore: initial commit'); sh(d, 'branch', 'dev', 'main')
  put(d, '.git/info/exclude', '.cadre/store/\n.cadre/store.gate.lock\n.claude/settings.local.json\n')   // phase 1, step 6
  put(d, '.cadre/config.json', '{"branches":{"main":"main","dev":"dev"}}\n'); put(d, 'CHANGELOG.md', '# Changelog\n')
  put(d, '.cadre/store/db', 'x'); put(d, '.cadre/store.gate.lock', ''); put(d, '.claude/settings.local.json', '{}\n'); put(d, '.cadre/tmp/logs/a1-test.log', 'ok\n')
  return d
}

test('a fresh init (no .gitignore before; bd made one) is clean after the confirm: .gitignore gone, setup committed, dev follows main, .cadre/tmp excluded', async () => {
  const d = repo({}), h = hostOf(d, { had: false, text: '' }); put(d, '.gitignore', BD)   // bd init during the run
  await I.restoreIgnore(h); const sha = await I.commitSetup({ h, root: d, cfg: CFG })
  assert.equal(existsSync(join(d, '.gitignore')), false); assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'rev-parse', 'HEAD'), sha); assert.equal(sh(d, 'rev-parse', 'dev'), sha)
  assert.deepEqual(sh(d, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean), ['chore: set up cadre', '.cadre/config.json', 'CHANGELOG.md'])
  assert.match(readFileSync(join(d, '.git/info/exclude'), 'utf8'), /^\.cadre\/tmp\/$/m)
  assert.equal(await I.commitSetup({ h, root: d, cfg: CFG }), null)   // nothing left: no second commit
})
test("the user's .gitignore comes back byte-exact: their own lines, and a tracked one that already held the bd block", async () => {
  for (const before of ['node_modules/\n', `node_modules/\n${BD}`, 'no newline at end']) {
    const d = repo({ '.gitignore': before }), h = hostOf(d, { had: true, text: before }); put(d, '.gitignore', `${before}${BD}`)   // bd appended again
    await I.restoreIgnore(h); await I.commitSetup({ h, root: d, cfg: CFG })
    assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), before); assert.equal(sh(d, 'status', '--porcelain'), '')
  }
  const d = repo({}), h = hostOf(d, undefined); put(d, '.gitignore', 'mine\n'); await I.restoreIgnore(h)   // no snapshot (cadre did not start the store): never touched
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'mine\n')
})
test('edited during the run (more than bd\'s block): left alone, flagged for review in Doctor', async () => {
  const d = repo({ '.gitignore': 'node_modules/\n' }), h = hostOf(d, { had: true, text: 'node_modules/\n' }), now = `node_modules/\ndist/\n${BD}`
  put(d, '.gitignore', now); await I.restoreIgnore(h)
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), now); assert.equal(await h.store.get(await I.scoped(h, 'gitignore.review')), true)
  const n = repo({}), g = hostOf(n, { had: false, text: '' }); put(n, '.gitignore', `build/\n${BD}`); await I.restoreIgnore(g)   // no file before, but not bd alone
  assert.equal(readFileSync(join(n, '.gitignore'), 'utf8'), `build/\n${BD}`)
})
