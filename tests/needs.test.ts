// A need (core/needs): a run that asks for help waits on it as a lifecycle state, and its helper's one answer wakes it. The state × event rows of next(), then the flow
// on the replay world: request -> helper -> answer -> resume, every way a helper ends, the refusals, the caps, and a process death in between.
import { FORMS, vet } from '../core/helpers'
import { describe, expect, test } from 'claude-code/testing'
import { backstop, intend, next, runOf, step, type Run, type RunEvent, type RunState } from '../core/lifecycle'
import { needOf, overdue, pending, undelivered } from '../core/needs'
import { arm, stop, watchdog } from '../core/drive'
import { LIFECYCLE } from '../core/plantools'
import { budgetOf } from '../core/lifecycle'
import { continueRun } from '../core/session'
import '../core/close'
import { ROLES_DEFAULT } from '../core/roles'
import { drop, hold } from '../core/queue'
import { world, type World } from './fixtures/replay/world'

const WAIT: RunState = { state: 'waiting', on: 'need', needId: 'n1' }, run = (state: RunState | null): Run => ({ taskId: 't1', role: 'worker', step: 'worker', state, epoch: 3, log: [] })
const ended = (cause: string) => ({ state: 'ended', cause })
const REQ = { role: 'worker', outcome: 'request', summary: 'need a look', request: { helper: 'explore', ask: 'where is the parser?', why: 'I change it', paths: ['src/'] } }
const ANSWER = { role: 'explorer', answer: 'in src/parse.ts', citations: [{ path: 'src/parse.ts', line: 3 }] }

describe('next(): a run waiting on a need (invariant 2)', () => {
  const E: Record<string, [RunEvent, RunState, object[]]> = {
    ok: [{ type: 'report.ok' }, WAIT, []], park: [{ type: 'report.ok', wait: true }, WAIT, []], refused: [{ type: 'report.refused' }, WAIT, []], nudged: [{ type: 'turn.end', text: 'n' }, WAIT, []],
    retired: [{ type: 'retire' }, WAIT, []], 'an unrelated resume': [{ type: 'resume', text: 'r' }, WAIT, []], 'a resume to a step': [{ type: 'resume', text: 'r', step: 'tester' }, WAIT, []],
    released: [{ type: 'end', cause: 'released', reason: 'stopped' }, WAIT, []], blocked: [{ type: 'end', cause: 'blocked', reason: 'x' }, WAIT, []], done: [{ type: 'end', cause: 'done', reason: 'answer' }, WAIT, []],
    'a stale answer (another need)': [{ type: 'answered', needId: 'n0', epoch: 3, text: 'a' }, WAIT, []], 'a stale answer (an older run)': [{ type: 'answered', needId: 'n1', epoch: 2, text: 'a' }, WAIT, []],
    'its answer': [{ type: 'answered', needId: 'n1', epoch: 3, text: 'a' }, { state: 'running' }, [{ kind: 'wake', text: 'a' }]],
    cancelled: [{ type: 'end', cause: 'cancelled', reason: 'x' }, ended('cancelled') as RunState, [{ kind: 'unbind', reason: 'x' }]], lost: [{ type: 'end', cause: 'lost', reason: 'x' }, ended('lost') as RunState, [{ kind: 'unbind', reason: 'x' }]],
    'the human retry': [{ type: 'end', cause: 'retry', reason: 'retry' }, ended('retry') as RunState, [{ kind: 'unbind', reason: 'retry' }]],
  }
  for (const [n, [e, to, fx]] of Object.entries(E)) test(`waiting{need} + ${n}`, () => { const r = next(run(WAIT), e); expect(r.run.state).toEqual(to); expect(r.effects).toEqual(fx) })
  test('an answer to a run that is not waiting is dropped; a request parks a running one', () => {
    expect(next(run({ state: 'running' }), { type: 'answered', needId: 'n1', epoch: 3, text: 'a' })).toMatchObject({ run: { state: { state: 'running' } }, effects: [] })
    expect(next(run({ state: 'running' }), { type: 'request', needId: 'n1' }).run.state).toEqual(WAIT)
  })
})

