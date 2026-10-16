// Replays of field failures (plan 0.14 §3.1, Replays): each row drives the real handlers with the event sequence that went wrong, on a synthetic world
// (tests/fixtures/replay), and asserts what must hold now. Its fix commit's own test stays as the twin. (A row whose fix had not landed was marked known and
// had to fail until it did; none is left.)
import { describe, expect, test } from 'claude-code/testing'
import { PASS, world, type World } from './fixtures/replay/world'
import { arm, watchdog, IDLE } from '../core/drive'
import { send } from '../policy/guards'
import { RETRIES } from '../core/validate'
import { admitWith } from '../core/admission'
import { continueRun, prune, proc, quit, life, rehydrate, savePointer } from '../core/session'
import { mainTurn } from '../core/dispatch'
import { decide } from '../commands/cadre'
import { seen, start, stopCheck, turnEnd } from '../commands/agentrun'
import { LIMIT } from '../policy/guards'
import { FULL, plan, world as native } from './fixtures/native/world'
import { setupWorld } from './fixtures/replay/setup'
import { classify, step } from '../core/lifecycle'
import { EPIC } from './fixtures/readmodel/snapshot.golden'

const roles = (w: { spawned: [string, string, string][] }) => w.spawned.map(x => x[2])
const CHANGES = { role: 'reviewer', verdict: 'changes', summary: 'fix it', findings: [{ severity: 'major', file: 'src/a.ts', issue: 'wrong answer' }], coverage: [{ scenario: 'S1', ok: false }], contractStatus: [] }
// mod mode: the spawner claims each task (worker agN), every worker reports done, the next turn end starts the reviewers
const RED_PKG = { root: '.', checks: { compile: ['tsc'] }, tdd: { paths: ['test/**'] } }   // tdd paths, but no check that runs the tests
const TESTS = [{ path: 'test/a.test.js', name: 'S1: answers', scenario: 'S1' }]
// a session after the one that ran `w` (same $.store and task store, a cold board): another process, or the same one after a /clear
const next = (w: World, p: string, session = 's2') => { proc.id = p; return world({ store: w.store, kv: w.kv, session }) }
async function inReview(w: World) {
  await arm(w.h, 'auto'); await w.turn()
  for (const [a] of w.spawned.slice()) expect(await w.rep(a, { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
  await w.turn(); return w.spawned.filter(x => x[2] === 'cadre:reviewer').map(x => x[0])
}
const landed = async (w: World) => (((await w.h.ui.read()).digest as string[] | undefined) ?? []).filter(l => l.endsWith('landed'))
const done = async (w: World) => (await w.h.board.read()).tasks.map(t => t.state)

describe('replays 1-11: the field failures', () => {
  test('#1 an id with "_": the spawner\'s own spawn and main\'s both resolve the task, no explorer', async () => {
    const w = await world({ ids: ['my_proj-4.1'] }); await arm(w.h, 'auto')
    await w.turn(); expect(roles(w)).toEqual(['cadre:worker']); expect(await w.state('ag1')).toEqual({ state: 'running' })
    const m = await world({ ids: ['my_proj-4.1'], mode: 'main' }), main = Object.assign(async (e: any) => (m.spawned.push(['ag9', e.prompt, e.subagentType]), { agentId: 'ag9' }), { origin: { plugin: 'engine' } })
    await admitWith(m.h, m.dep, { prompt: 'TASK-my_proj-4.1 write it', background: true }, main); expect(roles(m)).toEqual(['cadre:worker'])
  })
  test('#2 auto mode: an explorer that reported can hand back', async () => {
    const w = await world({ type: 'spike' }), [id] = w.ids; await w.at('ag1', id, 'explorer')
    expect(await w.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3 a()', citations: [{ path: 'src/a.ts', line: 3 }] })).toContain('answer recorded')
    expect((await w.hb('ag1')).deny).toBeUndefined(); expect(await w.state('ag1', id)).toEqual({ state: 'ended', cause: 'done' })
  })
  test('#3 a tester whose report is refused up to the cap can still hand back', async () => {
    const w = await world({ type: 'feature' }), [id] = w.ids; await w.at('ag1', id, 'tester')
    for (let i = 0; i < RETRIES; i++) expect(await w.rep('ag1', { role: 'tester', outcome: 'done', summary: 's' })).toMatch(/^error: /)
    expect(await w.state('ag1')).toEqual({ state: 'refused', n: RETRIES })
    expect((await w.hb('ag1')).deny).toBeUndefined()
  })
  test('#4 red with no test check: bounded, the task blocks once with one dialog naming it', async () => {
    const w = await world({ type: 'feature', pkg: RED_PKG }), [id] = w.ids; await w.at('ag1', id, 'tester')
    expect(await w.rep('ag1', { role: 'tester', outcome: 'done', summary: 's', tests: TESTS })).toContain('waits for the user')
    expect(await w.rep('ag1', { role: 'tester', outcome: 'done', summary: 's', tests: TESTS })).toMatch(/^error: .*nothing to report/)   // no second round
    const s = await w.h.board.read(); expect(s.tasks[0]).toMatchObject({ state: 'blocked', flags: ['red'] })
    expect((s.decisions ?? []).map(d => d.id)).toEqual([`flag:${id}:red`]); expect(s.decisions![0].lines.join(' ')).toContain('no test check')
    expect(await w.state('ag1')).toEqual({ state: 'waiting', on: 'decision' })
  })
  test('#5 /cadre continue typed while the tick rehydrates reads the board the tick built', async () => {
    const w1 = await world(); proc.id = 'P1'; await arm(w1.h, 'auto'); await w1.turn(); await savePointer(w1.h)
    const tick = await next(w1, 'P2'); let pinned = true, first: any
    const cmd = { ...tick.h, board: { read: async () => (pinned ? (first ??= await tick.h.board.read()) : tick.h.board.read()), update: async (f: any) => { pinned = false; return tick.h.board.update(f) } } } as any   // one dispatch reads the moment of its first get until it writes
    await cmd.board.read(); const t = rehydrate(tick.h)
    expect(await continueRun(cmd)).toMatch(/^Picking up \S+ worker/); await t
  })
  test('#6 a session that quits mid-spawn leaves a claim the next session takes', async () => {
    const w1 = await world(); proc.id = 'P1'; await arm(w1.h, 'auto'); const release = w1.store.release.bind(w1.store)
    w1.h.spawnAgent = (a: any) => admitWith(w1.h, w1.dep, { ...a, background: true }, Object.assign(async () => { throw new Error('killed') }, { origin: { plugin: 'cadre' } }))
    w1.store.release = async () => {}   // the process dies in the spawn call: nothing after it runs (no undo)
    await w1.turn(); w1.store.release = release
    try { await quit(w1.h) } finally { life.ending = false }
    const w2 = await next(w1, 'P2'); expect(await continueRun(w2.h)).toMatch(/^Picking up \S+ worker/)
    await w2.turn(); expect(roles(w2)).toEqual(['cadre:worker']); expect((await w2.h.bind.read()).ag1.sessionId).toBe('s2')
  })
  test('#7 main messaging a tester whose step is over is refused', async () => {
    const w = await world({ type: 'feature' }), [id] = w.ids; await w.at('ag1', id, 'tester')
    await w.h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, step: 'worker' })) })); await step(w.h, 'ag1', { type: 'report.ok' })   // red accepted: the worker is next
    expect(await w.state('ag1')).toEqual({ state: 'idle-bound' })
    const r = await send(w.h, { to: 'ag1', text: 'now implement it' }, async () => ({ isDelivered: true })) as any
    expect(r.isDelivered).toBe(false); expect(w.sent).toEqual([])
    await arm(w.h, 'auto'); await w.h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, step: 'tester' })) }))   // mod mode: even an agent at its own step is cadre's to resume
    expect((await send(w.h, { to: 'ag1', text: 'how is it going?' }, async () => ({ isDelivered: true })) as any).isDelivered).toBe(false)
  })
  test('#8 a stop mid-approval counts the lite plan\'s own task; a second task for the same work is refused', async () => {
    const w = await native()
    await w.call('TaskCreate', { subject: 'Add parse', description: 'src/parse.js', metadata: { kind: 'plan', lane: 'lite', reason: 'one function', type: 'feature', changelog: { category: 'Added', entry: 'parse' } } })
    const p = (await w.h.board.read()).plan!, kid = (await w.store.list({ parent: p.id }))[0]; await w.store.approve([kid.id])   // the store moved, the board not yet
    await w.h.secret.update(x => ({ ...x, goalRun: { text: 'add parse', mode: 'auto', follow: 0, on: true } })); expect(await stopCheck(w.h, {})).toBeNull()
    const v = await native(); await v.call('TaskCreate', { subject: 'Service', description: 'goal', metadata: { kind: 'plan', lane: 'full', reason: 'a feature' } })
    const one = { subject: 'Add parse', description: 'd', metadata: { type: 'feature', paths: ['src/parse.js'] } }, id = (await v.call('TaskCreate', one)).result.task.id
    expect((await v.call('TaskCreate', { ...one, subject: 'add PARSE' })).deny).toContain(`${id} already covers this`)
  })
  test('#9 a plan drafted in one turn: no card mid-turn, one card at its end', async () => {
    const w = await native(); await mainTurn(w.h, true)
    const { task } = await plan(w), b = (await w.call('TaskCreate', { subject: 'More', description: '', metadata: { ...FULL, paths: ['src/more.ts'] } })).result.task.id
    await w.call('TaskUpdate', { taskId: b, addBlockedBy: [task] })
    const cards = async () => ((await w.h.board.read()).decisions ?? []).filter(d => d.id.startsWith('plan:'))
    expect(await cards()).toEqual([]); await mainTurn(w.h, false); expect(await cards()).toHaveLength(1)
  })
  test('#10 yolo, a red stop, Retry: the drive resumes and a tester starts', async () => {
    const w = await world({ type: 'feature', pkg: RED_PKG, drive: 'yolo' }), [id] = w.ids; await arm(w.h, 'yolo'); await w.at('ag1', id, 'tester')
    await w.rep('ag1', { role: 'tester', outcome: 'done', summary: 's', tests: TESTS }); await w.turn()
    expect((await w.h.board.read()).drive.stopped).toBeDefined()
    const d = (await w.h.board.read()).decisions!.find(x => x.id === `flag:${id}:red`)!; expect((await decide(w.h, d.id, 'r', d.hash)).text).toContain('back to the tester')
    expect((await w.h.board.read()).drive.stopped).toBeUndefined(); expect((await w.h.ui.read()).goal).toBeDefined()   // lifted; main gets a turn (no dialog frame starts an agent)
    await w.turn(); expect(roles(w)).toContain('cadre:tester')   // main's turn end: the spawner
  })
  test('#11 "Let Claude try again" never refills the stop refusals', async () => {
    const { h, tick, card } = setupWorld(); await start(h, 'init'); await tick()
    let refused = 0
    for (let n = 0; n < 6; n++) {   // each retry: Claude tries once, stops, stops again
      if (await stopCheck(h, {})) refused++; await seen(h, { tool: true })
      if (await stopCheck(h, {})) refused++
      expect(await stopCheck(h, {})).toBeNull()
      await turnEnd(h, {}); const d = (await card())!; expect(d.options.map(o => o.label)).toContain('Let Claude try again'); await decide(h, d.id, 'r', d.hash); await tick()
    }
    expect(refused).toBe(LIMIT.follow)
  })
})

