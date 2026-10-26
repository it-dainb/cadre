// Keep on a stuck agent's dialog restarts the task (1.0 liveness): the same path as the shape Retry, a fresh agent on the next turn, the counter that blocked it reset.
import { describe, expect, test } from 'claude-code/testing'
import { world } from './fixtures/replay/world'
import { ROUTES } from '../core/dispatch'
import { charge, budgetOf, step } from '../core/lifecycle'
import { arm } from '../core/drive'
import { flagDecision, RESTART } from '../core/decide'
import '../core/close'

for (const flag of RESTART) describe(`Keep on ${flag}`, () => {
  test('the agent already ended: the task resumes, a fresh agent spawns, the drive runs', async () => {
    const w = await world(); const [id] = w.ids; await arm(w.h, 'auto'); await w.turn(); expect(w.spawned).toHaveLength(1)
    for (const k of ['silentRuns', 'nudges'] as const) for (let i = 0; i < 3; i++) await charge(w.h, id, k)
    await step(w.h, 'ag1', { type: 'end', cause: 'blocked', reason: 'stopped' })   // the agent ended for good
    await w.store.move(id, 'blocked', w.dep.actor); await w.store.setMeta(id, { 'cadre.blocked': flag }, w.dep.actor)
    await w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, state: 'blocked', owner: undefined, flags: [flag] } : t)) }))
    const o = flagDecision(id, flag)!.options; expect(o.map(x => x.label)).toEqual(['Keep going', 'Cancel task'])
    await ROUTES.resolve!(w.h, { cmd: 'resolve', args: [id, 'keep'] } as any)
    const t = (await w.h.board.read()).tasks.find(x => x.id === id)!; expect(t.state).not.toBe('blocked'); expect(t.flags).toEqual([])
    expect(await budgetOf(w.h, id)).toMatchObject({ silentRuns: 0, nudges: 0 })
    await w.turn(); expect(w.spawned.map(x => x[0])).toEqual(['ag1', 'ag2'])   // a fresh agent on the next turn
    expect((await w.h.board.read()).drive.on).toBe(true)
  })
})
