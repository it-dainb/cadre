import { describe, expect, test } from 'claude-code/testing'
import { defaults } from '../task-management/registry'
import { capped, clearRetries, missingLine, missingList, missingOf, refuse, validateFields, validateReport } from '../core/validate'
import { FULL } from './fixtures/native/world'
import { fakeHost } from './support'

const reg = defaults(), v = (m: Record<string, unknown>) => validateFields(m, reg)
const draft = (o: Record<string, any> = {}) => ({ id: 'a', title: 't', description: '', type: 'feature', category: 'draft' as const, nativeStatus: 'draft', priority: 2 as const, deps: [], labels: [], updatedAt: '', meta: {}, ...o })

describe('validateFields: only malformed PRESENT fields, with an example', () => {
  test('a complete valid set passes; null clears; absent is fine', () => { expect(v(FULL)).toBeNull(); expect(v({ package: null, scenarios: null })).toBeNull(); expect(v({})).toBeNull() })
  test('each field names its path, the expectation and the offender', () => {
    expect(v({ scenarios: ['S1: Given a When b'] })).toBe('metadata.scenarios[0]: expected "S1: Given <state> When <action> Then <outcome>", got "S1: Given a When b"')
    expect(v({ scenarios: 'x' })).toContain('metadata.scenarios: expected an array of "S1: Given')
    expect(v({ breaking: 'yes' })).toBe('metadata.breaking: expected true or false, got "yes"')
    expect(v({ interface: { symbols: [{ name: 'f', kind: 'function', params: 'x', returns: 'R', status: 'new' }] } })).toBe('metadata.interface.symbols[0].params: expected an array of strings, got "x"')
    expect(v({ interface: { symbols: [{ name: 'f', kind: 'function', params: [], returns: 'R', status: 'old' }] } })).toBe('metadata.interface.symbols[0].status: expected new|changed|unchanged, got "old"')
    expect(v({ interface: { none: true } })).toBe('metadata.interface.reason: expected a reason, got undefined')
    expect(v({ changelog: { none: true, reason: 'internal' } })).toBeNull(); expect(v({ interface: { none: true, reason: 'no api' } })).toBeNull()
    expect(v({ kind: 'epic' })).toBe('metadata.kind: expected "plan" or "mission", got "epic"'); expect(v({ amend: 'true' })).toBe('metadata.amend: expected true, got "true"')
  })
})

describe('completeness (enforced at approve) and the missing line', () => {
  test('missingOf: scenarios, changelog, interface (contract-required types only), package; spikes need nothing', () => {
    expect(missingOf(draft(), reg)).toEqual(['scenarios', 'changelog', 'interface', 'package'])
    expect(missingOf(draft({ type: 'docs' }), reg)).toEqual(['scenarios', 'changelog', 'package'])
    expect(missingOf(draft({ type: 'spike' }), reg)).toEqual([])
    expect(missingOf(draft({ acceptance: 'S1: …', design: '{}', meta: { 'cadre.changelog': '{}', 'cadre.package': '.' } }), reg)).toEqual([])
    expect(missingOf(draft({ type: 'custom' }), reg)).toEqual([])
  })
  test('missingList / missingLine: "id: a, b" joined by "; ", ≤200 chars, empty when approvable', () => {
    expect(missingList([], reg)).toEqual(['tasks'])
    const l = missingList([draft({ id: 'a1' }), draft({ id: 'a2', type: 'spike' })], reg); expect(l).toEqual(['a1: scenarios, changelog, interface, package'])
    expect(missingLine(l)).toBe('missing: a1: scenarios, changelog, interface, package'); expect(missingLine([])).toBe('')
    expect(missingLine(Array(40).fill('a1: scenarios, changelog')).length).toBe(200)
  })
})

describe('retries ≤3 per draft', () => {
  test('refuse counts per key; capped after the 3rd; clearRetries resets', async () => {
    const h = fakeHost()
    expect(await refuse(h, 'k', 'e')).toBe('e (attempt 1/3)'); await refuse(h, 'k', 'e'); await refuse(h, 'k', 'e')
    expect(await capped(h, 'k')).toBe(false)
    expect(await refuse(h, 'k', 'e')).toBe('e (retry cap 3 reached for k: ask the human, or start a new draft)'); expect(await capped(h, 'k')).toBe(true)
    expect(await capped(h, 'other')).toBe(false)
    await clearRetries(h, 'k'); expect(await capped(h, 'k')).toBe(false)
  })
})

describe('validateReport: the envelope entry point for wave 3', () => {
  test('example-bearing errors per role; a good envelope passes', () => {
    expect(validateReport(null)).toContain('report: expected {"schemaVersion":1,"role":"worker"')
    expect(validateReport({ schemaVersion: 2 })).toBe('schemaVersion: expected 1, got 2')
    expect(validateReport({ schemaVersion: 1, role: 'boss' })).toBe('role: expected worker|tester|reviewer|explorer, got "boss"')
    expect(validateReport({ schemaVersion: 1, role: 'worker', outcome: 'done' })).toBe('summary: required for role worker')
    expect(validateReport({ schemaVersion: 1, role: 'worker', outcome: 'meh', summary: 's' })).toBe('outcome: expected done|blocked|spec_change, got "meh"')
    expect(validateReport({ schemaVersion: 1, role: 'worker', outcome: 'done', summary: 'x'.repeat(1501) })).toBe('summary: at most 1500 chars, got 1501')
    expect(validateReport({ schemaVersion: 1, role: 'worker', outcome: 'done', summary: 'ok' })).toBeNull()
    expect(validateReport({ schemaVersion: 1, role: 'reviewer', verdict: 'maybe', summary: 's', findings: [], coverage: [], contractStatus: [] })).toBe('verdict: expected pass|changes, got "maybe"')
    expect(validateReport({ schemaVersion: 1, role: 'explorer' })).toBe('answer: required for role explorer (or discovery)'); expect(validateReport({ schemaVersion: 1, role: 'explorer', answer: 'a' })).toBeNull()
  })
})