const start = async (o: Parameters<typeof world>[0] = {}) => {
  const w = await world(o), [id] = w.ids, stops: string[] = [], later: (() => unknown)[] = []; Object.assign(w.h, { stopAgent: async (a: string) => { stops.push(a) }, after: (_: number, fn: () => unknown) => { later.push(fn) } })   // after: the detached setup runs when a test says (flush)
  const flush = async () => { while (later.length) await later.shift()!() }
  await arm(w.h, 'auto'); await w.turn(); return { w, id, stops, later, flush }
}
const events = async (w: World, type: string) => Object.values((await w.h.events.read()).epics).flat().filter(e => e.type === type)
const asked = async (o = {}) => { const x = await start(o); expect(await x.w.rep('ag1', REQ)).toMatch(/^request recorded/); await x.w.turn(); return x }
const types = (w: World) => w.spawned.map(x => x[2])

describe('a request: the requester waits, the helper answers, the same agent resumes', () => {
  test('request -> helper -> answer -> resume: one help.done, no dialog, no nudge; the answer is stored and marked delivered', async () => {
    const { w, id } = await asked()
    expect(types(w)).toEqual(['cadre:worker', 'cadre:explorer']); expect((await w.h.bind.read()).ag2).toMatchObject({ taskId: id, role: 'explorer', parent: 'ag1', needId: 'n1' })
    expect(w.spawned[1][1]).toContain('where is the parser?'); expect(w.spawned[1][1]).toContain('I change it'); expect(w.spawned[1][1]).toContain('src/')
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'need', needId: 'n1' })
    await w.stop('ag1'); expect(await budgetOf(w.h, id)).toMatchObject({ nudges: 0, silentRuns: 0 }); expect(w.sent).toEqual([]); expect((await w.h.board.read()).tasks[0]).toMatchObject({ state: 'active', flags: [] })   // the requester's turn end: no nudge, card or block
    expect(await w.rep('ag2', ANSWER)).toBe('answer recorded. Stop.')
    await w.stop('ag2'); expect(w.sent).toHaveLength(1); expect(w.sent[0][0]).toBe('ag1'); expect(w.sent[0][1]).toContain('in src/parse.ts'); expect(w.sent[0][1]).toContain('src/parse.ts:3')
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'running' }); expect(await w.state('ag2', id)).toEqual({ state: 'ended', cause: 'done' }); expect((await w.h.bind.read()).ag1).toBeDefined()
    expect(await needOf(w.h, id)).toMatchObject({ answer: expect.stringContaining('in src/parse.ts'), ok: true, delivered: true })
    expect((await events(w, 'help.asked')).length).toBe(1); expect((await events(w, 'help.done')).map(e => e.data.ok)).toEqual([true]); expect((await w.h.board.read()).decisions ?? []).toEqual([])
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toMatch(/^report accepted/)
  })
  test('the wait survives a stop, the watchdog, a turn end of the spawner and the sweep', async () => {
    const { w, id } = await asked(); await stop(w.h, 'by you'); await watchdog(w.h); await w.turn(); await w.stop('ag1', 'error'); await w.stop('ag1', 'answer', 'text'); await continueRun(w.h); await backstop(w.h, 's1')
    const r = await w.h.spawnAgent({ prompt: await intend(w.h, id, 'worker', 's1'), description: 'worker' }); expect(r.deny).toContain('running')   // admission's rebind never takes the step of a waiting run
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'need', needId: 'n1' }); expect((await w.h.bind.read()).ag1).toBeDefined()
  })
  test('an unrelated resume leaves the wait; a stale answer is dropped by its key', async () => {
    const { w } = await asked(); await step(w.h, 'ag1', { type: 'resume', text: 'review findings' }); const e = (await runOf(w.h, 'ag1'))!.epoch; await step(w.h, 'ag1', { type: 'answered', needId: 'n1', epoch: e - 1, text: 'old run' }); await step(w.h, 'ag1', { type: 'answered', needId: 'n7', epoch: e, text: 'other need' })
    expect((await runOf(w.h, 'ag1'))?.state).toMatchObject({ state: 'waiting' }); expect(w.sent).toEqual([])
  })
})

