// Dev-only (ADR 0003, 0014): after the safety confirm cadre commits the setup files; a fresh init then leaves `git status --porcelain` clean. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const I = await import('../../commands/init.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })
const put = (d, p, t) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), t) }

const hostOf = d => ({ run, store: (m => ({ get: async k => m[k], set: async (k, v) => { m[k] = v } }))({}), cwd: async () => d, write: async (p, t) => writeFileSync(p, t), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, git: cell({ busy: false, epoch: 0 }), secret: cell({ run: { kind: 'init' } }) })
const CFG = { branches: { main: 'main', dev: 'dev' }, changelog: { path: 'CHANGELOG.md' } }
const repo = (tracked) => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-init-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  put(d, 'src/a.mjs', 'export const a = 1\n'); for (const [p, t] of Object.entries(tracked)) put(d, p, t); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'chore: initial commit'); sh(d, 'branch', 'dev', 'main')
  put(d, '.git/info/exclude', '.cadre/state/\n.claude/settings.local.json\n')   // phase 1, step 6
  put(d, '.cadre/config.json', '{"branches":{"main":"main","dev":"dev"}}\n'); put(d, 'CHANGELOG.md', '# Changelog\n')
  put(d, '.cadre/state/j/1', 'x'); put(d, '.claude/settings.local.json', '{}\n'); put(d, '.cadre/tmp/logs/a1-test.log', 'ok\n')
  return d
}

test('a fresh init is clean after the confirm: setup committed, dev follows main, .cadre/state and .cadre/tmp excluded', async () => {
  const d = repo({}), h = hostOf(d); const sha = await I.commitSetup({ h, root: d, cfg: CFG })
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'rev-parse', 'HEAD'), sha); assert.equal(sh(d, 'rev-parse', 'dev'), sha)
  assert.deepEqual(sh(d, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean), ['chore: set up cadre', '.cadre/config.json', 'CHANGELOG.md'])
  assert.match(readFileSync(join(d, '.git/info/exclude'), 'utf8'), /^\.cadre\/tmp\/$/m)
  assert.equal(await I.commitSetup({ h, root: d, cfg: CFG }), null)   // nothing left: no second commit
})
