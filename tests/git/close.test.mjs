// Dev-only: report -> review -> verdict -> close (squash) on real git + MemoryStore. node --experimental-transform-types --test tests/git/*.test.mjs
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
const { handleWith } = await import('../../tools/index.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
const { setPolicy } = await import('../../policy/guards.ts')
const { nextAction } = await import('../../core/render.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const DESIGN = JSON.stringify({ symbols: [{ name: 'f', kind: 'fn', params: [], returns: 'x', status: 'new' }] })

async function world(n = 1) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-close-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'a.txt'), 'a\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'; cfg.packages = [{ root: '.', verify: ['verify'], checks: { verify: ['true'], test: ['sh', '-c', 'echo ran; exit 3'] } }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), ids = []
  for (let i = 0; i < n; i++) ids.push((await store.createDraft({ title: `task ${i}`, description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.package': '.', 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id)
  await store.approve([epic, ...ids])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null) })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  const ts = await Promise.all(ids.map(async id => { const t = await store.get(id); return task(id, { title: t.title, type: t.type }) }))
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: 'p1', slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: ts }))
  let n2 = 0; const next = async e => ({ agentId: `ag${++n2}`, model: 'm', echo: e })
  const spawn = id => admitWith(h, dep, { prompt: `work on ${id}` }, next)
  const rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  const pass = { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }
  return { d, h, dep, store, ids, spawn, rep, pass }
}
const edit = (wt, f = 'b.txt', body = 'b\n') => writeFileSync(join(wt, f), body)

test('lifecycle: claim -> report done -> review -> pass@C -> TaskUpdate completed squashes into the epic, cleans up', async () => {
  const w = await world(), id = w.ids[0], { h, store, d } = w
  const a = await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']; assert.equal(a.agentId, 'ag1'); edit(wt)
  const out = await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); assert.match(out, /report accepted: commit \w{7}, 1 files/)
  let t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'reviewer']); assert.match(t.card, /next: the worker has finished \(do not message it\)\. Now start a NEW agent for the reviewer step: Agent tool, prompt "TASK-m-2"/)
  const C0 = (await store.get(id)).meta['cadre.sourceCommit']; assert.equal(sh(wt, 'rev-parse', 'HEAD'), C0); assert.equal((await store.get(id)).category, 'review')
  assert.equal(t.owner, undefined); assert.match(nextAction(await h.board.read()), new RegExp(`spawn TASK-${id} \\(reviewer\\)`))   // no reviewer yet: main is told to spawn one, never "running"
  assert.match(String(await C.closeTask(h, w.dep, id)), /review-passed/)
  await w.spawn(id)   // fresh reviewer (admission)
  assert.ok((await h.board.read()).tasks[0].owner); assert.doesNotMatch(nextAction(await h.board.read()), /reviewer/)
  assert.match(await w.rep('ag2', w.pass), /pass@/)
  t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'merge'])
  const old = sh(d, 'rev-parse', 'epic/p1-x'); assert.equal(await C.closeTask(h, w.dep, id), null)
  const now = sh(d, 'rev-parse', 'epic/p1-x'); assert.notEqual(now, old); assert.equal(sh(d, 'rev-parse', `${now}^`), old)
  const msg = sh(d, 'log', '-1', '--format=%B', now); assert.match(msg, /^refactor: task 0\n/); assert.match(msg, /Refs: m-2/); assert.match(msg, new RegExp(`Cadre-Review: pass@${C0.slice(0, 7)}`))
  assert.equal(sh(d, 'show', 'epic/p1-x:b.txt'), 'b'); assert.equal(existsSync(wt), false); assert.equal(sh(d, 'branch', '--list', 'refactor/*'), '')
  assert.equal((await h.board.read()).tasks[0].state, 'done'); assert.equal((await store.get(id)).category, 'done'); assert.deepEqual(await h.bind.read(), {})
})

