// Engine-exit safety (plan 0.14 §4, rules 1-5): an agent can always end, cadre bounds every loop, and once an agent is done cadre ends its run itself.
import { describe, expect, test } from 'claude-code/testing'
import { PASS, world } from './fixtures/replay/world'
import { EXIT, guard, judge } from '../policy/guards'
import { denyCall } from '../hooks/register'
import { BACKSTOP, REPEAT, backstop, exitStep, pruneRuns, runOf, step } from '../core/lifecycle'
import { stopped } from '../core/close'
import { arm } from '../core/drive'
import { machine } from '../commands/doctor'
import { BUDGET } from './fixtures/budget.generated'

const call = (w: { h: any }, agentId: string | undefined, tool: string, input: object = {}) => guard(w.h, { tool, agentId, input, ...input }, async (e: any) => e) as Promise<any>
// drive a turn.step generator: its chunks, its result, and whether it asked the model (next)
async function stepOf(h: any, e: object) {
  let asked = 0; const chunks: any[] = [], g = exitStep(h, { turnId: 't', index: 3, ...e }, async function* () { asked++; return { answer: 'model', usage: { input_tokens: 9 } } })
  let r = await g.next(); while (!r.done) { chunks.push(r.value); r = await g.next() }
  return { asked, chunks, result: r.value }
}
const bindAuto = async (w: any, a: string, id: string) => { await w.at(a, id, 'worker'); await step(w.h, a, { type: 'spawn.ok', mode: 'auto', bind: (await w.h.bind.read())[a] }) }   // spawned under auto mode

describe('rule 1: engine exit tools are never refused', () => {
  test('every guard path lets them through: the guard (main, an agent that owes its report, an unknown agent), the re-entry judge, the failure path', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    for (const tool of EXIT) for (const a of [undefined, 'ag1', 'stranger']) expect((await call(w, a, tool, { input: { message: 'x' } })).deny).toBeUndefined()
    expect((await call(w, 'ag1', 'SubagentHandback', { message: 'my long prose' })).message).not.toContain('prose')   // main never reads it
    for (const tool of EXIT) { expect(judge({ tool, agentId: 'ag1' })).toBeUndefined(); expect(judge({ tool })).toBeUndefined() }
    const next = Object.assign((e: any) => ({ passed: e.tool }), { called: false, error: { kind: 'thrown', message: 'boom' } }), $ = { ui: { log: () => {} } }
    for (const tool of EXIT) expect(denyCall($, { tool, agentId: 'ag1' }, next)).toEqual({ passed: tool })
    expect(denyCall($, { tool: 'Read', agentId: 'ag1' }, next).deny).toBeDefined()   // anything else still fails closed
  })
  test('no built-in agent file disallows one', () => {
    for (const [role, text] of Object.entries(BUDGET.agents)) for (const tool of EXIT) expect(`${role}: ${(String(text).match(/^disallowedTools:.*$/m) ?? [''])[0]}`).not.toContain(tool)
  })
})

describe('rule 2: an agent can always end, on every exit path', () => {
  const roles = [['worker', 'docs'], ['tester', 'feature'], ['reviewer', 'docs'], ['explorer', 'spike']] as const
  for (const [role, type] of roles) for (const path of ['no report', 'aborted', 'API error'] as const) test(`${role}, ${path}: one terminal state`, async () => {
    const w = await world({ type }), [id] = w.ids; await w.at('ag1', id, role)
    expect((await call(w, 'ag1', 'SubagentHandback', { message: 'done' })).deny).toBeUndefined()   // the hand-back passes on every path
    if (path === 'no report') for (let i = 0; i <= w.cfg.limits.nudges; i++) await w.stop('ag1')
    else await stopped(w.h, w.dep, { agentId: 'ag1', reason: path === 'aborted' ? 'aborted' : 'error' })
    const s = (await runOf(w.h, 'ag1'))!.state!
    expect(['idle-bound', 'ended'].includes(s.state)).toBe(true)   // handed in (auto-reported) or over; never still owing
  })
})

