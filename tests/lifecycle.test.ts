// The run record (core/lifecycle): the pure next() as a state × event table, step() over $.state with its control-doc mirror, and the invariants it carries so far.
import { describe, expect, test } from 'claude-code/testing'
import { backstop, budgetOf, exitStep, next, pruneRuns, restore, runOf, step, type Run, type RunEvent, type RunState } from '../core/lifecycle'
import { scoped } from '../commands/init'
import { queueResume } from '../core/reuse'
import { stopped } from '../core/close'
import { BUDGET } from './fixtures/budget.generated'
import { oldState } from '../commands/doctor'
import { start } from '../core/session'
import { PASS, world, type World } from './fixtures/replay/world'
import { arm } from '../core/drive'
import { active, setProfile } from '../core/pipeline'
import { profile as DEFAULT } from '../profiles/default'

const run = (state: RunState | null): Run => ({ taskId: 't1', role: 'worker', step: 'worker', state, epoch: 1, log: [] })
const S = {
  running: { state: 'running' }, refused: { state: 'refused', n: 1 }, silent: { state: 'silent', n: 1 }, idle: { state: 'idle-bound' }, waiting: { state: 'waiting', on: 'decision' },
  done: { state: 'ended', cause: 'done' },
} as const satisfies Record<string, RunState>
const E: Record<string, RunEvent> = { ok: { type: 'report.ok' }, park: { type: 'report.ok', wait: true }, refused: { type: 'report.refused' }, nudged: { type: 'turn.end', text: 'n' },
  resumed: { type: 'resume', text: 'r' }, retired: { type: 'retire' }, released: { type: 'end', cause: 'released', reason: 'stopped' } }
const wake = (text: string) => [{ kind: 'wake', text }], gone = [{ kind: 'unbind', reason: 'stopped' }], ended = { state: 'ended', cause: 'released' } as const

describe('next(): state × event', () => {
  type Cell = [RunState, object[]?]
  const want: Record<keyof typeof S, Record<string, Cell>> = {
    running: { ok: [S.idle], park: [S.waiting], refused: [S.refused], nudged: [S.silent, wake('n')], resumed: [S.running, wake('r')], retired: [{ state: 'retired' }, [{ kind: 'retire' }]], released: [ended, gone] },
    refused: { ok: [S.idle], park: [S.waiting], refused: [{ state: 'refused', n: 2 }], nudged: [S.silent, wake('n')], resumed: [S.refused, wake('r')], retired: [{ state: 'retired' }, [{ kind: 'retire' }]], released: [ended, gone] },
    silent: { ok: [S.idle], park: [S.waiting], refused: [S.refused], nudged: [{ state: 'silent', n: 2 }, wake('n')], resumed: [S.silent, wake('r')], retired: [{ state: 'retired' }, [{ kind: 'retire' }]], released: [ended, gone] },
    idle: { ok: [S.idle], park: [S.waiting], refused: [S.refused], nudged: [S.silent, wake('n')], resumed: [S.running, wake('r')], retired: [{ state: 'retired' }, [{ kind: 'retire' }]], released: [ended, gone] },
    // invariant 2: a parked run is never retired, nudged or refused out of its wait; an answer (resume) or its end moves it
    waiting: { ok: [S.waiting], park: [S.waiting], refused: [S.waiting], nudged: [S.waiting], resumed: [S.running, wake('r')], retired: [S.waiting], released: [ended, gone] },
    done: { ok: [S.done], park: [S.done], refused: [S.done], nudged: [S.done], resumed: [S.done], retired: [S.done], released: [S.done] },   // terminal: nothing moves it
  }
  for (const [s, row] of Object.entries(want)) for (const [ev, [to, fx = []]] of Object.entries(row))
    test(`${s} + ${ev} -> ${to.state}`, () => { const r = next(run(S[s as keyof typeof S]), E[ev]); expect(r.run.state).toEqual(to); expect(r.effects).toEqual(fx) })
  test('spawn.ok starts a run on its task at the task\'s spawn count (its epoch)', () => {
    const r = next(run(S.done), { type: 'spawn.ok', bind: { taskId: 't2', role: 'tester', step: 'tester', worktree: '/wt', sessionId: 's', ctxTokens: 0, startedAt: 0 }, epoch: 4 }).run
    expect(r).toMatchObject({ taskId: 't2', role: 'tester', step: 'tester', state: S.running, epoch: 4 })
  })
  test('a resume to a new step moves the run to it (the test author goes on as the worker)', () => { expect(next(run(S.idle), { type: 'resume', text: 'r', step: 'tester' }).run.step).toBe('tester') })
  test('a binding with no record ends lost and is unbound, whatever the event', () => {
    for (const e of Object.values(E)) expect(next(run(null), e)).toMatchObject({ run: { state: { state: 'ended', cause: 'lost' } }, effects: [{ kind: 'unbind', reason: 'lost' }] })
  })
  test('the log keeps the last 20 steps: state, event, cause', () => {
    let r = run(S.running); for (let i = 0; i < 25; i++) r = next(r, E.refused).run
    r = next(r, E.released).run
    expect(r.log).toHaveLength(20); expect(r.log.at(-1)).toEqual({ state: 'ended', event: 'end', cause: 'released' })
  })
})

