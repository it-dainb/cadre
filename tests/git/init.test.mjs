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

test('a fresh init (the files the guide and bd leave) is clean after the setup commit; dev follows main; .cadre/tmp is excluded', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-init-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  put(d, 'src/a.mjs', 'export const a = 1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'chore: initial commit'); sh(d, 'branch', 'dev', 'main')
  put(d, '.git/info/exclude', '.cadre/store/\n.cadre/store.gate.lock\n.claude/settings.local.json\n')   // phase 1, step 6
  put(d, '.cadre/config.json', '{"branches":{"main":"main","dev":"dev"}}\n'); put(d, 'CHANGELOG.md', '# Changelog\n'); put(d, '.gitignore', BD)
  put(d, '.cadre/store/db', 'x'); put(d, '.cadre/store.gate.lock', ''); put(d, '.claude/settings.local.json', '{}\n'); put(d, '.cadre/tmp/logs/a1-test.log', 'ok\n')
  const h = { run, write: async (p, t) => writeFileSync(p, t), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, git: cell({ busy: false, epoch: 0 }) }
  const sha = await I.commitSetup({ h, root: d, cfg: { branches: { main: 'main', dev: 'dev' }, changelog: { path: 'CHANGELOG.md' } } })
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'rev-parse', 'HEAD'), sha); assert.equal(sh(d, 'rev-parse', 'dev'), sha)
  assert.deepEqual(sh(d, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean), ['chore: set up cadre', '.cadre/config.json', 'CHANGELOG.md']); assert.equal(existsSync(join(d, '.gitignore')), false)   // bd's .gitignore was all bd: gone, never committed
  assert.match(readFileSync(join(d, '.git/info/exclude'), 'utf8'), /^\.cadre\/tmp\/$/m)
  assert.equal(await I.commitSetup({ h, root: d, cfg: { branches: { main: 'main', dev: 'dev' }, changelog: { path: 'CHANGELOG.md' } } }), null)   // nothing left: no second commit
})
test("the user's own .gitignore keeps its lines (tracked or not); only bd's block goes", async () => {
  for (const tracked of [true, false]) {
    const d = mkdtempSync(join(tmpdir(), 'cadre-gi-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
    put(d, 'a.txt', '1\n'); if (tracked) put(d, '.gitignore', 'node_modules/\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev')
    put(d, '.gitignore', `node_modules/\n${BD}`); put(d, '.cadre/config.json', '{}\n'); put(d, 'CHANGELOG.md', '# Changelog\n')
    const h = { run, write: async (p, t) => writeFileSync(p, t), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, git: cell({ busy: false, epoch: 0 }) }
    await I.commitSetup({ h, root: d, cfg: { branches: { main: 'main', dev: 'dev' }, changelog: { path: 'CHANGELOG.md' } } })
    assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'node_modules/\n'); assert.equal(sh(d, 'status', '--porcelain'), tracked ? '' : '?? .gitignore')   // an untracked user file is theirs to commit
  }
})