test('review: finding file must exist at sourceCommit; inDiff:false allowed; changes needs a blocker/major; coverage + contractStatus complete', async () => {
  const w = await world(), id = w.ids[0]; await w.spawn(id); edit((await w.store.get(id)).meta['cadre.worktree']); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id)
  const fresh = () => w.h.ui.update(u => ({ ...u, retries: {} }))
  assert.match(await w.rep('ag2', { ...w.pass, findings: [{ severity: 'minor', file: 'nope.ts', issue: 'x' }] }), /error: findings\[0\]\.file: nope\.ts does not exist at sourceCommit/)
  await fresh(); assert.match(await w.rep('ag2', { ...w.pass, verdict: 'changes', findings: [{ severity: 'minor', file: 'a.txt', issue: 'x' }] }), /needs at least one blocker or major/)
  await fresh(); assert.match(await w.rep('ag2', { ...w.pass, findings: [{ severity: 'blocker', file: 'a.txt', issue: 'x' }] }), /refused while a blocker/)
  await fresh(); assert.match(await w.rep('ag2', { ...w.pass, coverage: [] }), /missing S1/); assert.match(await w.rep('ag2', { ...w.pass, contractStatus: [] }), /missing f/)
  assert.match(await w.rep('ag2', { ...w.pass, findings: [{ severity: 'minor', file: 'a.txt', issue: 'unchanged file' }] }), /verdict accepted: pass/)   // a.txt is not in the diff: inDiff false
  assert.match((await w.store.get(id)).meta['cadre.rec.review'], /"inDiff":false/)
})

test('retry flagging: 3 failed semantic reports, the 4th is accepted unvalidated + flag report-unvalidated', async () => {
  const w = await world(), id = w.ids[0]; await w.spawn(id); edit((await w.store.get(id)).meta['cadre.worktree']); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id)
  const bad = { ...w.pass, coverage: [] }
  for (let i = 1; i <= 3; i++) assert.match(await w.rep('ag2', bad), new RegExp(`attempt ${i}/3`))
  assert.match(await w.rep('ag2', bad), /verdict accepted/); assert.ok((await w.h.board.read()).tasks[0].flags.includes('report-unvalidated'))
})

test('changes -> the same worker agentId is resumed (queued), rework counted, cap flags non-progress, human ends it with resolve reject', async () => {
  const w = await world(), id = w.ids[0], { h, store } = w; await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']
  edit(wt); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id)
  const ch = { ...w.pass, verdict: 'changes', summary: 'fix it', findings: [{ severity: 'major', file: 'b.txt', line: 1, issue: 'wrong', fix: 'right' }] }
  for (let n = 1; n <= 4; n++) {
    assert.match(await w.rep('ag2', ch), new RegExp(`changes \\(${n}/3\\)`))
    let t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['active', 'worker']); assert.equal(t.flags.some(f => f.startsWith('rework:')), n > 3)
    assert.ok((await h.board.read()).resumesQueued >= 1)   // queued for ag1 (the drain is w3-reuse's)
    edit(wt, 'b.txt', `b${n}\n`); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: `r${n}` })
    t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'reviewer'])
    assert.ok(t.owner); assert.doesNotMatch(nextAction(await h.board.read()), /reviewer/)   // the bound reviewer is resumed: never "spawn the reviewer" (refused: it already has one)
  }
  assert.ok((await h.board.read()).tasks[0].flags.includes('rework:4/3'))
  const r = await ROUTES.resolve(h, { schemaVersion: 1, cmd: 'resolve', args: [id, 'reject'], origin: { kind: 'composer' } }); assert.match(r.text, /reject done/)
  assert.equal((await h.board.read()).tasks[0].state, 'cancelled'); assert.match((await store.get(id)).meta['close.note'], /^failed:/)
  assert.match(sh(w.d, 'for-each-ref', 'refs/cadre/quarantine'), /refs\/cadre\/quarantine\/m-2-/)
})

test('merges refused while a git:* flag is open; protected path edit refused at report; red green gate refuses', async () => {
  const w = await world(), id = w.ids[0], { h, store } = w; await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']
  edit(wt, 'CHANGELOG.md', 'x'); assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }), /protected or locked paths changed: CHANGELOG\.md/)
  execFileSync('rm', [join(wt, 'CHANGELOG.md')]); edit(wt)
  w.dep.cfg.packages[0].checks.verify = ['test', '!', '-f', 'b.txt']; assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }), /green gate failed/)
  w.dep.cfg.packages[0].checks.verify = ['true']; await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id); await w.rep('ag2', w.pass)
  await h.git.update(g => ({ ...g, flags: { 'git:epic/p1-x': {} } })); assert.match(await C.closeTask(h, w.dep, id), /refused while git flag git:epic\/p1-x/)
  assert.equal((await h.board.read()).tasks[0].step, 'merge')
})