describe('step(): the run record', () => {
  test('admission records the spawn; a report moves the run; the control-doc mirror holds what $.state holds and survives /clear', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
    const mirrored = (await w.store.control()).doc['run:ag1'] as Run
    expect(mirrored.state).toEqual({ state: 'idle-bound' }); expect(mirrored).toEqual(((await w.h.ui.read()).runs as Record<string, Run>).ag1)
    expect(mirrored.log.map(x => x.event)).toEqual(['spawn.ok', 'report.ok'])
    await w.h.ui.update(() => ({}))   // /clear
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'idle-bound' })
  })
  test('spawn.ok binds first: the agent\'s first model request, already under way, finds the effort admission routed', async () => {
    const w = await world(), [id] = w.ids, seen: boolean[] = []
    const peek = (o: any, k: string) => { const f = o[k]; o[k] = async (...a: any[]) => { seen.push(!!(await w.h.bind.read()).ag1); return f.apply(o, a) } }
    peek(w.h.ui, 'read'); peek(w.h.ui, 'update'); peek(w.h.store, 'get'); peek(w.h.store, 'set')
    await step(w.h, 'ag1', { type: 'spawn.ok', bind: { taskId: id, role: 'worker', step: 'worker', worktree: '/wt', sessionId: 's1', ctxTokens: 0, startedAt: 0, effort: 'high' } })
    expect(seen.length > 0 && seen.every(Boolean)).toBe(true)
  })
  test('a blocked report parks the run for a decision; its turn end then nudges nothing', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'blocked', summary: 'stuck', reason: 'which format?' })).toContain('blocked recorded')
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'decision' })
    await w.stop('ag1'); expect(w.sent).toEqual([]); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'decision' })
  })
  test('a stop without a report is nudged (silent n); past the nudges it ends, nothing accepted, the task blocked with one dialog', async () => {
    for (const [role, type] of [['worker', 'docs'], ['tester', 'feature']] as const) {
      const w = await world({ type }), [id] = w.ids; await w.at('ag1', id, role)
      for (let i = 0; i < w.cfg.limits.nudges; i++) { await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'silent', n: i + 1 }) }
      await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'blocked' })
      expect((await w.h.board.read()).tasks.find(t => t.id === id)).toMatchObject({ state: 'blocked', flags: ['no-report'] })
    }
  })
  test('a binding with no run record ends lost and is unbound at its next event', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.h.ui.update(u => ({ ...u, runs: {} })); await w.store.setControl({ 'run:ag1': undefined })   // the record is gone (an older store)
    await step(w.h, 'ag1', { type: 'turn.end', text: 'go on' })
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'lost' }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect(Object.values((await w.h.events.read()).epics).flat().some(e => e.type === 'agent.unbound' && e.data.reason === 'lost')).toBe(true)
  })
  test('an agent with neither a binding nor a record has no run', async () => {
    const w = await world(); expect(await step(w.h, 'stranger', { type: 'turn.end', text: 'go on' })).toBeUndefined(); expect(await runOf(w.h, 'stranger')).toBeUndefined()
  })
  test('a role step after a read-only step takes the task on (it is not done); the report gate closes it', async () => {
    const before = active()
    try {
      setProfile({ ...DEFAULT, types: { ...DEFAULT.types, spike: { ...DEFAULT.types.spike, pipeline: ['explorer', 'worker'] } } } as any)
      const y = await world({ type: 'spike' }); await y.at('ag1', y.ids[0], 'explorer')
      expect(await y.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3', citations: [] })).toContain('the next step starts by itself'); expect((await y.h.board.read()).tasks[0].state).not.toBe('done')
    } finally { setProfile(before) }
  })
  test('an explorer\'s answer ends its run done; a landed task prunes its agents\' records', async () => {
    const x = await world({ type: 'spike' }); await x.at('ag1', x.ids[0], 'explorer')
    expect(await x.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3', citations: [] })).toContain('answer recorded'); expect((await runOf(x.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'done' })
    const w = await world(); await arm(w.h, 'auto'); await w.turn()
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted'); await w.turn()
    expect(await w.rep('ag2', PASS)).toContain('pass@'); expect((await runOf(w.h, 'ag2'))?.state).toEqual({ state: 'idle-bound' })
    await w.turn(); expect((await w.h.board.read()).tasks[0].state).toBe('done')
    for (const a of ['ag1', 'ag2']) { expect(await runOf(w.h, a)).toBeUndefined(); expect((await w.store.control()).doc[`run:${a}`]).toBeUndefined() }
  })
})

