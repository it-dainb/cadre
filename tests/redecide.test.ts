// Decisions survive /clear (ADR 0008): rehydrate re-asks what durable state says is still owed.
import { describe, expect, test } from 'claude-code/testing'
import { rehydrate, savePointer } from '../core/session'
import { repoKeyOf } from '../commands/init'
import { fakeHost } from './support'
import { plan, world } from './fixtures/native/world'
import type { Host } from '../types'

// a /clear: fresh $.state, same $.store and beads
async function cleared(w: Awaited<ReturnType<typeof world>>) {
  await savePointer(w.h)
  const f = fakeHost() as Host & { logs: string[] }, k = `cadre:${repoKeyOf(await w.h.cwd())}:board`
  Object.assign(f, { taskStore: w.h.taskStore, config: w.h.config, rand: w.h.rand, cwd: w.h.cwd, run: w.h.run }); await f.store.set(k, await w.h.store.get(k))
  return f
}
const ids = async (h: Host) => ((await h.board.read()).decisions ?? []).map(d => d.id)

describe('rehydrate re-asks pending decisions', () => {
  test('a draft plan and a spec_change (with the worker\'s reason): the same decisions are back, ', async () => {
    const w = await world(), { plan: p, task } = await plan(w)
    await w.store.setMeta(task, { 'cadre.blocked': 'spec_change', 'cadre.specChange': 'the API changed under the tests' }, 'mod')
    const was = (await w.h.board.read()).decisions!.find(d => d.id === `plan:${p}`)!, f = await cleared(w)
    expect(await ids(f)).toEqual([]); expect(await rehydrate(f)).toBe(true)
    expect(await ids(f)).toEqual([`plan:${p}`, `flag:${task}:spec_change`])
    const now = (await f.board.read()).decisions!
    expect(now[0].title).toBe(was.title); expect(now[1].lines.join(' ')).toContain('the API changed under the tests')
    expect((await f.board.read()).tasks.find(t => t.id === task)!.flags).toContain('spec_change')
  })
  test('an open gate comes back and goes first (it shares the approval slot with the plan)', async () => {
    const w = await world(), { plan: p } = await plan(w), g = await w.store.createDraft({ title: 'Sign off', description: 'ship it', type: 'gate', parent: (await w.h.board.read()).epic! })
    const f = await cleared(w); await rehydrate(f)
    expect(await ids(f)).toContain(`gate:${g.id}`); expect(await ids(f)).not.toContain(`plan:${p}`); expect((await f.board.read()).approval.planId).toBe(g.id)
  })
  test('nothing pending: no decisions', async () => {
    const w = await world(); await plan(w); const p = (await w.h.board.read()).plan!.id
    await w.text({ cmd: 'approve', args: [p] })
    const f = await cleared(w); await rehydrate(f); expect(await ids(f)).toEqual([])
  })
})
