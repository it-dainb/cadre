// Dev-only (real git): cadre never moves a branch the user has checked out (H5). A landing waits as refs/cadre/pending/<branch> until the dialog's Land brings it
// into the checkout, or until the branch is checked out nowhere; the user's commits and edits are never dropped. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost, task } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { integrateEpic, releaseDev, autoLand } = await import('../../core/integrate.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
const { cutEpic, pendingRef } = await import('../../core/branches.ts')
const { closeTask } = await import('../../core/close.ts')
const { resolveDeps } = await import('../../core/admission.ts')
const { mirror } = await import('../../core/dispatch.ts')
const { skeleton } = await import('../../core/changelog.ts')
const { defaults: types } = await import('../../task-management/registry.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const ok = (cwd, ...a) => { try { execFileSync('git', ['-C', cwd, ...a], { stdio: 'ignore' }); return true } catch { return false } }
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }
const read = (d, f) => (existsSync(join(d, f)) ? readFileSync(join(d, f), 'utf8') : null)

// main checked out at the root (the user's), dev, an approved plan whose epic branch adds c.txt; a MemoryStore with the plan's one done task
async function world() {
  const d = mkdtempSync(join(tmpdir(), 'cadre-dm-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'u.txt'), 'u\n'); commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.packages = [{ root: '.', setup: ['true'], checks: { test: ['true'] } }]; cfg.jail = 'off'
  const store = new MemoryStore(); await store.init({ types: types(), journal: false }); store.comment = async () => {}
  const h = fakeHost(); Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, taskStore: async () => store, stat: async p => (existsSync(p) ? { kind: 'dir', realPath: p } : undefined),
    readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  await h.secret.update(x => ({ ...x, session: 's1' }))
  // a plan p (epic branch epic/<p>, from `from`) whose one task is done and adds file f
  const plan = async (f, body = `${f}\n`, from = 'dev') => {
    const e = await store.createEpic(`plan ${f}`, 'g'), c = (await store.createDraft({ title: `add ${f}`, type: 'feature', parent: e, description: 'd', meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: f }) } })).id
    await store.approve([e, c]); await store.claim(c, 'x'); await store.close(c, { outcome: 'done' })
    const br = `epic/${e}-x`; sh(d, 'branch', br, from); sh(d, 'checkout', '-q', br); commit(d, f, body, `feat: ${f}`); sh(d, 'checkout', '-q', '-')
    await h.board.update(b => ({ ...b, seq: 1, epic: e, plan: { id: e, slug: 'x', state: 'approved', epicBranch: br }, tasks: [task(c, { state: 'done' })] }))
    return e
  }
  const decisions = async () => ((await h.board.read()).decisions ?? []).map(x => x.id)
  const land = () => ROUTES.land(h, { schemaVersion: 1, cmd: 'land', args: ['dev'], origin: { kind: 'dialog' } })
  return { d, h, cfg, store, plan, decisions, land }
}

test('dev checked out with uncommitted edits: the landing leaves dev, the index and every file as they are; one dialog; the click lands it with the edits kept', async () => {
  const w = await world(), { d } = w, p = await w.plan('c.txt'); sh(d, 'checkout', '-q', 'dev'); writeFileSync(join(d, 'u.txt'), 'mine\n')
  const old = sh(d, 'rev-parse', 'dev'); assert.equal(await integrateEpic(w.h, p), null)
  assert.equal(sh(d, 'rev-parse', 'dev'), old); assert.equal(read(d, 'u.txt'), 'mine\n'); assert.equal(read(d, 'c.txt'), null)
  assert.equal(sh(d, 'status', '--porcelain'), 'M u.txt'); assert.ok(ok(d, 'rev-parse', '--verify', pendingRef('dev'))); assert.deepEqual(await w.decisions(), ['pending:dev'])
  const pend = sh(d, 'rev-parse', pendingRef('dev')); assert.match((await w.land()).text, /landed into your checkout/)
  assert.equal(sh(d, 'rev-parse', 'dev'), pend); assert.equal(read(d, 'c.txt'), 'c.txt\n'); assert.equal(read(d, 'u.txt'), 'mine\n')
  assert.ok(ok(d, 'diff', '--cached', '--quiet')); assert.equal(sh(d, 'diff', 'HEAD', '--name-only'), 'u.txt')   // only the user's edit
  assert.equal(ok(d, 'rev-parse', '--verify', '-q', pendingRef('dev')), false); assert.deepEqual(await w.decisions(), ['release:0.1.0'])   // the release is offered once it is in
})

test('an edit that conflicts with the landing: the click refuses and the dialog says why; nothing moves', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
  writeFileSync(join(d, 'c.txt'), 'my own c\n'); const old = sh(d, 'rev-parse', 'dev')
  assert.match((await w.land()).text, /not landed/); assert.equal(sh(d, 'rev-parse', 'dev'), old); assert.equal(read(d, 'c.txt'), 'my own c\n')
  const ds = (await w.h.board.read()).decisions; assert.deepEqual(ds.map(x => x.id), ['pending:dev']); assert.match(ds[0].lines[0], /uncommitted edits/)
})

test('the user commits on dev before the click: their commit stays on dev, the landing re-integrates onto it', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
  commit(d, 'v.txt', 'v\n', 'docs: mine'); const mine = sh(d, 'rev-parse', 'HEAD')
  assert.match((await w.land()).text, /landed/)
  assert.ok(ok(d, 'merge-base', '--is-ancestor', mine, 'dev')); assert.equal(read(d, 'c.txt'), 'c.txt\n'); assert.equal(read(d, 'v.txt'), 'v\n'); assert.equal(sh(d, 'status', '--porcelain'), '')
})