describe('invariant 1: an agent can always end', () => {
  const states = ['running', 'silent', 'refused', 'idle', 'waiting', 'done'] as const
  for (const s of states) test(`hand-back from ${s}: never refused (exit rule 1)`, async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.h.ui.update(u => ({ ...u, runs: { ag1: { ...((u.runs as any).ag1), state: S[s] } } }))
    expect((await w.hb('ag1')).deny).toBeUndefined()
  })
})

describe('one writer: binding, wake and budget writes only in core/lifecycle', () => {
  test('the frozen scan of the product code finds none elsewhere (patchBinding writes plain fields only)', () => { expect(BUDGET.writesOutside).toEqual([]) })
})

describe('invariant 2: a waiting run is never retired, nudged or released', () => {
  test('parked for a decision: its turn end, an API error and a retire leave it waiting and bound; nothing is sent', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'blocked', summary: 'stuck', reason: 'which format?' })).toContain('blocked recorded')
    await w.stop('ag1'); await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error' }); await step(w.h, 'ag1', { type: 'retire' })
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'decision' }); expect((await w.h.bind.read()).ag1).toMatchObject({ taskId: id }); expect((await w.h.bind.read()).ag1.retired).toBeUndefined()
    expect(w.sent).toEqual([]); expect((await budgetOf(w.h, id)).silentRuns).toBe(0)
  })
})

