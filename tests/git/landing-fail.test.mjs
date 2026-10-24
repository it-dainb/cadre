// Dev-only (real git): a re-integration that fails on the machine (here `git worktree add`) backs off instead of retrying every 5 s tick: one trial per backoff
// step (5 s doubling), exactly one dialog naming the error on the third repeat, a Land click tries now, a moved key starts over, a landing clears the record.
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
const { integrateEpic, autoLand } = await import('../../core/integrate.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
const { pendingRef } = await import('../../core/branches.ts')
const { skeleton } = await import('../../core/changelog.ts')
const { scoped } = await import('../../commands/init.ts')
const { defaults: types } = await import('../../task-management/registry.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

test('worktree add keeps failing: one trial per backoff step, one dialog naming the error, a click retries, a moved key starts over, a landing clears it', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-lf-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'u.txt'), 'u\n'); commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.units = [{ root: '.', setup: ['true'], checks: { test: ['true'] } }]; cfg.jail = 'off'
  const store = new MemoryStore(); await store.init({ types: types(), journal: false })
  let T = 0, fail = false, adds = 0
  const h = fakeHost(); Object.assign(h, { cwd: async () => d, home: async () => d, config: async () => cfg, taskStore: async () => store, now: async () => T,
    run: (argv, o) => fail && argv.includes('worktree') && argv.includes('add') ? (adds++, Promise.resolve({ exitCode: 128, stdout: '', stderr: `fatal: could not create directory '${argv.at(-2)}': No space left on device` })) : run(argv, o),
    stat: async p => (existsSync(p) ? { kind: 'dir', realPath: p } : undefined), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  await h.secret.update(x => ({ ...x, session: 's1' }))
  const e = await store.createEpic('plan c', 'g'), c = (await store.createDraft({ title: 'add c', type: 'feature', parent: e, description: 'd', meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'c' }) } })).id
  await store.approve([e, c]); await store.claim(c, 'x'); await store.close(c, { outcome: 'done' })
  sh(d, 'branch', 'epic/x', 'dev'); sh(d, 'checkout', '-q', 'epic/x'); commit(d, 'c.txt', 'c\n', 'feat: c'); sh(d, 'checkout', '-q', 'dev')
  await h.board.update(b => ({ ...b, seq: 1, epic: e, plan: { id: e, slug: 'x', state: 'approved', epicBranch: 'epic/x' }, tasks: [task(c, { state: 'done' })] }))
  assert.equal(await integrateEpic(h, e), null); assert.ok(sh(d, 'rev-parse', pendingRef('dev')))   // dev is checked out: the landing waits
  fail = true; commit(d, "v.txt", "v\n", "docs: mine")   // the user's commit: the landing must re-integrate onto it (worktree add)
  const W = await scoped(h, 'landwait:dev'), dialogs = async () => (await h.board.read()).decisions ?? []
  const tick = async s => { T = s * 1000; await autoLand(h) }

  for (let s = 0; s < 60; s++) await tick(s)
  assert.equal(adds, 4)   // at 0, 5, 15 and 35 s (5 s doubling), not 60 times
  assert.equal((await h.store.get(W)).n, 4)
  const ds = await dialogs(); assert.deepEqual(ds.map(x => x.id), ['pending:dev']); assert.match(ds[0].lines[0], /could not land dev.*No space left on device/)
  assert.doesNotMatch(ds[0].lines[0], /land-dev-/)   // the random tmp path is not part of the error that is compared and shown

  await assert.rejects(ROUTES.land(h, { schemaVersion: 1, cmd: 'land', args: ['dev'], origin: { kind: 'dialog' } }), /git worktree failed/); assert.equal(adds, 5)   // a click tries now
  commit(d, 'w.txt', 'w\n', 'docs: mine again'); await tick(61); assert.equal(adds, 6); assert.equal((await h.store.get(W)).n, 1)   // the key moved: tried at once, counted from 1
  await tick(62); assert.equal(adds, 6)

  fail = false; await tick(66)   // its next step: it lands (the branch is still checked out, so it waits for the click), then the click lands it
  assert.match((await ROUTES.land(h, { schemaVersion: 1, cmd: 'land', args: ['dev'], origin: { kind: 'dialog' } })).text, /landed/)
  assert.equal(await h.store.get(W), undefined); assert.equal(readFileSync(join(d, 'c.txt'), 'utf8'), 'c\n')
})