describe('a setup request: the requester sends the install command, cadre vets it and runs it itself (no helper)', () => {
  const SETUP = (argv?: unknown) => ({ ...REQ, request: { helper: 'setup', ask: 'add left-pad', why: 'I need it', ...(argv === undefined ? {} : { argv }) } })
  test('a refused or missing argv goes back to its sender at once with the allowed forms: nothing recorded, no wait, no helper', async () => {
    const { w, id } = await start()
    for (const argv of [['sudo', 'npm', 'install', 'left-pad'], ['npm', 'install', '-g', 'left-pad'], undefined]) {
      const r = await w.rep('ag1', SETUP(argv)); expect(r).toContain('request.argv:'); expect(r).toContain(`allowed: ${FORMS}`)
    }
    for (const argv of [['pnpm', 'ci'], ['python', '-m', 'pip', 'install', 'x']]) { const x = await start(); expect(await x.w.rep('ag1', SETUP(argv))).toContain(`allowed: ${FORMS}`); expect(await needOf(x.w.h, x.id)).toBeUndefined() }
    expect(await w.rep('ag1', { ...REQ, request: { ...REQ.request, argv: ['npm', 'ci'] } })).toContain('request.argv: only a setup request has one')
  })
  test('every form the text names passes vet, and the ones it does not name are refused', () => {
    const py = { py: '/usr/bin/python3' }
    for (const f of [['npm', 'install', 'x'], ['npm', 'add', 'x'], ['npm', 'ci'], ['pnpm', 'install', 'x'], ['pnpm', 'add', 'x'], ['yarn', 'install', 'x'], ['yarn', 'add', 'x'], ['uv', 'add', 'x'], ['uv', 'pip', 'install', 'x'], ['cargo', 'add', 'x'], ['go', 'get', 'github.com/a/b']]) expect(typeof vet(f, '/w', py)).toBe('object')
    for (const f of [['pnpm', 'ci'], ['yarn', 'ci'], ['pip', 'install', 'x'], ['python', '-m', 'pip', 'install', 'x']]) expect(typeof vet(f, '/w', py)).toBe('string')
    expect(FORMS).toBe('npm install, add or ci; pnpm or yarn install or add; uv add or uv pip install; cargo add; go get')
  })
  test('a good argv: the requester waits, no helper starts; the frame only claims the install, which runs detached and then resumes the requester (here: the repo is not approved: one dialog, ok false)', async () => {
    const { w, id, later, flush } = await start(); expect(await w.rep('ag1', SETUP(['npm', 'install', 'left-pad']))).toMatch(/^request recorded; the install runs/)
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'need', needId: 'n1' }); expect(await needOf(w.h, id)).toMatchObject({ helper: 'setup', argv: ['npm', 'install', 'left-pad'] })
    await w.turn(); expect(types(w)).toEqual(['cadre:worker'])   // never a helper
    expect((await needOf(w.h, id))?.running).toEqual(expect.any(Number)); expect((await needOf(w.h, id))?.answer).toBeUndefined(); expect(later.length).toBe(1); expect(w.sent).toEqual([])   // claimed, not run in the frame
    await flush(); expect(w.sent).toHaveLength(1); expect(w.sent[0][0]).toBe('ag1'); expect(w.sent[0][1]).toContain('waits for the user'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'running' })
    expect((await w.h.board.read()).decisions?.map(d => d.id)).toEqual([`deps:${id}:n1`]); expect((await events(w, 'help.done')).map(e => e.data.ok)).toEqual([false]); expect(await needOf(w.h, id)).toMatchObject({ ok: false, delivered: true })
  })
  test('settings: deps.auto false: the install is not run, the requester is told, ok false, and the human gets exactly one dialog', async () => {
    const { w, id, flush } = await start(); w.cfg.deps.auto = false; await w.rep('ag1', SETUP(['npm', 'install', 'left-pad'])); await w.turn(); await flush()
    expect(w.sent[0][1]).toContain('waits for the user'); expect((await w.h.board.read()).decisions?.map(d => d.id)).toEqual([`deps:${id}:n1`]); expect(types(w)).toEqual(['cadre:worker']); expect((await events(w, 'help.done')).map(e => e.data.ok)).toEqual([false])
  })
  test('one run per request: a second frame (or process) finds it claimed and runs nothing; an expired claim is taken again; an answered one never runs', async () => {
    const { w, id, later, flush } = await start(); w.cfg.deps.auto = false; await w.rep('ag1', SETUP(['npm', 'install', 'left-pad']))
    await w.turn(); await w.turn(); await w.turn(); expect(later.length).toBe(1)   // three frames, one claim
    w.clock.now += 31 * 60_000; await w.turn(); expect(later.length).toBe(2)   // the first run died: its claim is old
    await flush(); expect(w.sent).toHaveLength(1)   // the first to answer wins; the other changes nothing
    expect(await needOf(w.h, id)).toMatchObject({ ok: false }); await w.turn(); expect(later.length).toBe(0)   // answered: nothing more
  })
})

