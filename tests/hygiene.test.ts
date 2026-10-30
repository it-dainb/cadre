// Lifecycle hygiene (ADR 0024 B2, B6): the stall timers fire once, one dialog at most, a stale run is never replaced by itself; the stagnation cap bounds nudges with no tool call between.
import { describe, expect, test } from 'claude-code/testing'
import { world } from './fixtures/replay/world'
import { runOf, step } from '../core/lifecycle'
import { stalls } from '../core/close'
import { guard } from '../policy/guards'
import { scoped } from '../commands/init'

const bound = async (w: any, a: string, id: string, f: object = {}, role: any = 'worker') => { await w.at(a, id, role); await w.h.bind.update((t: any) => ({ ...t, [a]: { ...t[a], startedAt: w.clock.now, ...f } })) }
const stops = (w: any) => { const s: string[] = []; Object.assign(w.h, { stopAgent: async (x: string) => { s.push(x) } }); return s }
const task = async (w: any, id: string) => (await w.h.board.read()).tasks.find((t: any) => t.id === id)

describe('stall timers', () => {
  test('settings: lifecycle.firstOutputSec: no model request since its start: the start failed, stopped once, its task released and counted; later ticks do nothing', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id)
    await stalls(w.h, 's1'); expect(s).toEqual([])
    w.clock.now += w.cfg.lifecycle.firstOutputSec * 1000 + 1000; await stalls(w.h, 's1'); await stalls(w.h, 's1')
    expect(s).toEqual(['ag1']); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'released' }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect(await task(w, id)).toMatchObject({ state: 'todo' }); expect(((await w.h.board.read()).decisions ?? [])).toEqual([])
  })
  test('an agent that has made a model request is not a first-output stall', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { lastAt: w.clock.now })
    w.clock.now += w.cfg.lifecycle.firstOutputSec * 1000 + 1000; await stalls(w.h, 's1'); expect(s).toEqual([])
  })
  test('settings: lifecycle.staleMin: no activity for that long: stopped once, the run is cancelled, the task blocks with one dialog and no replacement', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { lastAt: w.clock.now })
    w.clock.now += w.cfg.lifecycle.staleMin * 60_000 - 5000; await stalls(w.h, 's1'); expect(s).toEqual([])
    w.clock.now += 10_000; await stalls(w.h, 's1'); await stalls(w.h, 's1')
    expect(s).toEqual(['ag1']); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'cancelled' })
    expect(await task(w, id)).toMatchObject({ state: 'blocked', flags: ['stale'] }); expect((await w.h.bind.read()).ag1).toBeUndefined()
    expect((await w.h.board.read()).decisions!.length).toBe(1)
  })
  test('settings: lifecycle.goneSec: an agent of a session that is gone is released after that long, by any session, and not stopped here', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { sessionId: 'dead', lastAt: w.clock.now })
    w.clock.now += w.cfg.lifecycle.goneSec * 1000 - 5000; await stalls(w.h, 's1'); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'running' })
    w.clock.now += 10_000; await stalls(w.h, 's1')
    expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'released' }); expect(s).toEqual([]); expect(await task(w, id)).toMatchObject({ state: 'todo' })
  })
  test('a waiting run is never stalled', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id); await step(w.h, 'ag1', { type: 'report.ok', wait: true })
    w.clock.now += 3 * 3600_000; await stalls(w.h, 's1'); expect(s).toEqual([]); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'waiting', on: 'decision' })
  })
  test('a planner is never stalled', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, {}, 'planner')
    w.clock.now += 3 * 3600_000; await stalls(w.h, 's1'); expect(s).toEqual([])
  })
  test('an agent of another live session is left to that session', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { sessionId: 'other' })
    w.clock.now += 3 * 3600_000; await w.h.store.set(await scoped(w.h, 'alive'), { other: { p: 'other-process', at: w.clock.now } }); await stalls(w.h, 's1')
    expect(s).toEqual([]); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'running' })
  })
  test('a wake is a sign of life: a reused agent resumed after a long idle is not stale-killed', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { lastAt: w.clock.now }); await step(w.h, 'ag1', { type: 'report.ok' })
    w.clock.now += w.cfg.lifecycle.staleMin * 60_000 * 2; await step(w.h, 'ag1', { type: 'resume', text: 'findings' })
    await stalls(w.h, 's1'); expect(s).toEqual([]); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'running' })
  })
  test('a tool call is a sign of life, and one that has not returned holds the stale clock (a long test run is work) until 4x staleMin', async () => {
    const w = await world(), [id] = w.ids, s = stops(w), min = w.cfg.lifecycle.staleMin * 60_000; await bound(w, 'ag1', id, { lastAt: w.clock.now })
    await guard(w.h, { tool: 'Read', agentId: 'ag1', input: { file_path: 'a' } }, async (e: any) => e)   // the guard's call event stamps lastAt and opens the call
    const b = (await w.h.bind.read()).ag1; expect([b.lastAt! > 0, b.openAt === b.lastAt]).toEqual([true, true])
    w.clock.now += min * 2; await stalls(w.h, 's1'); expect(s).toEqual([])   // 90 minutes inside one call
    w.clock.now += min * 2.5; await stalls(w.h, 's1'); expect(s).toEqual(['ag1'])   // past 4x: a call that never returns does not hold it forever
  })
  test('two ticks at once raise one dialog and one stop', async () => {
    const w = await world(), [id] = w.ids, s = stops(w); await bound(w, 'ag1', id, { lastAt: w.clock.now })
    w.clock.now += w.cfg.lifecycle.staleMin * 60_000 + 5000; await Promise.all([stalls(w.h, 's1'), stalls(w.h, 's1')])
    expect(s).toEqual(['ag1']); expect((await w.h.board.read()).decisions!.length).toBe(1)
  })
})

describe('stagnation cap', () => {
  test('settings: limits.stagnantNudges: nudges with no tool call between them stop at the cap and block the task; a tool call in between starts the count again', async () => {
    const w = await world(), [id] = w.ids; w.cfg.limits.nudges = 10; w.cfg.limits.stagnantNudges = 2; await w.at('ag1', id, 'worker')
    await w.stop('ag1'); await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'silent', n: 2 })
    await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))!.state).toEqual({ state: 'ended', cause: 'blocked' }); expect(await task(w, id)).toMatchObject({ state: 'blocked', flags: ['stagnant'] })
    const v = await world(), [j] = v.ids; v.cfg.limits.nudges = 10; v.cfg.limits.stagnantNudges = 2; await v.at('ag1', j, 'worker')
    for (let i = 0; i < 5; i++) { await step(v.h, 'ag1', { type: 'call', tool: 'Read', sig: `r${i}` }); await v.stop('ag1') }
    expect((await runOf(v.h, 'ag1'))!.state).toEqual({ state: 'silent', n: 5 }); expect(await task(v, j)).toMatchObject({ state: 'active' })
  })
})
