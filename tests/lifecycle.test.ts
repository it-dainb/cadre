// The run record (core/lifecycle): the pure next() as a state × event table, step() over $.state with its $.store mirror, and the invariants it carries so far.
import { describe, expect, test } from 'claude-code/testing'
import { next, runOf, step, type Run, type RunEvent, type RunState } from '../core/lifecycle'
import { RETRIES } from '../core/validate'
import { PASS, world } from './fixtures/replay/world'
import { arm } from '../core/drive'

const run = (state: RunState | null): Run => ({ taskId: 't1', role: 'worker', step: 'worker', state, epoch: 1, log: [] })
const S = {
  running: { state: 'running' }, refused: { state: 'refused', n: 1 }, silent: { state: 'silent', n: 1 }, idle: { state: 'idle-bound' }, waiting: { state: 'waiting', on: 'decision' },
  done: { state: 'ended', cause: 'done' },
} as const satisfies Record<string, RunState>
const E: Record<string, RunEvent> = { ok: { type: 'report.ok' }, park: { type: 'report.ok', wait: true }, refused: { type: 'report.refused' }, nudged: { type: 'turn.end' }, released: { type: 'end', cause: 'released' } }

describe('next(): state × event', () => {
  const want: Record<keyof typeof S, Record<string, RunState>> = {
    running: { ok: S.idle, park: S.waiting, refused: S.refused, nudged: S.silent, released: { state: 'ended', cause: 'released' } },
    refused: { ok: S.idle, park: S.waiting, refused: { state: 'refused', n: 2 }, nudged: S.silent, released: { state: 'ended', cause: 'released' } },
    silent: { ok: S.idle, park: S.waiting, refused: S.refused, nudged: { state: 'silent', n: 2 }, released: { state: 'ended', cause: 'released' } },
    idle: { ok: S.idle, park: S.waiting, refused: S.refused, nudged: S.silent, released: { state: 'ended', cause: 'released' } },
    waiting: { ok: S.waiting, park: S.waiting, refused: S.waiting, nudged: S.waiting, released: { state: 'ended', cause: 'released' } },   // invariant 2: parked until its end
    done: { ok: S.done, park: S.done, refused: S.done, nudged: S.done, released: S.done },   // terminal: nothing moves it
  }
  for (const [s, row] of Object.entries(want)) for (const [ev, to] of Object.entries(row))
    test(`${s} + ${ev} -> ${to.state}`, () => { const r = next(run(S[s as keyof typeof S]), E[ev]); expect(r.run.state).toEqual(to); expect(r.effects).toEqual([]) })
  test('spawn.ok starts a run on its task, the epoch counts the spawns of the agent', () => {
    const r = next(run(S.done), { type: 'spawn.ok', taskId: 't2', role: 'tester', step: 'tester' }).run
    expect(r).toMatchObject({ taskId: 't2', role: 'tester', step: 'tester', state: S.running, epoch: 2 })
  })
  test('a binding with no record ends lost and is unbound, whatever the event', () => {
    for (const e of Object.values(E)) expect(next(run(null), e)).toMatchObject({ run: { state: { state: 'ended', cause: 'lost' } }, effects: [{ kind: 'unbind', cause: 'lost' }] })
  })
  test('the log keeps the last 20 steps: state, event, cause', () => {
    let r = run(S.running); for (let i = 0; i < 25; i++) r = next(r, E.refused).run
    r = next(r, E.released).run
    expect(r.log).toHaveLength(20); expect(r.log.at(-1)).toEqual({ state: 'ended', event: 'end', cause: 'released' })
  })
})

describe('step(): the run record', () => {
  test('admission records the spawn; a report moves the run; the $.store mirror holds what $.state holds and survives /clear', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted')
    const key = `cadre:${w.dep.key}:run:ag1`, mirrored = w.kv.get(key) as Run
    expect(mirrored.state).toEqual({ state: 'idle-bound' }); expect(mirrored).toEqual(((await w.h.ui.read()).runs as Record<string, Run>).ag1)
    expect(mirrored.log.map(x => x.event)).toEqual(['spawn.ok', 'report.ok'])
    await w.h.ui.update(() => ({}))   // /clear
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'idle-bound' })
  })
  test('a blocked report parks the run for a decision; its turn end then nudges nothing', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'blocked', summary: 'stuck', reason: 'which format?' })).toContain('blocked recorded')
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'decision' })
    await w.stop('ag1'); expect(w.sent).toEqual([]); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'waiting', on: 'decision' })
  })
  test('a stop without a report is nudged (silent n); past the nudges a worker is auto-reported, a tester ends released', async () => {
    for (const [role, type, end] of [['worker', 'docs', { state: 'idle-bound' }], ['tester', 'feature', { state: 'ended', cause: 'released' }]] as const) {
      const w = await world({ type }), [id] = w.ids; await w.at('ag1', id, role)
      for (let i = 0; i < w.cfg.limits.nudges; i++) { await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'silent', n: i + 1 }) }
      await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual(end)
    }
  })
  test('a binding with no run record ends lost and is unbound at its next event', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.h.ui.update(u => ({ ...u, runs: {} })); w.kv.delete(`cadre:${w.dep.key}:run:ag1`)   // the record is gone (an older store)
    await step(w.h, 'ag1', { type: 'turn.end' })
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'lost' }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect(Object.values((await w.h.events.read()).epics).flat().some(e => e.type === 'agent.unbound' && e.data.reason === 'lost')).toBe(true)
  })
  test('an agent with neither a binding nor a record has no run', async () => {
    const w = await world(); expect(await step(w.h, 'stranger', { type: 'turn.end' })).toBeUndefined(); expect(await runOf(w.h, 'stranger')).toBeUndefined()
  })
  test('an explorer\'s answer ends its run done; a landed task prunes its agents\' records', async () => {
    const x = await world({ type: 'spike' }); await x.at('ag1', x.ids[0], 'explorer')
    expect(await x.rep('ag1', { role: 'explorer', answer: 'src/a.ts:3', citations: [] })).toContain('answer recorded'); expect((await runOf(x.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'done' })
    const w = await world(); await arm(w.h, 'auto'); await w.turn()
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted'); await w.turn()
    expect(await w.rep('ag2', PASS)).toContain('pass@'); expect((await runOf(w.h, 'ag2'))?.state).toEqual({ state: 'idle-bound' })
    await w.turn(); expect((await w.h.board.read()).tasks[0].state).toBe('done')
    for (const a of ['ag1', 'ag2']) { expect(await runOf(w.h, a)).toBeUndefined(); expect(w.kv.has(`cadre:${w.dep.key}:run:${a}`)).toBe(false) }
  })
})

describe('invariant 1: an agent can always end', () => {
  const states = ['running', 'silent', 'refused', 'idle', 'waiting', 'done'] as const
  for (const s of states) test(`hand-back from ${s}: passes, or within ${RETRIES} bounces`, async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.h.ui.update(u => ({ ...u, runs: { ag1: { ...((u.runs as any).ag1), state: S[s] } } }))
    let bounced = 0; while ((await w.hb('ag1')).deny) bounced++
    expect(bounced).toBe(s === 'running' || s === 'silent' ? RETRIES : 0)
  })
})
