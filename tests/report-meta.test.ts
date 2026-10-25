import { describe, expect, test } from 'claude-code/testing'
import { reportMeta, reportOf } from '../core/close'
import { reportRefusal } from '../core/validate'
import { budgetOf, step } from '../core/lifecycle'
import { world } from './fixtures/replay/world'

describe('worker report kept in meta', () => {
  test('the report contract caps the fields, so the kept report is whole valid JSON', () => {
    const r = { summary: 'x'.repeat(790) + '"quoted"', risks: ['r'.repeat(120)], questions: Array(5).fill('q') }
    const m = reportMeta(r)
    expect(() => JSON.parse(m)).not.toThrow(); expect(JSON.parse(m)).toEqual(r)
  })
  test('a report cut mid-string by an older version still reads', () => {
    const cut = JSON.stringify({ summary: 'abc'.repeat(1000) }).slice(0, 1500)
    expect(() => JSON.parse(cut)).toThrow()
    expect(reportOf(cut).summary?.startsWith('{"summary":"abc')).toBe(true)
    expect(reportOf(undefined)).toEqual({})
  })
})

// R1: a refusal for the form of the report is counted on the task (limits.shapeRetries), never on the run's 3 tries; the code is declared, never read from text
const LONG = { role: 'worker', outcome: 'done', summary: 'x'.repeat(801) }, OK = { role: 'worker', outcome: 'done', summary: 'ok' }, NOWHY = { role: 'worker', outcome: 'blocked', summary: 's' }
describe('shape refusals have their own per-task budget', () => {
  test('the code is declared by the check that refused, not by its message', () => {
    const v = (o: object) => reportRefusal({ schemaVersion: 1, ...o }); expect(v(LONG)?.code).toBe('shape'); expect(v({ ...OK, extra: 1 })?.code).toBe('shape'); expect(v({ ...OK, summary: 5 })?.code).toBe('shape')
    expect(v(NOWHY)?.code).toBe('semantic'); expect(v(OK)).toBeNull()
  })
  test('3 shape refusals, then a valid report lands', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    for (const n of [1, 2, 3]) expect(await w.rep('ag1', LONG)).toContain(`(malformed report ${n}/6)`)
    expect(await w.rep('ag1', OK)).toContain('report accepted'); expect((await budgetOf(w.h, id)).shapeRefusals).toBe(3)
  })
  test('4 shape refusals never feed the run\'s tries: a semantic refusal still gets 3 tries', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    for (let i = 0; i < 4; i++) await w.rep('ag1', LONG)
    for (const n of [1, 2, 3]) expect(await w.rep('ag1', NOWHY)).toContain(`attempt ${n}/3`)
  })
  test('the 6th shape refusal blocks the task (flag shape) and says so; a respawn mid-sequence keeps the count', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    for (let i = 0; i < 3; i++) await w.rep('ag1', LONG)
    await step(w.h, 'ag2', { type: 'spawn.ok', bind: { ...(await w.h.bind.read()).ag1 } })   // a respawned agent of the same task
    for (let i = 0; i < 2; i++) expect(await w.rep('ag2', LONG)).toContain('malformed report')
    expect((await budgetOf(w.h, id)).shapeRefusals).toBe(5)
    expect(await w.rep('ag2', LONG)).toContain('The task now waits for the user after 6 malformed reports. Stop.')
    const t = (await w.h.board.read()).tasks.find(x => x.id === id)!; expect(t.state).toBe('blocked'); expect(t.flags).toContain('shape')
  })
  test('the reviewer\'s semantic refusals keep limits.reportRetries: after 3, the 4th is accepted unvalidated and flagged', async () => {
    const w = await world(), [id] = w.ids; await w.at('rv1', id, 'reviewer'); await w.dep.store.setMeta(id, { 'cadre.sourceCommit': 'deadbee', 'cadre.base': 'abc1234' }, w.dep.actor)
    const bad = { role: 'reviewer', verdict: 'pass', summary: 's', findings: [], coverage: [], contractStatus: [] }
    for (const n of [1, 2, 3]) expect(await w.rep('rv1', bad)).toContain(`attempt ${n}/3`)
    expect(await w.rep('rv1', bad)).toContain('verdict accepted'); expect((await w.h.board.read()).tasks.find(x => x.id === id)!.flags).toContain('report-unvalidated')
  })
})