test('a locked spec file committed by the red step is not a worker edit; editing it (dirty) still is', async () => {
  const w = await world(), id = w.ids[0], { h, store, d } = w; await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']
  mkdirSync(join(wt, 'test')); writeFileSync(join(wt, 'test/s.test.txt'), 't\n'); sh(wt, 'add', '-A'); sh(wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'spec')
  await store.setMeta(id, { 'cadre.specCommit': sh(wt, 'rev-parse', 'HEAD') }, 'cadre'); await setPolicy(h, { locks: { [id]: [`${wt}/test/s.test.txt`] } })
  edit(wt); assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }), /report accepted/)
  void d
})

test('stop without report: nudge x2 (queued), then auto-report from computed facts; non-answer stop releases, blocked at 3 attempts', async () => {
  const w = await world(), id = w.ids[0], { h, store } = w; await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']; edit(wt)
  const stop = (reason = 'answer') => C.observeWith(h, w.dep, { agentId: 'ag1', reason, answer: 'done I think' }, e => e)
  await stop(); assert.equal((await store.get(id)).meta['cadre.nudge'], 'worker:1'); assert.match((await h.board.read()).tasks[0].card, /next: wait: the worker is finishing its report/); await stop(); assert.equal((await store.get(id)).meta['cadre.nudge'], 'worker:2')
  assert.equal((await h.board.read()).tasks[0].state, 'active'); await stop()
  const t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'reviewer']); assert.ok(t.flags.includes('auto-reported')); assert.match((await store.get(id)).meta['cadre.rec.report'], /auto: true/)
  const w2 = await world(), id2 = w2.ids[0]
  for (let i = 1; i <= 3; i++) {
    await w2.spawn(id2); await C.observeWith(w2.h, w2.dep, { agentId: `ag${i}`, reason: 'error' }, e => e)
    const s = (await w2.h.board.read()).tasks[0]; assert.equal(s.state, i < 3 ? 'todo' : 'blocked'); assert.equal((await w2.store.get(id2)).meta['cadre.attempts'], String(i))
  }
})

test('run_check: named check in the caller tree, header + body; task scope enforced; inspect: rev verified, scope enforced', async () => {
  const w = await world(), id = w.ids[0]; await w.spawn(id)
  const call = (tool, input, agentId = 'ag1') => handleWith(w.h, w.dep, { tool: `mcp__cadre__${tool}`, agentId, input }).then(r => r.result)
  assert.match(await call('run_check', { name: 'test', task: id }), /^exit=3 · \d+s · truncated=no\nran\n/); assert.match(await call('run_check', { name: 'nope', task: id }), /error: no check "nope"/)
  assert.match(await call('run_check', { name: 'test', task: 'other' }), /bound to m-2/)
  assert.match(await call('inspect', { what: 'status' }), /^exit=0/); assert.match(await call('inspect', { what: 'log', rev: '--output=x' }), /error: rev/); assert.match(await call('inspect', { what: 'show', path: '../x', rev: 'HEAD' }), /error: path/)
  assert.match(await handleWith(w.h, w.dep, { tool: 'mcp__cadre__inspect', input: { what: 'diff' } }).then(r => r.result), /main may inspect/)
})

test('followups become drafts in the lazily created cadre-backlog epic with a discovered-from dep; plan flags clear with resolve keep', async () => {
  const w = await world(), id = w.ids[0]; await w.spawn(id); edit((await w.store.get(id)).meta['cadre.worktree'])
  await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's', followups: [{ title: 'tidy x', description: 'later' }, { title: 'tidy y', description: 'later' }] })
  const all = await w.store.list({}), bl = all.find(t => t.title === 'cadre-backlog'); assert.ok(bl)
  const ds = all.filter(t => t.parent === bl.id); assert.deepEqual(ds.map(t => [t.title, t.category]), [['tidy x', 'draft'], ['tidy y', 'draft']])
  assert.deepEqual(ds[0].deps, [{ id, type: 'discovered-from' }])
  await w.h.board.update(b => ({ ...b, plan: { ...b.plan, flags: ['integration-failed'] } }))
  assert.match((await ROUTES.resolve(w.h, { schemaVersion: 1, cmd: 'resolve', args: ['p1', 'keep'], origin: { kind: 'composer' } })).text, /plan flags cleared/); assert.deepEqual((await w.h.board.read()).plan.flags, [])
})

