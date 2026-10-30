import { describe, expect, test } from 'claude-code/testing'
import { reportMeta, reportOf } from '../core/close'
import { reportRefusal, reportSch } from '../core/validate'
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
  test('a spec_change with no scenario is refused in every shape of the report (absent, empty, blank, wrong type)', async () => {
    const base = { schemaVersion: 1, role: 'worker', outcome: 'spec_change', summary: 's', reason: 'r' }
    expect(reportRefusal(base)?.msg).toContain('scenario: required with outcome spec_change')
    for (const scenario of ['', '   ']) expect(reportRefusal({ ...base, scenario })?.msg).toContain('scenario: required with outcome spec_change')
    expect(reportRefusal({ ...base, scenario: 5 })?.code).toBe('shape'); expect(reportRefusal({ ...base, scenario: 'S4: Given a When b Then c' })).toBeNull()
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker'); expect(await w.rep('ag1', base)).toContain('scenario: required with outcome spec_change')
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

// ---- S4: one validateReport(role, r) over the role's RoleSpec.report. The built-ins and a custom role go through the same function; no role name is read ----
import { validateReport } from '../core/validate'
import { setRoles } from '../core/roles'
import { roles } from '../profiles/default'
import type { RoleSpec } from '../types/profile'

const critic: RoleSpec = { description: 'critic', prompt: 'p', tools: ['Read', 'mcp__cadre__report'], network: 'off', write: [], ttl: '5m', onSilent: 'block',
  report: { outcomes: [], fields: { note: { text: 5 }, tags: { list: 2, of: { text: 3 } }, ok: 'bool', mode: { enum: ['a', 'b'] }, kind: 'text', items: 'list', cmd: 'command', obj: { object: { id: { text: 4 } }, required: ['id'] } }, required: ['note'] }, verdict: { pass: 'agree', fail: 'object' } }
const swap = (extra: Record<string, RoleSpec>, f: () => void) => { setRoles({ ...roles, ...extra }); try { f() } finally { setRoles(roles) } }
const refusal = (role: string, o: object) => reportRefusal({ schemaVersion: 1, role, ...o })
describe('validateReport: one function for built-in and custom roles', () => {
  test('a built-in role: same text and code as 1.0.1 (the contracts and native-validate tests pin every line); no role name is read', () => {
    expect(validateReport('worker', { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 's' })).toBeNull()
    expect(validateReport('worker', { schemaVersion: 1, role: 'worker', outcome: 'blocked', summary: 's' })).toEqual({ code: 'semantic', msg: 'reason: required with outcome blocked; say what is in the way, then report again' })
    // the same spec under another name validates the same way: the renamed role is the mutation `if (role === 'reviewer')` would break
    swap({ auditor: roles.reviewer }, () => {
      const r = { schemaVersion: 1, role: 'auditor', verdict: 'pass', summary: 's', findings: [], coverage: [], contractStatus: [] }
      expect(validateReport('auditor', r)).toBeNull(); expect(validateReport('auditor', { ...r, verdict: 'maybe' })?.msg).toBe('verdict: expected one of "pass", "changes", got "maybe"; fix it and report again')
      expect(validateReport('auditor', { ...r, summary: 'x'.repeat(1501) })).toMatchObject({ code: 'shape', msg: 'summary: at most 1500 characters, got 1501; shorten it and report again' }); expect(refusal('auditor', { ...r, role: 'auditor', coverage: undefined })?.msg).toBe('coverage: required; add it and report again')
    })
  })
  test('a custom critic with a verdict {enum} field validates; the envelope names the roles of the table', () => swap({ critic: { ...critic, report: { ...critic.report, fields: { ...critic.report.fields, verdict: { enum: ['agree', 'object'] } }, required: ['note', 'verdict'] } } }, () => {
    expect(refusal('critic', { note: 'fine', verdict: 'agree' })).toBeNull()
    expect(refusal('critic', { note: 'fine', verdict: 'meh' })).toMatchObject({ code: 'shape', msg: 'verdict: expected one of "agree", "object", got "meh"; fix it and report again' })
    expect(refusal('boss', {})?.msg).toBe('role: expected worker|tester|reviewer|explorer|critic|planner|specifier, got "boss"')
  }))
  test('G2 requiredWith: a field required only with an outcome; the ask line is the role\'s own, a blank text field counts as missing', () => swap({ critic: { ...critic, report: { outcomes: ['done', 'blocked'], fields: { why: { text: 20 }, tests: 'list' }, required: [], requiredWith: { blocked: ['why'], done: ['tests'] }, ask: { why: 'give the reason for {outcome}' } }, verdict: undefined } }, () => {
    expect(refusal('critic', { outcome: 'blocked' })).toEqual({ code: 'semantic', msg: 'why: give the reason for blocked' }); expect(refusal('critic', { outcome: 'blocked', why: '  ' })?.msg).toBe('why: give the reason for blocked')
    expect(refusal('critic', { outcome: 'blocked', why: 'x' })).toBeNull(); expect(refusal('critic', { outcome: 'done' })?.msg).toBe('tests: required; add it and report again'); expect(refusal('critic', { outcome: 'done', tests: [] })).toBeNull()
  }))
  test('G3 caps and G6 kinds are data: text/list/item caps, object items, bool, enum, a test command; an over-cap value is a shape refusal', () => swap({ critic }, () => {
    const ok = { note: 'abc' }, bad = (o: object, msg: string) => expect(refusal('critic', { ...ok, ...o })).toEqual({ code: 'shape', msg })
    expect(refusal('critic', ok)).toBeNull()
    bad({ note: 'abcdef' }, 'note: at most 5 characters, got 6; shorten it and report again'); bad({ tags: ['a', 'b', 'c'] }, 'tags: at most 2 items, got 3; split the work and report again'); bad({ tags: ['abcd'] }, 'tags[0]: at most 3 characters, got 4; shorten it and report again')
    bad({ ok: 'yes' }, 'ok: expected a boolean, got "yes"; fix it and report again'); bad({ mode: 'c' }, 'mode: expected one of "a", "b", got "c"; fix it and report again'); bad({ kind: 5 }, 'kind: expected a string, got 5; fix it and report again'); bad({ items: {} }, 'items: expected an array, got {}; fix it and report again')
    bad({ obj: { id: 'abcde' } }, 'obj.id: at most 4 characters, got 5; shorten it and report again'); bad({ obj: {} }, 'obj.id: required; add it and report again'); bad({ obj: { id: 'a', x: 1 } }, 'obj.x: unknown field (allowed: id); remove it and report again')
    expect(refusal('critic', { ...ok, tags: ['a'], ok: true, mode: 'a', kind: 'k', items: [1], obj: { id: 'ab' } })).toBeNull()
    expect(refusal('critic', { ...ok, cmd: { command: 'npm test' } })?.code).toBe('shape'); expect(refusal('critic', { ...ok, cmd: { command: ['node', 'a.js'] } })).toBeNull(); expect(refusal('critic', { ...ok, extra: 1 })?.msg).toContain('extra: unknown field')
  }))
  test('a role with no outcomes has no outcome field; a verdict role names it `verdict`; the schema of a built-in is the 1.0.1 one (roles-golden)', () => {
    expect(reportSch(roles.explorer).required).toEqual(['answer']); expect(reportSch(roles.reviewer).required[0]).toBe('verdict'); expect(reportSch(roles.worker).required).toEqual(['outcome', 'summary'])
  })
})
