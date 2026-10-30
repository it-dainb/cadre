// One budget per task (core/lifecycle, ADR 0024 §2.5): it only grows across agents and recoveries; the human's Retry resets only its own counter; a drive
// resume resets the drive's bounds, never the task's budget; a usage-limit stop charges nothing.
import { describe, expect, test } from 'claude-code/testing'
import { budgetOf, charge, retry } from '../core/lifecycle'
import { arm, resume, stop } from '../core/drive'
import { stopped } from '../core/close'
import { admitWith } from '../core/admission'
import { world } from './fixtures/replay/world'

describe('the task budget', () => {
  test('monotonic: silent runs add up across agents of the task, and nothing lowers them', async () => {
    const w = await world({ type: 'feature' }), [id] = w.ids, seen: number[] = []
    for (const a of ['ag1', 'ag2']) { await w.at(a, id, 'tester'); await stopped(w.h, w.dep, { agentId: a, reason: 'error' }); seen.push((await budgetOf(w.h, id)).silentRuns) }
    expect(seen).toEqual([1, 2])
  })
  test('human.retry{red} resets red only; the rebase Retry sets rebase only', async () => {
    const w = await world(), [id] = w.ids
    for (const k of ['red', 'red', 'rework', 'rebase', 'rebase', 'startFails', 'nudges'] as const) await charge(w.h, id, k)
    await retry(w.h, id, 'red'); expect(await budgetOf(w.h, id)).toEqual({ startFails: 1, silentRuns: 0, nudges: 1, refusals: 0, shapeRefusals: 0, red: 0, rework: 1, rebase: 2, epoch: 0 })
    await retry(w.h, id, 'rebase', 1); expect((await budgetOf(w.h, id)).rebase).toBe(1); expect((await budgetOf(w.h, id)).rework).toBe(1)
  })
  test('a Retry from another session re-reads the newest record: it resets its counter and keeps every other', async () => {
    const a = await world(), [id] = a.ids; await charge(a.h, id, 'red'); await charge(a.h, id, 'rework')
    const b = await world({ store: a.store, kv: a.kv, session: 's2' }); await retry(b.h, id, 'red')
    expect(await budgetOf(b.h, id)).toMatchObject({ red: 0, rework: 1 }); expect((await a.store.control()).doc[`budget:${id}`]).toMatchObject({ red: 0, rework: 1 })
  })
  test('drive resume resets the drive bounds and keeps the task budget', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await charge(w.h, id, 'rework'); await charge(w.h, id, 'silentRuns')
    await stop(w.h, 'stopped by you'); expect(await resume(w.h)).toBe('drive resumed')
    const d = (await w.h.board.read()).drive; expect(d.stopped).toBeUndefined(); expect(d.turns).toBeLessThanOrEqual(1)   // a fresh count: only the resume's own push
    expect(await budgetOf(w.h, id)).toMatchObject({ rework: 1, silentRuns: 1 })
  })
  test('a usage-limit stop charges nothing', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto'); await w.turn()
    Object.assign(w.h, { usage: async () => ({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }] }) })
    await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error', answer: 'API Error' })
    expect((await w.h.board.read()).tasks[0].state).toBe('todo'); const { epoch: _spawns, ...charged } = await budgetOf(w.h, id); expect(Object.values(charged).every(v => v === 0)).toBe(true)
  })
  test('a model the engine refuses at the spawn stops the run at once and names the cell', async () => {
    const w = await world(); await arm(w.h, 'auto')
    w.h.spawnAgent = (x: any) => admitWith(w.h, w.dep, { ...x, background: true }, Object.assign(async () => { throw new Error('There\'s an issue with the selected model (haiku-9). It may not exist or you may not have access to it.') }, { origin: { plugin: 'cadre' } }))
    await w.turn(); expect((await w.h.board.read()).drive.stopped).toBe('roles.worker.byRisk.standard.model: unknown model "haiku" (an alias, a claude-… id or a models.allow entry)')
  })
  test('a "not found" or "overloaded" error that is not about the model never stops the run at once', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'auto')
    for (const m of ['ENOENT: /x/models/a.json: not found', 'The model is overloaded; not available right now']) {
      w.h.spawnAgent = (x: any) => admitWith(w.h, w.dep, { ...x, background: true }, Object.assign(async () => { throw new Error(m) }, { origin: { plugin: 'cadre' } }))
      await w.turn(); expect((await w.h.board.read()).drive.stopped).toBeUndefined()
    }
    expect((await budgetOf(w.h, id)).startFails).toBe(2)
  })
  test('settings: limits.startFails 2 stops the run at the 2nd failed start of one task', async () => {
    const w = await world(), [id] = w.ids; w.cfg.limits.startFails = 2; await arm(w.h, 'auto')
    w.h.spawnAgent = (x: any) => admitWith(w.h, w.dep, { ...x, background: true }, Object.assign(async () => { throw new Error('engine down') }, { origin: { plugin: 'cadre' } }))
    await w.turn(); expect((await w.h.board.read()).drive.stopped).toBeUndefined(); expect((await budgetOf(w.h, id)).startFails).toBe(1)
    await w.turn(); expect((await w.h.board.read()).drive.stopped).toMatch(/could not start 2 times/)
  })
})