describe('rule 3: a tool first seen is journaled; an unknown one is noted for Doctor, judged as before', () => {
  test('one journal entry and one Doctor row, the same verdict', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker'); await w.h.bind.update(b => ({ ...b, plain: b.ag1 }))   // plain: bound, no run record
    const v1 = (await call(w, 'ag1', 'Weird')).deny, v2 = (await call(w, 'ag1', 'Weird')).deny, v0 = (await call(w, 'plain', 'Weird')).deny
    expect(v1).toBeDefined(); expect(v2).toBe(v1); expect(v0).toBe(v1)
    expect((await runOf(w.h, 'ag1'))!.log.filter(x => x.event === 'call Weird')).toHaveLength(1)
    expect(w.kv.get(`cadre:${w.dep.key}:injected`)).toEqual(['Weird'])
    const rows = (await machine(w.h, w.cfg)).rows.filter(r => r[1].includes('Weird')); expect(rows).toHaveLength(1); expect(rows[0][0]).toBe('warn')
    await call(w, 'ag1', 'Read', { input: { file_path: '/wt/x' } }); expect(w.kv.get(`cadre:${w.dep.key}:injected`)).toEqual(['Weird'])   // its role's own tool: not noted
  })
})

describe('rule 4: the repeat-call breaker', () => {
  test(`the same call ${REPEAT} times in a row (key order ignored) is refused, the run is spent and ends; its task blocks with one dialog`, async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await w.at('ag1', id, 'worker')
    const args = (k: number) => (k % 2 ? { input: { file_path: '/wt/a', limit: 5 } } : { input: { limit: 5, file_path: '/wt/a' } })
    for (let k = 1; k < REPEAT; k++) expect((await call(w, 'ag1', 'Read', args(k))).deny ?? '').not.toContain('same call')
    expect((await call(w, 'ag1', 'Read', args(0))).deny).toContain('same call'); expect((await runOf(w.h, 'ag1'))!.exit).toBe('loop')
    const s = await stepOf(w.h, { agentId: 'ag1' }); expect(s.asked).toBe(0)   // spent: cadre ends it at its next step
    await w.stop('ag1')
    expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'blocked' }); expect((await w.h.board.read()).tasks[0].flags).toContain('loop')
    expect(((await w.h.board.read()).decisions ?? []).filter(d => d.id.includes(id)).map(d => d.id)).toEqual([`flag:${id}:loop`])
  })
  test('a different call in between starts the count again', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    for (let k = 0; k < REPEAT * 2; k++) await call(w, 'ag1', 'Read', { input: { file_path: k % 3 ? '/wt/a' : '/wt/b' } })
    expect((await runOf(w.h, 'ag1'))!.exit).toBeUndefined()
  })
})

describe('rule 5: forced clean exit, and the backstop', () => {
  test('reported: cadre answers the next request itself, zero tokens; auto mode with a hand-back, any other mode with end_turn', async () => {
    const w = await world({ n: 2 }), [a, b] = w.ids; await bindAuto(w, 'ag1', a); await w.at('ag2', b, 'worker')
    for (const x of ['ag1', 'ag2']) expect(await w.rep(x, { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
    const auto = await stepOf(w.h, { agentId: 'ag1' }), other = await stepOf(w.h, { agentId: 'ag2' })
    expect([auto.asked, other.asked]).toEqual([0, 0])
    expect(auto.chunks.map(c => c.kind)).toEqual(['text', 'tool', 'input', 'stop']); expect(auto.chunks[1].name).toBe('SubagentHandback'); expect(auto.result).toMatchObject({ stopReason: 'tool_use', usage: null })
    expect(other.chunks.map(c => c.kind)).toEqual(['text', 'stop']); expect(other.result).toMatchObject({ stopReason: 'end_turn', toolUses: [], usage: null })
    expect(auto.chunks.filter(c => c.kind === 'stop')).toHaveLength(1)   // one answer: its turn ends once
  })
  test('a refused report never forces it: the model is asked and a retry still runs', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done' })).toMatch(/^error: /)
    expect((await stepOf(w.h, { agentId: 'ag1' })).asked).toBe(1)
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
    expect((await stepOf(w.h, { agentId: 'ag1' })).asked).toBe(0)
  })
  test('main and agents still at work are never answered for', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect((await stepOf(w.h, {})).asked).toBe(1); expect((await stepOf(w.h, { agentId: 'ag1' })).asked).toBe(1); expect((await stepOf(w.h, { agentId: 'ask-x' })).asked).toBe(1)
  })
  test(`backstop: a forced exit no turn end ended within ${BACKSTOP / 1000} s is stopped once, ends lost, one dialog; one that ended is left alone`, async () => {
    const w = await world({ n: 2 }), [a, b] = w.ids, stops: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { stops.push(x) } })
    await arm(w.h, 'auto'); await w.at('ag1', a, 'worker'); await w.at('ag2', b, 'worker')
    for (const x of ['ag1', 'ag2']) { await w.rep(x, { role: 'worker', outcome: 'done', summary: 'did it' }); await stepOf(w.h, { agentId: x }) }
    await w.stop('ag2')   // its turn ended: the backstop stands down
    await backstop(w.h, 's1'); expect(stops).toEqual([])   // not yet
    w.clock.now += BACKSTOP + 1000; await backstop(w.h, 's1'); await backstop(w.h, 's1')
    expect(stops).toEqual(['ag1']); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'lost' }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect(((await w.h.board.read()).decisions ?? []).map(d => d.id)).toEqual(['stalled:ag1'])
    expect((await runOf(w.h, 'ag2'))!.state).toEqual({ state: 'idle-bound' })
  })
  test('the deadline is on the run record: after a /clear the tick still finds it', async () => {
    const w = await world(), [id] = w.ids, stops: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { stops.push(x) } })
    await w.at('ag1', id, 'worker'); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await stepOf(w.h, { agentId: 'ag1' })
    await w.h.ui.update(() => ({})); w.clock.now += BACKSTOP + 1000; await backstop(w.h, 's1'); expect(stops).toEqual(['ag1'])
  })
  test('an explorer whose answer ended its run is answered for too, and the reviewer after its verdict', async () => {
    const x = await world({ type: 'spike' }); await x.at('ag1', x.ids[0], 'explorer'); await x.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3', citations: [] })
    expect((await stepOf(x.h, { agentId: 'ag1' })).asked).toBe(0)
    const w = await world(); await arm(w.h, 'auto'); await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn()
    expect((await stepOf(w.h, { agentId: 'ag2' })).asked).toBe(1); await w.rep('ag2', PASS); expect((await stepOf(w.h, { agentId: 'ag2' })).asked).toBe(0)
  })
})