describe('invariant 3: every end, and an idle-bound run, yields exactly one next step', () => {
  // what the task gets next: agents spawned, dialogs about it, its landing (the plan completing after it is the plan's own step)
  const steps = async (w: World, go: () => Promise<unknown>) => {
    const id = w.ids[0], n = async () => w.spawned.length + ((await w.h.board.read()).decisions ?? []).filter(d => d.id.includes(id)).length + ((((await w.h.ui.read()).digest as string[]) ?? []).filter(l => l.startsWith(`${id} `)).length)
    const before = await n(); await go(); return (await n()) - before
  }
  test('ended released (its turn died without a report): one new agent', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await w.at('ag1', id, 'worker')
    await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error' })
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'released' }); expect(await steps(w, w.turn)).toBe(1)
  })
  test('ended blocked (silent runs at the cap): one dialog, no agent', async () => {
    const w = await world(), [id] = w.ids; w.cfg.limits.silentRuns = 1; await arm(w.h, 'auto'); await w.at('ag1', id, 'worker')
    expect(await steps(w, async () => { await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error' }); await w.turn() })).toBe(1)
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'blocked' }); expect(w.spawned).toEqual([])
  })
  test('ended lost (a binding with no record): one new agent', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await w.at('ag1', id, 'worker'); await w.h.ui.update(u => ({ ...u, runs: {} })); await w.store.setControl({ 'run:ag1': undefined })
    await step(w.h, 'ag1', { type: 'report.refused' }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect(await steps(w, w.turn)).toBe(1)
  })
  test('idle-bound after the worker\'s report: one reviewer; idle-bound after a pass: one landing (ended done)', async () => {
    const w = await world(), keep = active(); await arm(w.h, 'auto'); await w.turn(); w.spawned.length = 0
    await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'idle-bound' })
    expect(await steps(w, w.turn)).toBe(1); expect(w.spawned.map(x => x[2])).toEqual(['cadre:reviewer'])
    setProfile({ ...keep, hooks: {} })   // the scripted git here cannot run a delivery hook
    try { await w.rep('ag2', PASS); expect(await steps(w, w.turn)).toBe(1); expect((await w.h.board.read()).tasks[0].state).toBe('done') } finally { setProfile(keep) }
  })
})

describe('exactly-once wake, by task epoch', () => {
  test('the same wake twice goes out once; a wake for an older run of the agent is dropped', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect((await budgetOf(w.h, id)).epoch).toBe(1); expect((await runOf(w.h, 'ag1'))?.epoch).toBe(1)
    await step(w.h, 'ag1', { type: 'resume', text: 'fix the finding' }); await step(w.h, 'ag1', { type: 'resume', text: 'fix the finding' })
    await queueResume(w.h, { agentId: 'ag1', taskId: id, text: 'from before', epoch: 0 })   // an older run's wake
    await w.stop('ag2'); expect(w.sent.map(x => x[1])).toEqual(['fix the finding'])
  })
})

describe('the store stays small', () => {
  test('session start prunes ended runs and runs of tasks no longer in flight', async () => {
    const w = await world({ n: 2 }), [a, b] = w.ids; await w.at('ag1', a, 'worker'); await w.at('ag2', b, 'worker')
    await step(w.h, 'ag1', { type: 'end', cause: 'released', reason: 'stopped' })
    await pruneRuns(w.h, async () => true)
    const doc = async () => (await w.store.control()).doc
    expect((await doc())['run:ag1']).toBeUndefined(); expect((await doc())['run:ag2']).toBeDefined()
    await pruneRuns(w.h, async t => t !== b); expect((await doc())['run:ag2']).toBeUndefined()
  })
  test('after /clear a binding comes back only with its run record', async () => {
    const w = await world(), [id] = w.ids, b = { taskId: id, role: 'worker' as const, step: 'worker', worktree: '/wt', sessionId: 's2', ctxTokens: 0, startedAt: 0 }
    expect(await restore(w.h, 'ag9', b)).toBe(false); expect((await w.h.bind.read()).ag9).toBeUndefined()
    await w.at('ag1', id, 'worker'); await w.h.ui.update(() => ({})); await w.h.bind.update(() => ({}))   // a /clear
    expect(await restore(w.h, 'ag1', b)).toBe(true); expect((await w.h.bind.read()).ag1.sessionId).toBe('s2')
  })
})