describe('every helper ends and answers exactly once', () => {
  const once = async (w: World, id: string, stops: string[], helpers: string[]) => {
    expect(await events(w, 'help.done')).toHaveLength(1); expect(stops).toEqual(helpers); expect(w.sent).toHaveLength(1); expect(w.sent[0][1]).toContain('could not answer'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'running' })
    expect((await needOf(w.h, id))).toMatchObject({ ok: false, delivered: true })
    expect((await w.h.board.read()).decisions?.map(d => d.id)).toEqual([`help:${id}:n1`])   // the second failure: one dialog
  }
  test('a helper that stops without a report (also at its turn cap): the first failure respawns it once, the second answers failed with one dialog', async () => {
    const { w, id, stops } = await asked(); await w.stop('ag2'); expect(stops).toEqual(['ag2']); expect(await w.state('ag2', id)).toEqual({ state: 'ended', cause: 'lost' }); expect(w.sent).toEqual([]); expect((await w.h.board.read()).decisions ?? []).toEqual([])
    await w.turn(); expect(types(w)).toEqual(['cadre:worker', 'cadre:explorer', 'cadre:explorer']); await w.stop('ag3'); await once(w, id, stops, ['ag2', 'ag3'])
  })
  test('a helper that repeats one call is stopped and fails the same way', async () => {
    const { w, id, stops } = await asked()
    for (let i = 0; i < 20; i++) await step(w.h, 'ag2', { type: 'call', tool: 'Read', sig: 'a' }); await w.stop('ag2'); await w.turn(); for (let i = 0; i < 20; i++) await step(w.h, 'ag3', { type: 'call', tool: 'Read', sig: 'a' }); await w.stop('ag3'); await once(w, id, stops, ['ag2', 'ag3'])
  })
  test('settings: limits.helpers.minutes: a helper past its minutes fails (the tick); one inside them does not', async () => {
    const { w, id, stops } = await asked(); w.cfg.limits.helpers.minutes = 1; w.clock.now += 30_000; await overdue(w.h, 's1'); expect(stops).toEqual([])
    w.clock.now += 40_000; await overdue(w.h, 's1'); expect(stops).toEqual(['ag2']); await w.turn(); w.clock.now += 61_000; await overdue(w.h, 's1'); await w.stop('ag3'); await once(w, id, stops, ['ag2', 'ag3'])
    await overdue(w.h, 's1'); expect(await events(w, 'help.done')).toHaveLength(1)   // the tick again: nothing left to fail
  })
  test('a report after the helper was answered failed is not an answer; a usage limit is not a failure', async () => {
    const { w, id } = await asked(); Object.assign(w.h, { usage: async () => ({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(w.clock.now + 3_600_000).toISOString() }] }) })
    await w.stop('ag2', 'error', 'API Error'); expect((await needOf(w.h, id))).toMatchObject({ fails: 0 }); expect(await events(w, 'help.done')).toHaveLength(0); expect((await pending(w.h)).start).toEqual([id])   // it starts again when the drive goes on
  })
})

