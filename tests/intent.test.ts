// Spawn intent (ADR 0024 §2.6 invariant 5): the spawner records the start under a nonce, admission resolves it; a cadre start that does not resolve is refused,
// never an explorer; main's own Agent calls keep the id lookup. A claim is one intent record plus writes the next session start can finish or release.
import { describe, expect, test } from 'claude-code/testing'
import { world, type World } from './fixtures/replay/world'
import { admitWith } from '../core/admission'
import { arm } from '../core/drive'
import { intend, intentsOf, reserve } from '../core/lifecycle'
import { spawnable } from '../core/render'
import { modelView } from '../core/board'
import { askOf } from '../core/asks'
import { life, proc, quit, start } from '../core/session'
import { task } from './support'

const roles = (w: World) => w.spawned.map(x => x[2])

describe('the nonce', () => {
  test('the spawner\'s prompt is the nonce alone; the intent is gone once the start returns', async () => {
    const w = await world({ ids: ['my_proj-4.1'] }), asked: string[] = [], sp = w.h.spawnAgent; w.h.spawnAgent = (a: any) => (asked.push(a.prompt), sp(a)); await arm(w.h, 'auto'); await w.turn()
    expect(roles(w)).toEqual(['cadre:worker']); expect(asked).toHaveLength(1); expect(asked[0]).toMatch(/^run-[0-9a-f]+$/)   // no task id to parse; the agent gets the brief admission built
    expect(await intentsOf(w.h)).toEqual({})
  })
  test('a cadre start whose nonce does not resolve is refused with an error, never an explorer', async () => {
    const w = await world(); let asked = 0
    for (const prompt of ['run-0000', `TASK-${w.ids[0]}`, 'where is the parser?']) {
      const r = await admitWith(w.h, w.dep, { prompt, background: true }, Object.assign(async () => (asked++, { agentId: 'agX' }), { origin: { plugin: 'cadre' } }))
      expect(r.deny).toContain('no task behind it'); expect(await askOf(w.h, 'agX')).toBeUndefined()
    }
    expect(asked).toBe(0); expect(w.h.logs.filter(l => l.startsWith('spawn refused: no intent'))).toHaveLength(3)
  })
  test('main\'s own Agent call keeps the id lookup (main mode): the task\'s worker; a question is an explorer', async () => {
    const w = await world({ ids: ['my_proj-4.1'], mode: 'main' }), seen: string[] = [], main = Object.assign(async (e: any) => (seen.push(e.subagentType), { agentId: `ag${seen.length}` }), { origin: { plugin: 'engine' } })
    await admitWith(w.h, w.dep, { prompt: 'TASK-my_proj-4.1 write it', background: true }, main); await admitWith(w.h, w.dep, { prompt: 'where is the parser?', background: true }, main)
    expect(seen).toEqual(['cadre:worker', 'cadre:explorer'])
  })
  test('an intent for a task no longer on the board is refused', async () => {
    const w = await world(), n = await intend(w.h, 'gone-1', 'claim', 's1')
    expect((await admitWith(w.h, w.dep, { prompt: n, background: true }, w.cadre)).deny).toContain('no longer on the board')
  })
})

describe('two starts on one task', () => {
  test('a reservation is per step: two steps of one task both reserve; the same step twice does not', async () => {
    const w = await world(), [id] = w.ids
    expect(await reserve(w.h, id, 'tester', 's1')).toBe(true); expect(await reserve(w.h, id, 'reviewer', 's1')).toBe(true); expect(await reserve(w.h, id, 'tester', 's1')).toBe(false)
    expect(Object.keys(await w.h.bind.read()).sort()).toEqual([`~${id}:reviewer`, `~${id}:tester`])
  })
  test('another step\'s start in flight does not hide this step from the spawner', async () => {
    const w = await world(), [id] = w.ids; await reserve(w.h, id, 'reviewer', 's1')
    await w.h.board.update(s => ({ ...s, tasks: [task(id, { state: 'active', step: 'worker' })] }))
    expect(spawnable(modelView(await w.h.board.read()), await w.h.bind.read())).toEqual([{ id, role: 'worker' }])
  })
})

// a session dies in the middle of a claim: the write happens, then nothing after it runs (no undo, no intent cleanup)
const dead = () => new Promise<never>(() => {})
async function dies(kill: (w: World) => () => void) {
  const w1 = await world(); proc.id = 'P1'; await arm(w1.h, 'auto'); const revive = kill(w1); void w1.turn()
  for (let i = 0; i < 200 && !Object.keys(await intentsOf(w1.h)).length; i++) await new Promise(r => setTimeout(r, 0))
  for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 0))   // let it reach the write it dies after
  try { await quit(w1.h) } finally { life.ending = false }
  revive()   // the store is shared with the next session: its methods are the real ones again
  proc.id = 'P2'; const w2 = await world({ store: w1.store, kv: w1.kv, session: 's2' }); await start(w2.h)   // the next session starts
  return { w1, w2, id: w1.ids[0] }
}
describe('a claim cut short is finished or released by the next session start', () => {
  const points: [string, (w: World) => () => void][] = [
    ['after the store claim, before its step is written (the task would stay active with no step for good)', w => { const c = w.store.claim; w.store.claim = async (...x: Parameters<typeof c>) => { await c.apply(w.store, x); return dead() }; return () => { w.store.claim = c } }],
    ['after its step, base and worktree are written', w => { const s = w.store.setMeta; w.store.setMeta = async (id, m, a) => { await s.call(w.store, id, m, a); return m['cadre.step'] ? dead() : undefined }; return () => { w.store.setMeta = s } }],
    ['in the start itself', w => { w.h.spawnAgent = (a: any) => admitWith(w.h, w.dep, { ...a, background: true }, Object.assign(() => dead(), { origin: { plugin: 'cadre' } })); return () => {} }],
  ]
  for (const [when, kill] of points) test(`dies ${when}`, async () => {
    const { w1, w2, id } = await dies(kill)
    expect((await w1.store.get(id)).category).toBe('todo'); expect(await intentsOf(w2.h)).toEqual({})   // released, the intent settled
    await w2.h.board.update(s => ({ ...s, seq: 1, epic: w1.epic, plan: { id: w1.epic, slug: 'service', state: 'approved', epicBranch: 'epic/p1-service' }, tasks: [task(id, { type: 'docs' })] }))
    const r = await w2.h.spawnAgent({ prompt: await intend(w2.h, id, 'claim', 's2') })   // a fresh start claims it
    expect(r.agentId).toBe('ag1'); expect((await w2.h.bind.read()).ag1).toMatchObject({ taskId: id, step: 'worker', sessionId: 's2' })
  })
  test('a live session\'s start in flight is left alone', async () => {
    const w = await world(), [id] = w.ids; proc.id = 'P1'; await w.store.claim(id, w.dep.actor); await intend(w.h, id, 'claim', 's9')
    await w.h.store.set(`cadre:${w.dep.key}:alive`, { s9: { p: 'P9', at: w.clock.now + 1e9 } })   // s9 lives in another process
    await start(w.h); expect((await w.store.get(id)).category).toBe('active'); expect(Object.keys(await intentsOf(w.h))).toHaveLength(1)
  })
})