// a reviewed task whose epic then moved (another task landed): returns the pieces to close it
async function movedEpic(file, body) {
  const w = await world(), id = w.ids[0]; await w.spawn(id); const wt = (await w.store.get(id)).meta['cadre.worktree']; edit(wt)
  await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id); await w.rep('ag2', w.pass)
  const e = `${w.d}-e`; sh(w.d, 'worktree', 'add', '-q', e, 'epic/p1-x'); writeFileSync(join(e, file), body); sh(e, 'add', '-A'); sh(e, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'other'); sh(w.d, 'worktree', 'remove', '--force', e)
  return { ...w, id, wt, branch: (await w.store.get(id)).meta['cadre.branch'] }
}
const { qk } = await import('../../core/session.ts')
const R = await import('../../core/rebase.ts')
const queued = async (h, id, agent) => (((await h.store.get(await qk(h))) ?? []).find(x => x.taskId === id && (!agent || x.agentId === agent)) ?? {}).text ?? ''
test('close: a moved epic is verified with the package checks; red goes back to the same worker (merged tip, checks named), the epic does not move', async () => {
  const w = await movedEpic('other.txt', 'o\n'), old = sh(w.d, 'rev-parse', 'epic/p1-x')
  Object.assign(w.dep.cfg.packages[0], { verify: undefined, checks: { test: ['false'] } })
  assert.match(String(await C.closeTask(w.h, w.dep, w.id)), /checks fail on the new tip\). Its worker updates it \(round 1\/2\)/); assert.equal(sh(w.d, 'rev-parse', 'epic/p1-x'), old)
  const t = (await w.h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['active', 'worker'])
  assert.equal(sh(w.wt, 'merge-base', '--is-ancestor', old, 'HEAD'), ''); assert.equal(readFileSync(join(w.wt, 'other.txt'), 'utf8'), 'o\n'); assert.equal((await w.store.get(w.id)).meta['cadre.base'], old)
  assert.match(await queued(w.h, w.id), /Its checks fail on the merged tree:\nverify \(test\) failed/)
})
test('close: a package with no verify check at all fails a moved-epic merge instead of passing it', async () => {
  const w = await movedEpic('other.txt', 'o\n'); Object.assign(w.dep.cfg.packages[0], { verify: undefined, checks: {} })
  assert.match(String(await C.closeTask(w.h, w.dep, w.id)), /checks fail on the new tip/)
})
test('conflict: a trial merge finds it; the SAME worker is resumed on the merged tree with the conflict; re-review; then it lands with both changes; recorded', async () => {
  const w = await movedEpic('b.txt', 'theirs\n'), { h, store, d, id, wt } = w, tip = sh(d, 'rev-parse', 'epic/p1-x')
  assert.match(String(await C.closeTask(h, w.dep, id)), /conflicts in b\.txt\). Its worker updates it \(round 1\/2\); it comes back for review\. Wait for it/)
  assert.equal(sh(d, 'rev-parse', 'epic/p1-x'), tip); assert.match(readFileSync(join(wt, 'b.txt'), 'utf8'), /<<<<<<<[\s\S]*theirs/)   // the conflict is left for the worker, in its tree
  const q = await queued(h, id); assert.match(q, /Resolve the conflicts in: b\.txt/); assert.match(q, /round 1\/2/)
  const m = (await store.get(id)).meta; assert.equal(m['cadre.rebase'], '1'); assert.equal(m['cadre.review'], ''); assert.equal(m['cadre.base'], tip)
  assert.ok((await store.list({})).some(x => x.type === 'decision' && /reworked onto the plan tip/.test(x.description ?? x.title)))
  writeFileSync(join(wt, 'b.txt'), 'b\ntheirs\n'); assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'merged' }), /report accepted/)   // the worker resolves it
  const t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'reviewer'])   // re-review: the code changed
  assert.match(await queued(h, id, 'ag2'), /Re-review/); assert.match(await w.rep('ag2', w.pass), /pass@/)
  assert.equal(await C.closeTask(h, w.dep, id), null); assert.equal(sh(d, 'show', 'epic/p1-x:b.txt'), 'b\ntheirs')
})
test('cap: past 2 rounds the task is blocked and asked with both sides; Retry runs one more round', async () => {
  const w = await movedEpic('b.txt', 'theirs\n'), { h, store, id } = w; await store.setMeta(id, { 'cadre.rebase': '2' }, 'x')
  const { repoKeyOf } = await import('../../commands/init.ts'); await h.store.set(`cadre:${repoKeyOf(w.d)}:actor`, w.dep.actor)   // the dialog's route resolves its own deps: same claim actor
  assert.match(String(await C.closeTask(h, w.dep, id)), /still conflicts on the plan after 2 reworks; it waits for the user\. Go on with the other tasks/)
  const t = (await h.board.read()).tasks[0]; assert.equal(t.state, 'blocked'); assert.ok(t.flags.includes('conflict'))
  const dd = (await h.board.read()).decisions.find(x => x.id === `flag:${id}:conflict`); assert.match(dd.title, /still conflicts after 2 reworks/); assert.match(dd.lines.join('\n'), /b\.txt/); assert.deepEqual(dd.options.map(o => o.label), ['Retry', 'Cancel task'])
  assert.match((await ROUTES.resolve(h, { schemaVersion: 1, cmd: 'resolve', args: [id, 'rebase'], origin: { kind: 'dialog' } })).text, /round 2\/2/)
  assert.deepEqual((({ state, step }) => [state, step])((await h.board.read()).tasks[0]), ['active', 'worker'])
})
test('after a squash, a running sibling gets the new tip merged in (its own edits kept); a colliding one only gets a heads-up', async () => {
  const w = await world(2), { h, store, d } = w, [a, b] = w.ids
  await w.spawn(a); await w.spawn(b); const wa = (await store.get(a)).meta['cadre.worktree'], wb = (await store.get(b)).meta['cadre.worktree']
  edit(wa, 'a2.txt', 'from a\n'); writeFileSync(join(wb, 'mine.txt'), 'wip\n')   // b works, uncommitted
  await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'a' }); await w.spawn(a); await w.rep('ag3', w.pass)
  assert.equal(await C.closeTask(h, w.dep, a), null); const tip = sh(d, 'rev-parse', 'epic/p1-x')
  assert.equal(readFileSync(join(wb, 'a2.txt'), 'utf8'), 'from a\n'); assert.equal(readFileSync(join(wb, 'mine.txt'), 'utf8'), 'wip\n'); assert.equal((await store.get(b)).meta['cadre.base'], tip)
  assert.equal(sh(d, 'merge-base', '--is-ancestor', tip, (await store.get(b)).meta['cadre.branch']), '')
})
test('watch: two running workers changing the same file are told once each (uncommitted edits count)', async () => {
  const w = await world(2), { h, store } = w, [a, b] = w.ids; await w.spawn(a); await w.spawn(b)
  edit((await store.get(a)).meta['cadre.worktree'], 'a.txt', 'A\n'); edit((await store.get(b)).meta['cadre.worktree'], 'a.txt', 'B\n')
  const { drainDelta } = await import('../../core/briefs.ts')
  await R.watch(h, w.dep); assert.match(await drainDelta(h, 'ag1'), /Heads-up: m-3 is changing a\.txt/); assert.match(await drainDelta(h, 'ag2'), /m-2 is changing a\.txt/)
  await R.watch(h, w.dep); assert.equal(await drainDelta(h, 'ag1'), null)
})
test('a resolve task: claimed in the worktree that holds the merge; the worker resolves it; green, review and squash land it on the plan branch, the other side\'s changelog included', async () => {
  const w = await world(0), { h, d, store } = w, epic = (await h.board.read()).epic
  const side = (br, body, cl) => { const e = `${d}-${br.replace('/', '-')}`; sh(d, 'worktree', 'add', '-q', e, br); writeFileSync(join(e, 'a.txt'), body); if (cl) writeFileSync(join(e, 'CHANGELOG.md'), cl); sh(e, 'add', '-A'); sh(e, 'commit', '-qm', `on ${br}`); sh(d, 'worktree', 'remove', '--force', e) }
  side('epic/p1-x', 'ours\n'); side('dev', 'theirs\n', '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- other (x-1)\n')
  const text = await R.resolveTask(h, w.dep, epic, 'epic/p1-x', 'dev', ['a.txt']); assert.match(text, /Resolve task (\S+) was added .* \(attempt 1\/2\)/)
  const id = (await h.board.read()).tasks.find(t => t.type === 'refactor').id, wt = (await store.get(id)).meta['cadre.worktree']
  assert.match(readFileSync(join(wt, 'a.txt'), 'utf8'), /<<<<<<</); const a = await w.spawn(id); assert.equal(a.agentId, 'ag1'); assert.match(readFileSync(join(wt, 'a.txt'), 'utf8'), /<<<<<<</)   // the claim keeps that tree
  writeFileSync(join(wt, 'a.txt'), 'ours\ntheirs\n'); assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'merged both' }), /report accepted/)   // the changelog from dev is not its edit
  await w.spawn(id); assert.match(await w.rep('ag2', { ...w.pass, coverage: [], contractStatus: [] }), /pass@/)
  assert.equal(await C.closeTask(h, w.dep, id), null); assert.equal(sh(d, 'show', 'epic/p1-x:a.txt'), 'ours\ntheirs'); assert.match(sh(d, 'show', 'epic/p1-x:CHANGELOG.md'), /other \(x-1\)/)
  assert.equal(sh(d, 'merge-tree', '--write-tree', '--name-only', 'dev', 'epic/p1-x').split('\n').length, 1)   // the landing merges cleanly now
})