describe('review fixes', () => {
  test('main mode: main messaging an agent that waits for a decision is told how to answer it (its next step would be ended unread)', async () => {
    const w = await world({ mode: 'main' }), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'blocked', summary: 'stuck', reason: 'which format?' })).toContain('blocked recorded')
    const r = await send(w.h, { to: 'ag1', text: 'use JSON' }, async () => ({ isDelivered: true })) as any
    expect(r.isDelivered).toBe(false); expect(r.reason).toContain(`waits for the human's decision: ask them, then status {id:"${id}", decision:"accept: …"} or "reject: …"`)
  })
  test('main mode: a retired agent is not said to have handed in its work: a fresh one takes over', async () => {
    const w = await world({ mode: 'main' }), [id] = w.ids; await w.at('ag1', id, 'worker'); await step(w.h, 'ag1', { type: 'retire' })
    const r = await send(w.h, { to: 'ag1', text: 'go on' }, async () => ({ isDelivered: true })) as any
    expect(r.isDelivered).toBe(false); expect(r.reason).toContain(`Start a fresh one with Agent prompt "TASK-${id}"`); expect(r.reason).not.toContain('handed in')
  })
})

describe('replays 12-20: regressions from the log', () => {
  test('#12 an agent that reported can hand back after /clear', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
    await w.h.ui.update(() => ({}))   // /clear empties ui
    expect((await w.hb('ag1')).deny).toBeUndefined()
  })
  test('#13 two turn ends at once: one close, no second squash', async () => {
    const w = await world(), [rv] = await inReview(w), run0 = w.h.run; let other: Promise<void> | undefined
    expect(await w.rep(rv, PASS)).toContain('pass@')
    w.h.run = async (argv, o) => { if (!other && argv.includes('--squash')) await (other = w.turn()); return run0(argv, o) }   // another agent's turn end while this one squashes
    await w.turn(); w.h.run = run0
    expect(await done(w)).toEqual(['done']); expect(await landed(w)).toHaveLength(1); expect(w.calls.filter(c => c.includes('merge --squash'))).toHaveLength(1)
    expect(w.h.logs.filter(l => l.includes('not landed'))).toEqual([]); expect(await w.state(rv, w.ids[0])).toEqual({ state: 'ended', cause: 'done' })
  })
  test('#14 a rework a close queues (the plan moved) is sent from the spawner\'s own frame, once', async () => {
    let moved = false
    const w = await world({ git: a => (!moved ? undefined : a.includes('merge-tree') ? { exitCode: 1, stdout: 'tree\nsrc/a.ts\n' } : a.join(' ').includes('epic/p1-service^{commit}') ? { stdout: 'e0e0e0e\n' } : undefined) })
    const [rv] = await inReview(w); expect(await w.rep(rv, PASS)).toContain('pass@'); w.sent.length = 0
    moved = true; await w.turn()
    expect(w.sent.map(x => x[0])).toEqual(['ag1']); expect(w.sent[0][1]).toContain('The plan moved on')
    expect(await done(w)).toEqual(['active'])
  })
  test('#15 a verdict mid-write is skipped quietly; its reviewer\'s turn end lands it', async () => {
    const w = await world(), [rv] = await inReview(w), set = w.store.setMeta.bind(w.store); let other = false
    w.store.setMeta = async (id, m, a) => { if (!other && m['cadre.review']?.startsWith('pass@')) { other = true; await w.turn() } return set(id, m, a) }   // another agent's turn end between the board's move and the store's
    expect(await w.rep(rv, PASS)).toContain('pass@'); expect(other).toBe(true)
    expect(await done(w)).toEqual(['review']); expect(w.h.logs.filter(l => l.includes('not landed'))).toEqual([])
    await w.stop(rv); await w.turn(); expect(await done(w)).toEqual(['done'])
  })
  test('#16 a pass that comes while another task lands is landed by that landing', async () => {
    const w = await world({ n: 2 }), [r1, r2] = await inReview(w), run0 = w.h.run; let late: Promise<void> | undefined
    w.h.run = async (argv, o) => { if (!late && argv.includes('--squash')) await (late = (async () => { expect(await w.rep(r2, PASS)).toContain('pass@'); await w.turn() })()); return run0(argv, o) }   // the second pass and its turn end come while the first lands
    expect(await w.rep(r1, PASS)).toContain('pass@'); await w.turn(); w.h.run = run0
    expect(await done(w)).toEqual(['done', 'done']); expect(await landed(w)).toHaveLength(2)
  })
  test('#17 the owner is recorded before the store claim', async () => {
    const w = await world(), [id] = w.ids, claim = w.store.claim.bind(w.store); let seen: unknown
    w.store.claim = async (...x: Parameters<typeof claim>) => { seen = (await w.store.control()).doc[`hb:${id}`]; return claim(...x) }   // what a session killed during the claim leaves
    await arm(w.h, 'auto'); await w.turn()
    expect(seen).toEqual({ s: 's1', at: 0 })
  })
  test('#19 after /clear a reviewer at work keeps its binding and its report is accepted', async () => {
    const w = await world(); proc.id = 'P1'; const [rv] = await inReview(w)
    const c = await next(w, 'P1', 's2'); c.clock.now = w.clock.now + 6 * 60_000   // the same process, a new session: no claim lease left (a task in review has none)
    await prune(c.h); await rehydrate(c.h)
    expect((await c.h.bind.read())[rv]).toMatchObject({ role: 'reviewer', sessionId: 's2' }); expect(await c.state(rv)).toEqual({ state: 'running' })
    expect(await c.rep(rv, PASS)).toContain('pass@')
  })
  test('#20 a reworked task keeps its reviewer: resumed, never a second one', async () => {
    const w = await world(), [rv] = await inReview(w)
    expect(await w.rep(rv, CHANGES)).toContain('changes (1/')
    expect(await w.state(rv)).toEqual({ state: 'idle-bound' })   // bound and resumable: its verdict is in
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'fixed' })).toContain('report accepted')
    expect(await w.state('ag1')).toEqual({ state: 'idle-bound' })
    await w.turn(); expect(roles(w)).toEqual(['cadre:worker', 'cadre:reviewer']); expect(w.sent.map(x => x[0])).toContain(rv)
    expect((await w.h.board.read()).tasks[0].owner).toBeDefined()
  })
  test('#18 the watchdog\'s window starts at its first look, not at zero', async () => {
    const w = await world(); await arm(w.h, 'auto')
    await watchdog(w.h); expect((await w.h.ui.read()).goal).toBeUndefined()   // main may be mid-turn
    await w.h.ui.update(u => ({ ...u, idleAt: Number(u.idleAt) - 200_000 })); await watchdog(w.h); expect((await w.h.ui.read()).goal).toBe(IDLE)
  })
})