describe('review fixes: the backstop holds', () => {
  test('a forced reviewer whose task closes at once keeps its deadline: still answered for, still stopped by the backstop (pruning waits)', async () => {
    const w = await world(), stops: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { stops.push(x) } })
    await arm(w.h, 'auto'); await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn()
    await w.rep('ag2', PASS); expect((await stepOf(w.h, { agentId: 'ag2' })).asked).toBe(0)
    await w.turn(); expect((await w.h.board.read()).tasks[0].state).toBe('done')   // closed: its runs are pruned, but not the one the backstop watches
    expect((await stepOf(w.h, { agentId: 'ag2' })).asked).toBe(0)
    await pruneRuns(w.h, async () => false); w.clock.now += BACKSTOP + 1000; await backstop(w.h, 's1'); expect(stops).toEqual(['ag2'])
  })
  test('an ended run (an explorer that answered): one TaskStop and one dialog per deadline, however many ticks', async () => {
    const w = await world({ type: 'spike' }), stops: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { stops.push(x) } })
    await w.at('ag1', w.ids[0], 'explorer'); await w.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3', citations: [] }); await stepOf(w.h, { agentId: 'ag1' })
    w.clock.now += BACKSTOP + 1000; for (let i = 0; i < 4; i++) await backstop(w.h, 's1')
    expect(stops).toEqual(['ag1']); expect(((await w.h.board.read()).decisions ?? []).map(d => d.id)).toEqual(['stalled:ag1'])
    await w.h.board.update(b => ({ ...b, decisions: [] })); await backstop(w.h, 's1'); expect((await w.h.board.read()).decisions).toEqual([])   // the OK is not undone
  })
  test('a run of an earlier session (TaskStop: not running here): it ends lost quietly, no "did not stop" dialog, the deadline is gone', async () => {
    const w = await world(), [id] = w.ids, stops: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { stops.push(x); throw new Error(`Task ${x} is not running`) } })
    await w.at('ag1', id, 'worker'); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await stepOf(w.h, { agentId: 'ag1' })
    w.clock.now += BACKSTOP + 1000; await backstop(w.h, 's1'); await backstop(w.h, 's1')
    expect(stops).toEqual(['ag1']); expect((await runOf(w.h, 'ag1'))!.deadline).toBeUndefined(); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'lost' })
    expect((await w.h.board.read()).decisions ?? []).toEqual([])
  })
  test('the failure path rewrites the hand-back too: main never reads the agent\'s prose', () => {
    const next = Object.assign((e: any) => e, { called: false, error: { kind: 'thrown', message: 'boom' } })
    expect(denyCall({ ui: { log: () => {} } }, { tool: 'SubagentHandback', agentId: 'ag1', message: 'my long prose' }, next).message).not.toContain('prose')
  })
})
