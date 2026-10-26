// Dev-only: H9 revert against real git. node --experimental-transform-types --test tests/git/revert.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { integrateEpic } = await import('../../core/integrate.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
await import('../../core/revert.ts')
const { skeleton } = await import('../../core/changelog.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

// a repo with an epic (adds c.txt), landed on dev through integrate; the epic is a store record with the task under it
async function world() {
  const d = mkdtempSync(join(tmpdir(), 'cadre-rev-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.units = [{ root: '.', setup: ['true'], checks: { test: ['true'] } }]; cfg.jail = 'off'
  const h = fakeHost(); Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  const store = await h.taskStore(), epic = await store.createEpic('auth', 'goal'), br = `epic/${epic}-auth`
  sh(d, 'branch', br, 'dev'); sh(d, 'checkout', '-q', br); commit(d, 'c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  const t = await store.createDraft({ title: 'login', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'feat/t1-login' } }); sh(d, 'branch', 'feat/t1-login', 'main'); sh(d, 'branch', 'feat/t9-unrecorded', 'main')
  await h.board.update(b => ({ ...b, epic, plan: { id: epic, slug: 'auth', state: 'approved', epicBranch: br }, tasks: [{ id: t.id, title: 'login', type: 'feature', kind: 'code', merges: true, state: 'done', step: '', phaseSince: 0, deps: [], flags: [] }] }))
  assert.equal(await integrateEpic(h, epic), null)
  const ans = async (id, key) => { const x = ((await h.board.read()).decisions ?? []).find(y => y.id === id); assert.ok(x, `no dialog ${id}`); const [cmd, ...args] = x.options.find(o => o.key === key).run.split(' '); return ROUTES[cmd](h, { schemaVersion: 1, cmd, args, origin: { kind: 'dialog' } }) }
  return { d, h, store, epic, t, ans, press: id => ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [id], origin: { kind: 'press' } }), cfg }
}
const decisions = async h => ((await h.board.read()).decisions ?? []).map(x => x.id).filter(i => i.startsWith('revert'))

test('a revert lands through integrate: new merge on dev, files gone, recorded branches removed, an unrecorded one kept, nothing left behind', async () => {
  const { d, h, store, epic, ans, press } = await world(), before = sh(d, 'rev-parse', 'dev')
  assert.equal(sh(d, 'show', 'dev:c.txt'), 'c')
  await press(epic); await ans(`revert:${epic}`, 'c')
  assert.equal(sh(d, 'rev-parse', 'dev'), before, 'one confirm moves nothing'); assert.deepEqual(await decisions(h), [`revert-sure:${epic}`])
  const out = await ans(`revert-sure:${epic}`, 'y'); assert.match(out.text, /reverted/)
  const dev = sh(d, 'rev-parse', 'dev'); assert.notEqual(dev, before)
  assert.equal(sh(d, 'rev-list', '--parents', '-n1', dev).split(' ').length, 3, 'a --no-ff merge of the revert branch (mergeEpic + landDev)'); assert.match(sh(d, 'log', '-1', '--format=%s', dev), /^revert /)
  assert.equal(existsSync(join(d, 'c.txt')), false); assert.throws(() => sh(d, 'show', 'dev:c.txt'))
  assert.match(sh(d, 'show', 'dev:CHANGELOG.md'), /### Removed\n\n- Reverted: auth/)
  assert.equal(sh(d, 'branch', '--list', `revert/${epic}`), ''); assert.equal(sh(d, 'branch', '--list', 'feat/t1-login'), '', 'recorded branch removed'); assert.match(sh(d, 'branch', '--list', 'feat/t9-unrecorded'), /t9-unrecorded/)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.deepEqual(await decisions(h), [])
  const e = await store.get(epic); assert.ok(e.meta['cadre.reverted']); assert.match((await press(e.meta['cadre.reverted'])).text, /revert-of-revert/)
})
test('dev checked out by the user: the revert waits as the pending landing (move), dev itself is not touched', async () => {
  const { d, h, epic, ans, press } = await world(); sh(d, 'checkout', '-q', 'dev'); const before = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'c'); await ans(`revert-sure:${epic}`, 'y')
  assert.equal(sh(d, 'rev-parse', 'dev'), before); assert.notEqual(sh(d, 'rev-parse', 'refs/cadre/pending/dev'), before); assert.ok(((await h.board.read()).decisions ?? []).some(x => x.id === 'pending:dev'))
  assert.equal(existsSync(join(d, 'c.txt')), true, 'the user\'s checkout is untouched until Land')
})
test('a conflicting revert blocks with one dialog, a clean tree and no leftovers', async () => {
  const { d, h, epic, ans, press } = await world(); sh(d, 'checkout', '-q', 'dev'); commit(d, 'c.txt', 'c changed later\n', 'feat: more'); sh(d, 'checkout', '-q', 'main'); const before = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'c'); const out = await ans(`revert-sure:${epic}`, 'y'); assert.match(out.text, /refused: .*conflicts/)
  assert.deepEqual(await decisions(h), [`revert-fail:${epic}`]); assert.equal(sh(d, 'rev-parse', 'dev'), before)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.equal(sh(d, 'branch', '--list', `revert/${epic}`), '')
  assert.equal(existsSync(join(d, '.git', 'REVERT_HEAD')), false)
  await ans(`revert-fail:${epic}`, 'k'); assert.deepEqual(await decisions(h), [])
})