test('two landings while dev waits: an epic cut meanwhile starts from the pending tip; one click lands both', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
  const pend = sh(d, 'rev-parse', pendingRef('dev')), e2 = await w.store.createEpic('two', 'g')
  await w.h.board.update(b => ({ ...b, epic: e2, plan: { id: e2, slug: 'two', state: 'approved', epicBranch: 'epic/two' } })); assert.equal(await cutEpic(w.h, e2, 'dev'), pend)
  const p2 = await w.plan('d.txt', 'd\n', pend); assert.equal(await integrateEpic(w.h, p2), null)
  assert.notEqual(sh(d, 'rev-parse', pendingRef('dev')), pend); assert.match((await w.land()).text, /landed/)
  assert.equal(read(d, 'c.txt'), 'c.txt\n'); assert.equal(read(d, 'd.txt'), 'd\n')
})

test('a release while dev waits is refused', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
  assert.match(await releaseDev(w.h), /^refused: a landing on dev waits for your checkout/)
})

test('a landing that conflicts while dev waits: the resolve task merges the pending tip, closes with no protected-path refusal and lands', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); const dev0 = sh(d, 'rev-parse', 'dev')
  assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null); const pend = sh(d, 'rev-parse', pendingRef('dev'))
  const p2 = await w.plan('c.txt', 'theirs\n', dev0)   // cut before the first landing, changes the same file
  const r = await integrateEpic(w.h, p2); assert.match(r, /Resolve task (\S+) was added/)
  const id = /Resolve task (\S+) was added/.exec(r)[1], t = await w.store.get(id), wt = t.meta['cadre.worktree']
  assert.equal(t.meta['cadre.resolve'], pend); assert.equal(sh(wt, 'rev-parse', 'MERGE_HEAD'), pend)   // the pending tip, not the stale dev
  writeFileSync(join(wt, 'c.txt'), 'c.txt\ntheirs\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'merge the pending tip'); const C = sh(wt, 'rev-parse', 'HEAD')   // the worker resolves it
  await w.store.claim(id, 'x'); await w.store.setMeta(id, { 'cadre.sourceCommit': C, 'cadre.review': `pass@${C}`, 'cadre.step': 'merge' }, 'x'); await w.store.move(id, 'review', 'x')
  await w.h.board.update(b => ({ ...b, tasks: b.tasks.map(x => (x.id === id ? { ...x, state: 'review', step: 'merge' } : x)) }))
  assert.equal(await closeTask(w.h, await resolveDeps(w.h), id), null)   // CHANGELOG differs from the pending tip only by the other side: not this task's edit
  await w.h.board.update(b => ({ ...b, plan: { ...b.plan, state: 'approved' } })); assert.equal(await integrateEpic(w.h, p2), null)
  assert.match((await w.land()).text, /landed/); assert.equal(read(d, 'c.txt'), 'c.txt\ntheirs\n')
})

test('commit on dev, switch off it, tick: both commits are on dev, the pending ref is gone', async () => {
  const w = await world(), { d } = w; sh(d, 'checkout', '-q', 'dev'); assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
  commit(d, 'v.txt', 'v\n', 'docs: mine'); const mine = sh(d, 'rev-parse', 'HEAD'); sh(d, 'checkout', '-q', 'main')
  await autoLand(w.h)
  assert.ok(ok(d, 'merge-base', '--is-ancestor', mine, 'dev')); assert.equal(sh(d, 'show', 'dev:c.txt'), 'c.txt'); assert.equal(ok(d, 'rev-parse', '--verify', '-q', pendingRef('dev')), false)
})

test('HEAD detached, or dev checked out nowhere (the user works in a second worktree): the landing lands without a click', async () => {
  for (const how of ['detached', 'second worktree']) {
    const w = await world(), { d } = w
    if (how === 'detached') sh(d, 'checkout', '-q', '--detach'); else sh(d, 'worktree', 'add', '-q', '-b', 'mine', `${d}-mine`)
    assert.equal(await integrateEpic(w.h, await w.plan('c.txt')), null)
    assert.equal(sh(d, 'show', 'dev:c.txt'), 'c.txt'); assert.equal(ok(d, 'rev-parse', '--verify', '-q', pendingRef('dev')), false); assert.deepEqual(await w.decisions(), ['release:0.1.0'])
  }
})

test('a dev commit mid-run: the plan takes it and its running workers get it; the user\'s files stay as they are', async () => {
  const w = await world(), { d } = w, e = await w.plan('c.txt'), t = (await w.store.createDraft({ title: 'run', type: 'feature', parent: e, description: 'd' })).id
  await w.store.approve([t]); await w.store.claim(t, 'x'); const wt = `${d}-wt/t1`
  sh(d, 'worktree', 'add', '-q', '-b', 'feat/t1', wt, `epic/${e}-x`); await w.store.setMeta(t, { 'cadre.worktree': wt, 'cadre.branch': 'feat/t1', 'cadre.step': 'worker' }, 'x')
  await w.h.board.update(b => ({ ...b, tasks: [...b.tasks, task(t, { state: 'active', step: 'worker' })] }))
  sh(d, 'checkout', '-q', 'dev'); commit(d, 'v.txt', 'v\n', 'docs: mine'); writeFileSync(join(d, 'u.txt'), 'editing\n'); sh(d, 'checkout', '-q', '-')
  await autoLand(w.h)
  assert.equal(sh(d, 'show', `epic/${e}-x:v.txt`), 'v'); assert.equal(sh(d, 'show', 'feat/t1:v.txt'), 'v'); assert.equal(read(wt, 'v.txt'), 'v\n')
  assert.equal(read(d, 'u.txt'), 'editing\n')
})