// classify on the golden board (a1 done, a2 active·worker, a3 todo), each expected state written by hand
describe('classify: the read view of the run records', () => {
  const at = (taskId: string, role: any, step = role) => ({ taskId, role, step, worktree: '/wt', sessionId: 's1', ctxTokens: 0, startedAt: 0 })
  const run = (state: any) => ({ 'ag-2': { taskId: 'a2', role: 'worker', step: 'worker', state, epoch: 1, log: [] } }), tasks = EPIC.tasks, bind = { 'ag-2': at('a2', 'worker') }
  const rows = [
    ['a spawn reserved', { bind: { '~a3': at('a3', 'worker', '') }, tasks }, '~a3', undefined, { state: 'reserved' }],
    ['its run record: running', { bind, tasks, runs: run({ state: 'running' }) }, 'ag-2', undefined, { state: 'running' }],
    ['its run record: nudged once', { bind, tasks, runs: run({ state: 'silent', n: 1 }) }, 'ag-2', undefined, { state: 'silent', n: 1 }],
    ['its run record: parked for a decision', { bind, tasks, runs: run({ state: 'waiting', on: 'decision' }) }, 'ag-2', undefined, { state: 'waiting', on: 'decision' }],
    ['bound with no run record: lost (its next event ends it)', { bind, tasks }, 'ag-2', undefined, { state: 'ended', cause: 'lost' }],
    ['unbound, its task done', { bind: {}, tasks }, 'ag-1', 'a1', { state: 'ended', cause: 'done' }],
    ['unbound, its task back to todo', { bind: {}, tasks }, 'ag-3', 'a3', { state: 'ended', cause: 'released' }],
    ['unbound, task unknown', { bind: {}, tasks }, 'ag-9', undefined, { state: 'ended', cause: 'lost' }],
  ] as const
  for (const [name, v, id, task, want] of rows) test(name, () => { expect(classify(v as any, id, task)).toEqual(want) })
})
