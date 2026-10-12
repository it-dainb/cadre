// Dev-only, REAL bd: BEADS_DIR init + create + list round-trip, no .beads at the repo root, and the legacy move (layout.moveStore).
//   node --experimental-transform-types --import ./tests/dev/register.mjs --test tests/dev/store-dir.mjs
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { BdStore } from '../../task-management/adapters/beads/store.ts'
import { dirOf, moveStore } from '../../task-management/adapters/beads/layout.ts'

const exec = (argv, init = {}) => new Promise((res, rej) => {
  const p = execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: { ...process.env, ...init.env }, timeout: 60000 }, (err, stdout, stderr) => err && typeof err.code !== 'number' ? rej(err) : res({ exitCode: err ? err.code : 0, stdout, stderr }))
  p.stdin.end(init.stdin ?? '')
})
const repo = () => { const d = mkdtempSync(join(tmpdir(), 'cadre-store-')); execFileSync('git', ['init', '-q', d]); return d }
const host = () => ({ run: (argv, o) => exec(argv, o), stat: async p => existsSync(p) ? { kind: 'dir' } : undefined, readText: async p => existsSync(p) ? readFileSync(p, 'utf8') : null, write: async (p, t) => writeFileSync(p, t) })
const types = { feature: {}, task: {} }

test('fresh repo: store in .cadre/store, nothing at the root', async () => {
  const d = repo(), h = host(), dir = await dirOf(h, d); mkdirSync(`${d}/.cadre`)   // bd needs the parent folder (the setup guide's phase 1 has written .cadre/config.json by then)
  assert.equal(dir, `${d}/.cadre/store`)
  const s = new BdStore({ run: h.run, cwd: d, actor: 'cadre/test', dir })
  await s.init({ types, journal: true })
  const id = await s.createEpic('E', 'goal'); assert.ok((await s.list({})).some(t => t.id === id))
  assert.ok(existsSync(`${d}/.cadre/store`)); assert.ok(!existsSync(`${d}/.beads`))
})
test('legacy repo: .beads is used, then moved with its tasks intact', async () => {
  const d = repo(), h = host()
  const old = new BdStore({ run: h.run, cwd: d, actor: 'cadre/test' }); await old.init({ types, journal: true })
  const id = await old.createEpic('E', 'goal'); assert.ok(existsSync(`${d}/.beads`)); assert.equal(await dirOf(h, d), undefined)
  const out = await moveStore(h, d, dir => new BdStore({ run: h.run, cwd: d, actor: 'cadre/test', dir }))
  assert.equal(out, 'task store moved to .cadre/store'); assert.ok(!existsSync(`${d}/.beads`))
  const now = new BdStore({ run: h.run, cwd: d, actor: 'cadre/test', dir: await dirOf(h, d) })
  assert.ok((await now.list({})).some(t => t.id === id))
})