describe('clean break: Doctor names state the previous version left', () => {
  test('an old counter on an open task, a hand-back mark, or an agent bound with no run record; none on a fresh run', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker'); const open = { category: 'active', meta: {} as Record<string, string> }
    expect(await oldState(w.h, [open])).toBe(false)
    expect(await oldState(w.h, [{ ...open, meta: { 'cadre.attempts': '2' } }])).toBe(true); expect(await oldState(w.h, [{ category: 'done', meta: { 'cadre.attempts': '2' } }])).toBe(false)
    await w.h.ui.update(u => ({ ...u, handed: ['ag1'] })); expect(await oldState(w.h, [open])).toBe(true); await w.h.ui.update(({ handed: _x, ...u }) => u)
    await w.h.bind.update(b => ({ ...b, old: b.ag1 })); expect(await oldState(w.h, [open])).toBe(true)
  })
})

describe('review fixes: session start keeps a planner\'s run', () => {
  test('a run on an epic that is still being planned (todo, not in flight) survives the session-start prune', async () => {
    const w = await world(), e = w.epic   // the plan's epic: approved, category todo
    await step(w.h, 'pl1', { type: 'spawn.ok', bind: { taskId: e, role: 'planner', step: 'planner', worktree: '/r', sessionId: 's1', ctxTokens: 0, startedAt: 0 } })
    await w.h.ui.update(() => ({})); await start(w.h)
    expect((await runOf(w.h, 'pl1'))?.state).toEqual({ state: 'running' })
  })
})

describe('the backstop with two sessions on one repo: only the session that forced a run stops it', () => {
  const force = async (w: World, agentId: string) => { const g = exitStep(w.h, { agentId, turnId: 't', index: 3 }, async function* () { return {} }); while (!(await g.next()).done); }
  test('B leaves A\'s overdue run and its deadline; A stops it; a run whose owner went quiet is ended by B', async () => {
    const A = await world({ n: 2 }), B = await world({ kv: A.kv, store: A.store, session: 's2' }), [x, y] = A.ids, stops: string[] = []
    Object.assign(A.h, { stopAgent: async (a: string) => { stops.push(`A ${a}`) } }); Object.assign(B.h, { stopAgent: async (a: string) => { stops.push(`B ${a}`); throw new Error('not running here') } })
    for (const [a, id] of [['ag1', x], ['ag2', y]]) { await A.at(a, id, 'worker'); await A.rep(a, { role: 'worker', outcome: 'done', summary: 'did it' }); await force(A, a) }
    const r = (await runOf(A.h, 'ag1'))!; expect(r.session).toBe('s1')
    const alive = async (at: number) => B.h.store.set(await scoped(B.h, 'alive'), { s1: { p: 'A-process', at } })   // A's heartbeat (core/session.stampAlive)
    B.clock.now = r.deadline! + 1000; await alive(B.clock.now); await backstop(B.h, 's2')
    expect(stops).toEqual([]); expect((await runOf(B.h, 'ag1'))!.deadline).toBe(r.deadline); expect((await runOf(B.h, 'ag1'))!.state).toEqual({ state: 'idle-bound' })   // left alone
    A.clock.now = (await runOf(A.h, 'ag2'))!.deadline! + 1000; await backstop(A.h, 's1')
    expect(stops).toEqual(['A ag1', 'A ag2']); expect((await runOf(A.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'lost' })
    expect(((await A.h.board.read()).decisions ?? []).map(d => d.id)).toEqual(['stalled:ag1', 'stalled:ag2'])
    // a third run, forced by A, then A goes quiet past the alive window: B ends it (its TaskStop fails there: ended lost, quietly)
    await A.store.setControl({ 'run:ag3': { ...r, deadline: B.clock.now - 1, session: 's1', state: { state: 'idle-bound' } } })
    await alive(B.clock.now - 1000); await backstop(B.h, 's2'); expect(stops).toEqual(['A ag1', 'A ag2']); expect((await runOf(B.h, 'ag3'))!.deadline).toBeDefined()   // 1 s old: still alive
    await alive(B.clock.now - 31_000); await backstop(B.h, 's2')
    expect(stops).toEqual(['A ag1', 'A ag2', 'B ag3']); expect((await runOf(B.h, 'ag3'))!).toMatchObject({ state: { state: 'ended', cause: 'lost' }, deadline: undefined })
  })
})
