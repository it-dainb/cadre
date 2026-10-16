// Dev-only: workspace units (H7) on real git + MemoryStore: a single repo, a monorepo and microservices. The green gate runs the task's own unit (found by its
// declared paths); a cross-unit task's squash runs one integration check across every unit it touches. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost, task } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { admitWith } = await import('../../core/admission.ts')
const C = await import('../../core/close.ts')
const { integrateEpic } = await import('../../core/integrate.ts')
const { handleWith } = await import('../../tools/index.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const DESIGN = JSON.stringify({ symbols: [{ name: 'f', kind: 'fn', params: [], returns: 'x', status: 'new' }] })

// roots: the units; paths: the task's declared paths. Each unit's verify check appends its root to LOG (cwd = the unit's folder in the worktree)
async function world(roots, paths) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-units-')), LOG = `${d}-log`; execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  for (const r of roots) { mkdirSync(join(d, r), { recursive: true }); writeFileSync(join(d, r, 'a.txt'), 'a\n') }
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev'); writeFileSync(LOG, '')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'
  cfg.units = roots.map(root => ({ root, kind: root === '.' ? 'app' : 'service', verify: ['verify'], checks: { verify: ['sh', '-c', `echo "${root} $(basename "$PWD")" >> ${LOG}`] } }))
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), id = (await store.createDraft({ title: 'task 0', description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.paths': JSON.stringify(paths), 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id
  await store.approve([epic, id])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } } })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: 'p1', slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: [task(id, { title: 'task 0', type: 'refactor' })] }))
  let n = 0; const next = async e => ({ agentId: `ag${++n}`, model: 'm', echo: e })
  const rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  const pass = { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }
  const log = () => readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => l.split(' ')[0])
  // worker (edits every declared path) -> green -> reviewer pass -> close (squash)
  const land = async () => {
    await admitWith(h, dep, { prompt: `work on ${id}` }, next); const wt = (await store.get(id)).meta['cadre.worktree']
    for (const p of paths) { mkdirSync(join(wt, p, '..'), { recursive: true }); writeFileSync(join(wt, p), 'x\n') }
    assert.match(await rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }), /report accepted/); const green = log(); writeFileSync(LOG, '')
    await admitWith(h, dep, { prompt: `work on ${id}` }, next); assert.match(await rep('ag2', pass), /pass@/)
    assert.equal(await C.closeTask(h, dep, id), null); return { green, close: log(), d }
  }
  return { land }
}

test('single repo: the one unit runs the green gate; the squash on an unmoved epic runs nothing more', async () => {
  const r = await (await world(['.'], ['src/x.ts'])).land()
  assert.deepEqual(r.green, ['.']); assert.deepEqual(r.close, []); assert.equal(sh(r.d, 'show', 'epic/p1-x:src/x.ts'), 'x')
})
test('monorepo: a task maps to its unit by its paths (no package named): only that unit gates it', async () => {
  const r = await (await world(['.', 'pkg/a', 'pkg/b'], ['pkg/b/src/y.ts'])).land()
  assert.deepEqual(r.green, ['pkg/b']); assert.deepEqual(r.close, [])
})
test('microservices: a task across two services gets one integration check across both on its squash, each unit once', async () => {
  const r = await (await world(['svc/api', 'svc/web'], ['svc/api/h.go', 'svc/web/v.ts'])).land()
  assert.deepEqual(r.green, ['svc/api']); assert.deepEqual(r.close.sort(), ['svc/api', 'svc/web']); assert.equal(sh(r.d, 'show', 'epic/p1-x:svc/web/v.ts'), 'x')
})

// 5b: a submodule unit (ownGit) lands in its own repository: the task branch, worktree and squash live there; the plan's integration merges its epic branch
// into its dev through its own checks, then the parent's pointer bump lands through the parent's gates
test('submodule: the task works and squashes in the submodule repo; integration lands its dev, then the parent dev carries the pointer bump', async () => {
  const S = mkdtempSync(join(tmpdir(), 'cadre-sub-')), d = mkdtempSync(join(tmpdir(), 'cadre-parent-')), LOG = `${d}-log`
  for (const r of [S, d]) { execFileSync('git', ['init', '-q', '-b', 'main', r]); sh(r, 'config', 'user.name', 't'); sh(r, 'config', 'user.email', 't@t') }
  writeFileSync(join(S, 'core.c'), 'int a;\n'); sh(S, 'add', '-A'); sh(S, 'commit', '-qm', 'init'); sh(S, 'branch', 'dev')
  writeFileSync(join(d, 'README'), 'p\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init')
  execFileSync('git', ['-C', d, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', S, 'lib']); sh(d, 'commit', '-qm', 'add lib'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const L = join(d, 'lib'); sh(L, 'config', 'user.name', 't'); sh(L, 'config', 'user.email', 't@t'); sh(L, 'branch', 'dev', 'origin/dev'); writeFileSync(LOG, '')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'
  cfg.units = [{ root: '.', kind: 'app', checks: { verify: ['sh', '-c', `echo parent >> ${LOG}`] }, verify: ['verify'] }, { root: 'lib', kind: 'submodule', ownGit: true, verify: ['verify'], checks: { verify: ['sh', '-c', `test -f core.c && echo lib >> ${LOG}`] } }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), id = (await store.createDraft({ title: 'task 0', description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.paths': '["lib/x.c"]', 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id
  await store.approve([epic, id])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } } })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: epic, slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: [task(id, { title: 'task 0', type: 'refactor' })] }))
  let n = 0; const next = async e => ({ agentId: `ag${++n}`, model: 'm', echo: e })
  const rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  await admitWith(h, dep, { prompt: `work on ${id}` }, next); const wt = (await store.get(id)).meta['cadre.worktree']
  assert.equal(execFileSync('git', ['-C', wt, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(), execFileSync('git', ['-C', L, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim())   // the submodule's repository
  writeFileSync(join(wt, 'x.c'), 'int x;\n'); assert.match(await rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }), /report accepted/)
  assert.deepEqual(readFileSync(LOG, 'utf8').split('\n').filter(Boolean), ['lib']); writeFileSync(LOG, '')   // the green gate ran the submodule's checks, at its root
  await admitWith(h, dep, { prompt: `work on ${id}` }, next); assert.match(await rep('ag2', { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }), /pass@/)
  const pdev = sh(d, 'rev-parse', 'dev'); assert.equal(await C.closeTask(h, dep, id), null)
  assert.equal(sh(L, 'show', 'epic/p1-x:x.c'), 'int x;'); assert.equal(sh(d, 'rev-parse', 'epic/p1-x'), pdev)   // squashed in the submodule; the parent's epic untouched
  assert.equal(await integrateEpic(h, epic), null)
  const ldev = sh(L, 'rev-parse', 'dev'); assert.equal(sh(L, 'show', 'dev:x.c'), 'int x;')   // the submodule's dev got the plan, through its checks
  assert.equal(sh(d, 'ls-tree', 'dev', 'lib').split(/\s+/)[2], ldev); assert.match(sh(d, 'log', '-1', '--format=%s', 'dev'), new RegExp(`chore: lib to ${ldev.slice(0, 7)}`))   // the parent's pointer bump on its dev
  assert.deepEqual(readFileSync(LOG, 'utf8').split('\n').filter(Boolean), ['lib'])   // the parent's gates: the bump touched only the submodule's own path
})

