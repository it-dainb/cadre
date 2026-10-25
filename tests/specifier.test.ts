// The specifier (A1, default off): one read-only run per task before its claim; it writes how-to notes for the worker, never changes WHAT, and the tester's brief cannot carry them.
import { describe, expect, test } from 'claude-code/testing'
import { arm } from '../core/drive'
import { brief } from '../core/briefs'
import { DEVIATIONS, validateReport } from '../core/validate'
import { world } from './fixtures/replay/world'

const GOOD = { schemaVersion: 1, role: 'specifier', notes: 'Edit src/a.ts: reuse parse() from src/util.ts; do the steps in order.', deviation: 'none' }
const kinds = (w: any) => w.spawned.map((x: any) => x[2])

describe('the specifier', () => {
  test('settings: roles.specifier.enabled: off (the default) starts no specifier and the task is claimed as before; on, one specifier runs first and the claim waits for it', async () => {
    const off = await world(); expect(off.cfg.roles.specifier.enabled).toBe(false)
    await arm(off.h, 'auto'); await off.turn(); await off.turn(); expect(kinds(off)).toEqual(['cadre:worker'])
    const w = await world(); w.cfg.roles.specifier.enabled = true
    await arm(w.h, 'auto'); await w.turn(); await w.turn(); expect(kinds(w)).toEqual(['cadre:specifier'])   // the second turn: the task waits for the specifier, nothing else starts
    expect((await w.store.get(w.ids[0])).meta['cadre.specified']).toMatch(/^running@/)
    expect(await w.rep('ag1', GOOD)).toContain('notes recorded')
    await w.stop('ag1'); await w.turn(); await w.turn()
    expect(kinds(w)).toEqual(['cadre:specifier', 'cadre:worker'])   // one spec per task: the claim goes on, no second specifier
    expect((await w.store.get(w.ids[0])).meta).toMatchObject({ 'cadre.specified': 'done', 'cadre.how': GOOD.notes })
    expect(w.spawned[1][1]).toContain('reuse parse()')   // the worker reads them
  })
  test('a specifier that stops without a report no longer holds the task', async () => {
    const w = await world(); w.cfg.roles.specifier.enabled = true
    await arm(w.h, 'auto'); await w.turn(); await w.stop('ag1'); await w.turn()
    expect(kinds(w)).toEqual(['cadre:specifier', 'cadre:worker']); expect((await w.store.get(w.ids[0])).meta['cadre.how']).toBeUndefined()
  })
  test('the worker brief carries the notes; the tester brief is built without them', () => {
    const b = { id: 'c-1', title: 'T', type: 'feature', scenarios: 'S1: Given a When b Then c', how: 'NOTE-ABOUT-FILES' }
    expect(brief('worker', b)).toContain('NOTE-ABOUT-FILES'); expect(brief('tester', b)).not.toContain('NOTE-ABOUT-FILES'); expect(brief('reviewer', b)).not.toContain('NOTE-ABOUT-FILES')
  })
  test('it cannot change what: a scenario field is refused, a deviation outside the enum is refused, a good report passes', () => {
    expect(validateReport(GOOD)).toBeNull()
    expect(validateReport({ ...GOOD, scenarios: ['S1: Given x When y Then z'] })).toContain('scenarios')
    expect(validateReport({ ...GOOD, deviation: 'rewrite' })).toContain('deviation')
    expect(validateReport({ ...GOOD, notes: 'x'.repeat(1501) })).toContain('notes')
    expect(DEVIATIONS).toEqual(['none', 'wrong_path', 'scenario_conflict', 'missing_dep'])
  })
  test('a deviation shows the human one dialog and the task goes on', async () => {
    const w = await world(); w.cfg.roles.specifier.enabled = true
    await arm(w.h, 'auto'); await w.turn()
    await w.rep('ag1', { ...GOOD, deviation: 'wrong_path' }); await w.rep('ag1', { ...GOOD, deviation: 'wrong_path' })
    const ds = ((await w.h.board.read()).decisions ?? []).filter(d => d.id.startsWith('spec:')); expect(ds.length).toBe(1); expect(ds[0].lines.join(' ')).toContain('not where the work belongs')
    await w.stop('ag1'); await w.turn(); expect(kinds(w)).toEqual(['cadre:specifier', 'cadre:worker'])
  })
})