describe('review fixes', () => {
  test('a planner asks explore: its helper reports (its task is an epic), and the planner is resumed', async () => {
    const { w } = await start(); const e = w.epic
    await step(w.h, 'pl1', { type: 'spawn.ok', bind: { taskId: e, role: 'planner', step: 'planner', worktree: '/r', sessionId: 's1', ctxTokens: 0, startedAt: 0 } })
    expect(await w.rep('pl1', { role: 'planner', outcome: 'request', request: { helper: 'explore', ask: 'where is X?', why: 'to plan' } })).toMatch(/^request recorded/)
    await w.turn(); const h = w.spawned.findIndex(x => x[2] === 'cadre:explorer'); expect(h).toBeGreaterThan(0)
    expect(await w.rep(`ag${h + 1}`, ANSWER)).toBe('answer recorded. Stop.')
    await w.stop(`ag${h + 1}`); expect(w.sent.some(x => x[0] === 'pl1' && x[1].includes('in src/parse.ts'))).toBe(true); expect((await runOf(w.h, 'pl1'))?.state).toEqual({ state: 'running' })
  })
  test('a helper that reported but never ends its turn is stopped past the minutes cap, with no new answer', async () => {
    const { w, stops } = await asked(); await w.rep('ag2', ANSWER); w.cfg.limits.helpers.minutes = 1; w.clock.now += 70_000; await overdue(w.h, 's1')
    expect(stops).toEqual(['ag2']); expect(await w.state('ag2')).toEqual({ state: 'ended', cause: 'done' }); expect(await events(w, 'help.done')).toHaveLength(1)
  })
  test('a requester that reports while waiting is refused until the answer comes', async () => {
    const { w } = await asked(); expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('wait for the answer to your request')
    expect((await runOf(w.h, 'ag1'))?.state).toMatchObject({ state: 'waiting' })
  })
  test('a task whose claim is still starting is not offered its step by a second frame', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await w.store.claim(id, w.dep.actor); await w.store.setMeta(id, { 'cadre.step': 'worker', 'cadre.worktree': `/wt/${id}`, 'cadre.branch': `docs/${id}`, 'cadre.base': 'base000' }, w.dep.actor)
    await w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => ({ ...t, state: 'active', step: 'worker', owner: w.dep.actor })) }))
    const sa = w.h.spawnAgent, tried: string[] = []; w.h.spawnAgent = (x: any) => (tried.push(x.description), sa(x))   // an attempt is a pick, whatever admission answers
    hold({ id, role: 'claim' }); try { await w.turn(); expect(tried).toEqual([]) } finally { drop(id, 'claim') }
    await w.turn(); expect(tried).toEqual([`worker ${id}`])   // the claim is done: the step is offered
  })
})

describe('one settle per request', () => {
  test('a report and the minutes failure at once: one answer, one help.done, no respawn, no dialog; and the other way round', async () => {
    for (const reportFirst of [true, false]) {
      const { w, id, stops } = await asked(); w.cfg.limits.helpers.minutes = 1; w.clock.now += 70_000
      const rep = () => w.rep('ag2', ANSWER), tick = () => overdue(w.h, 's1'), both = reportFirst ? [rep(), tick()] : [tick(), rep()]; await Promise.all(both)
      await w.stop('ag2'); await w.turn()
      const n = await needOf(w.h, id); expect(await events(w, 'help.done')).toHaveLength(1); expect(n?.answer).toBeDefined(); expect(types(w)).toEqual(['cadre:worker', 'cadre:explorer']); expect(w.sent).toHaveLength(1)
      expect((await w.h.board.read()).decisions ?? []).toEqual([]); expect(n?.ok).toBe(true); void stops
    }
  })
  test('a failure after the answer is a no-op, and an answer after the second failure is dropped', async () => {
    const { w, id, stops } = await asked(); await w.rep('ag2', ANSWER); w.cfg.limits.helpers.minutes = 1; w.clock.now += 70_000; await overdue(w.h, 's1'); expect(stops).toEqual(['ag2']); expect(await events(w, 'help.done')).toHaveLength(1)   // it only ends: no new answer
    expect((await needOf(w.h, id))?.ok).toBe(true)
  })
})