// the parent's checks build against its submodule: task, integration and baseline worktrees check it out at the commit the parent records, from the local copy;
// a recorded commit this machine lacks refuses with one dialog naming it
test('submodule checkout: a parent check that reads the submodule passes in the task and integration worktrees; a missing pinned commit refuses', async () => {
  const S = mkdtempSync(join(tmpdir(), 'cadre-sub-')), d = mkdtempSync(join(tmpdir(), 'cadre-parent-'))
  for (const r of [S, d]) { execFileSync('git', ['init', '-q', '-b', 'main', r]); sh(r, 'config', 'user.name', 't'); sh(r, 'config', 'user.email', 't@t') }
  writeFileSync(join(S, 'core.c'), 'int a;\n'); sh(S, 'add', '-A'); sh(S, 'commit', '-qm', 'init')
  execFileSync('git', ['-C', d, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', S, 'lib']); writeFileSync(join(d, 'README'), 'p\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'
  cfg.units = [{ root: '.', kind: 'app', verify: ['verify'], checks: { verify: ['test', '-f', 'lib/core.c'] } }, { root: 'lib', kind: 'submodule', ownGit: true, checks: { verify: ['true'] } }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), id = (await store.createDraft({ title: 'task 0', description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.paths': '["README"]', 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id
  await store.approve([epic, id])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } } })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: epic, slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: [task(id, { title: 'task 0', type: 'refactor' })] }))
  let n = 0; const next = async e => ({ agentId: `ag${++n}`, model: 'm', echo: e }), rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  await admitWith(h, dep, { prompt: `work on ${id}` }, next); const wt = (await store.get(id)).meta['cadre.worktree']
  assert.equal(readFileSync(join(wt, 'lib/core.c'), 'utf8'), 'int a;\n')   // the task worktree has the submodule at the recorded commit
  writeFileSync(join(wt, 'README'), 'p2\n'); assert.match(await rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }), /report accepted/)   // green: lib/core.c is there
  await admitWith(h, dep, { prompt: `work on ${id}` }, next); assert.match(await rep('ag2', { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }), /pass@/)
  assert.equal(await C.closeTask(h, dep, id), null)
  assert.equal(await integrateEpic(h, epic), null); assert.equal(sh(d, 'show', 'dev:README'), 'p2')   // the integration worktree's parent check passed too
  // a pinned commit that only another clone has: integration refuses, naming it, and nothing lands
  const o = mkdtempSync(join(tmpdir(), 'cadre-other-')); execFileSync('git', ['clone', '-q', S, o]); writeFileSync(join(o, 'b.c'), 'int b;\n'); sh(o, 'add', '-A'); sh(o, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'b')
  const lost = sh(o, 'rev-parse', 'HEAD'); sh(d, 'branch', 'epic/p2-y', 'dev'); sh(d, 'checkout', '-q', 'epic/p2-y'); sh(d, 'update-index', '--cacheinfo', `160000,${lost},lib`); sh(d, 'commit', '-qm', 'pin lib'); sh(d, 'checkout', '-q', '-f', 'main')
  await h.board.update(s => ({ ...s, plan: { id: 'p2', slug: 'y', state: 'approved', epicBranch: 'epic/p2-y' }, epic: 'p2', tasks: [] }))
  const old = sh(d, 'rev-parse', 'dev'), why = await integrateEpic(h, 'p2')
  assert.match(why, new RegExp(`lib: the commit the repository records for it \\(${lost.slice(0, 7)}\\) is not in lib; fetch it there`)); assert.equal(sh(d, 'rev-parse', 'dev'), old)
  assert.deepEqual((await h.board.read()).plan.flags, ['integration-failed'])
})