// ADR 0019: the limits are settings; changing each one changes the behaviour above
test('settings: limits.nudges 0 auto-reports at the first stop; limits.attempts 1 blocks at the first failed run', async () => {
  const w = await world(), id = w.ids[0]; w.dep.cfg.limits.nudges = 0; await w.spawn(id); edit((await w.store.get(id)).meta['cadre.worktree'])
  await C.observeWith(w.h, w.dep, { agentId: 'ag1', reason: 'answer', answer: 'done' }, e => e)
  const t = (await w.h.board.read()).tasks[0]; assert.deepEqual([t.state, t.flags.includes('auto-reported')], ['review', true])
  const w2 = await world(), id2 = w2.ids[0]; w2.dep.cfg.limits.attempts = 1; await w2.spawn(id2); await C.observeWith(w2.h, w2.dep, { agentId: 'ag1', reason: 'error' }, e => e)
  assert.equal((await w2.h.board.read()).tasks[0].state, 'blocked')
})
test('settings: limits.reportRetries 1 accepts the 2nd bad report unvalidated (flagged)', async () => {
  const w = await world(), id = w.ids[0]; w.dep.cfg.limits.reportRetries = 1; await w.spawn(id); edit((await w.store.get(id)).meta['cadre.worktree']); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id)
  const bad = { ...w.pass, coverage: [] }
  assert.match(await w.rep('ag2', bad), /attempt 1\//); assert.match(await w.rep('ag2', bad), /verdict accepted/); assert.ok((await w.h.board.read()).tasks[0].flags.includes('report-unvalidated'))
})
test('settings: limits.rebaseRounds 1 blocks a conflicting task after one rework', async () => {
  const w = await movedEpic('b.txt', 'theirs\n'), { h, store, id } = w; w.dep.cfg.limits.rebaseRounds = 1; await store.setMeta(id, { 'cadre.rebase': '1' }, 'x')
  assert.match(String(await C.closeTask(h, w.dep, id)), /still conflicts on the plan after 1 reworks/); assert.equal((await h.board.read()).tasks[0].state, 'blocked')
})
test('settings: review.maxRework 1 flags non-progress after the 2nd changes verdict', async () => {
  const w = await world(), id = w.ids[0], { h, store } = w; w.dep.cfg.review.maxRework = 1; await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']
  edit(wt); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.spawn(id)
  const ch = { ...w.pass, verdict: 'changes', summary: 'fix it', findings: [{ severity: 'major', file: 'b.txt', line: 1, issue: 'wrong', fix: 'right' }] }
  assert.match(await w.rep('ag2', ch), /changes \(1\/1\)/); edit(wt, 'b.txt', 'b1\n'); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'r1' })
  await w.rep('ag2', ch); assert.ok((await h.board.read()).tasks[0].flags.includes('rework:2/1'))
})