describe('refused requests', () => {
  test('a helper outside the role\'s canRequest, one that is not available, over the cap (settings: limits.helpers.perTask), and a session where Claude starts the agents', async () => {
    const { w, id } = await start(); const ask = (helper: string) => w.rep('ag1', { ...REQ, request: { ...REQ.request, helper } })
    expect(await ask('probe')).toContain('error: request.helper: you may ask for explore or setup')
    w.cfg.limits.helpers.perTask = 1; await w.rep('ag1', REQ); await w.turn(); await w.rep('ag2', ANSWER); await w.stop('ag2')
    expect(await w.rep('ag1', REQ)).toContain('this task has used its 1 requests'); w.cfg.limits.helpers.perTask = 2; expect(await w.rep('ag1', REQ)).toMatch(/^request recorded/); expect((await needOf(w.h, id))?.n).toBe(2)
    const m = await world({ mode: 'main' }); await m.at('ag1', m.ids[0], 'worker'); expect(await m.rep('ag1', REQ)).toContain('nobody can answer a request now')
    expect(await w.rep('ag1', { ...REQ, outcome: 'done' })).toContain('request: only with outcome request')
  })
  test('a request without its request, and a reviewer\'s: refused by the contract', async () => {
    const { w } = await start(); expect(await w.rep('ag1', { role: 'worker', outcome: 'request', summary: 's' })).toContain('request: required with outcome request')
    expect(await w.rep('ag1', { role: 'reviewer', outcome: 'request' })).toContain('error:')
  })
})

describe('the task goes away: helpers stopped, no answer, no respawn, the record pruned', () => {
  test('a cancel stops the helper and ends the wait; nothing is answered or respawned', async () => {
    const { w, id, stops } = await asked(); expect(await LIFECYCLE.deleted(w.h, id, { metadata: { reason: 'no' } })).toBeNull()
    expect(stops).toContain('ag2'); expect(await needOf(w.h, id)).toBeUndefined(); expect((await w.h.bind.read()).ag1).toBeUndefined(); expect((await w.h.bind.read()).ag2).toBeUndefined()
    await w.stop('ag2'); await w.turn(); expect(types(w)).toEqual(['cadre:worker', 'cadre:explorer']); expect(await events(w, 'help.done')).toHaveLength(0); expect(w.sent).toEqual([])
  })
})

describe('process death between the answer and its delivery', () => {
  const die = async (w: World) => { await w.h.bind.update(() => ({})); await w.h.ui.update(u => ({ ...u, runs: {} })) }   // a new process: no binding, no live run; the store keeps the need and the run mirrors
  test('the helper had answered: /cadre continue rebinds the requester with the answer, once', async () => {
    const { w, id } = await asked(); await w.rep('ag2', ANSWER)   // answered, never sent
    expect(await undelivered(w.h, id)).toContain('in src/parse.ts'); await die(w)
    await continueRun(w.h); w.spawned.length = 0; await w.turn()
    expect(types(w)).toEqual(['cadre:worker']); expect(w.spawned[0][1]).toContain('in src/parse.ts'); expect(await undelivered(w.h, id)).toBeUndefined()
    await step(w.h, 'ag3', { type: 'end', cause: 'released', reason: 'x' }); await die(w); await continueRun(w.h); w.spawned.length = 0; await w.turn()
    expect(types(w)).toEqual(['cadre:worker']); expect(w.spawned[0][1]).not.toContain('in src/parse.ts')   // never twice
  })
  test('the helper had not answered: it starts again and the requester waits for it', async () => {
    const { w, id } = await asked(); await die(w); expect((await pending(w.h)).start).toEqual([id])
    await continueRun(w.h); w.spawned.length = 0; await w.turn(); expect(types(w)).toEqual(['cadre:explorer']); expect((await needOf(w.h, id))).toMatchObject({ fails: 0 }); expect((await w.h.bind.read()).ag3).toMatchObject({ parent: 'ag1', needId: 'n1' })
  })
})

describe('defaults', () => {
  test('canRequest: worker and tester explore and setup, planner explore and probe, the rest nothing', async () => {
    const R = ROLES_DEFAULT
    expect([R.worker, R.tester, R.planner, R.reviewer, R.explorer].map(r => r.canRequest ?? [])).toEqual([['explore', 'setup'], ['explore', 'setup'], ['explore', 'probe'], [], []])
  })
})
