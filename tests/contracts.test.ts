// Agent contracts: per-role/outcome report schemas, caps that reject, a report-less end that is never accepted, the 5-field handoff, the amendment ledger
import { describe, expect, test } from 'claude-code/testing'
import { REPORTS, validateReport } from '../core/validate'
import { handoffOf } from '../core/briefs'
import { runOf } from '../core/lifecycle'
import { judge } from '../policy/guards'
import { handleWith } from '../tools/index'
import { viaEngine } from './fixtures/engine'
import { world as replay } from './fixtures/replay/world'
import { FULL, world } from './fixtures/native/world'

const R = (role: string, o: object) => validateReport({ schemaVersion: 1, role, ...o })
describe('report contracts: role × outcome', () => {
  test('each role has its contract; a good report of each passes', () => {
    expect(Object.keys(REPORTS)).toEqual(['worker', 'tester', 'reviewer', 'explorer', 'planner', 'specifier'])
    expect(R('worker', { outcome: 'done', summary: 's' })).toBeNull(); expect(R('worker', { outcome: 'request', summary: 's', request: { helper: 'explore', ask: 'where is X?', why: 'I change it' } })).toBeNull()
    expect(R('tester', { outcome: 'done', summary: 's', tests: [{ path: 't', name: 'S1', scenario: 'S1' }] })).toBeNull()
    expect(R('reviewer', { verdict: 'pass', summary: 's', findings: [], coverage: [], contractStatus: [] })).toBeNull()
    expect(R('explorer', { answer: 'a', citations: [] })).toBeNull(); expect(R('planner', { tasks: [] })).toBeNull()
  })
  test('outcomes need their field; a field of another role is refused', () => {
    for (const o of ['blocked', 'spec_change']) expect(R('worker', { outcome: o, summary: 's' })).toBe(`reason: required with outcome ${o}; say what is in the way, then report again`)
    expect(R('worker', { outcome: 'request', summary: 's' })).toContain('request: required with outcome request')
    expect(R('worker', { outcome: 'request', summary: 's', request: { helper: 'explore', ask: 'a' } })).toBe('request.why: required; add it and report again')
    expect(R('worker', { outcome: 'request', summary: 's', request: { helper: 'explore', ask: 'a'.repeat(2001), why: 'w' } })).toBe('request.ask: at most 2000 characters, got 2001; shorten it and report again')
    expect(R('tester', { outcome: 'done', summary: 's' })).toBe('tests: required; add it and report again')
    expect(R('worker', { outcome: 'done', summary: 's', verdict: 'pass' })).toContain('verdict: unknown field (allowed: schemaVersion, role, outcome')
    expect(R('tester', { outcome: 'blocked', summary: 's', tests: [] })).toBe('outcome: expected one of "done", "request", got "blocked"; fix it and report again')
  })
  test('caps reject, never truncate', () => {
    expect(R('worker', { outcome: 'done', summary: 's', risks: Array(6).fill('r') })).toBe('risks: at most 5 items, got 6; split the work and report again')
    expect(R('worker', { outcome: 'done', summary: 's', risks: ['r'.repeat(121)] })).toBe('risks[0]: at most 120 characters, got 121; shorten it and report again')
    expect(R('explorer', { answer: 'a'.repeat(2001) })).toBe('answer: at most 2000 characters, got 2001; shorten it and report again')
  })
  test('an over-cap report through the tool is refused and nothing is stored', async () => {
    const w = await replay({ type: 'docs' }), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'x'.repeat(801) })).toContain('error: summary: at most 800 characters, got 801')
    expect((await w.store.get(id)).meta['cadre.report']).toBeUndefined()
  })
  test('a live call: the arguments sit flat beside the envelope; only the arguments are checked', async () => {
    const w = await replay({ type: 'docs' }), [id] = w.ids; await w.at('ag1', id, 'worker')
    const r = await handleWith(w.h, w.dep, { tool: 'mcp__cadre__report', tool_use_id: 'u9', agentId: 'ag1', requestMeta: {}, schemaVersion: 1, role: 'worker', outcome: 'blocked', summary: 's', reason: 'a database' })
    expect(r.result).toBe('blocked recorded; you are resumed with the answer. Stop and wait.')
  })
})

describe('a report-less end is never a result', () => {
  test('one nudge, then the agent ends; nothing accepted, one dialog; its stop was never refused', async () => {
    const w = await replay({ type: 'docs' }), [id] = w.ids; await w.at('ag1', id, 'worker')
    expect(judge({ tool: 'SubagentHandback', agentId: 'ag1' })).toBeUndefined()   // exit rule 1
    await w.stop('ag1', 'answer', 'I changed a.ts'); expect(w.sent).toHaveLength(1); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'silent', n: 1 })
    await w.stop('ag1', 'answer', 'I changed a.ts'); expect(w.sent).toHaveLength(1)
    expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'blocked' })
    const t = await w.store.get(id); expect(t.meta['cadre.sourceCommit']).toBeUndefined(); expect(t.meta['cadre.report']).toBeUndefined()
    expect(((await w.h.board.read()).decisions ?? []).filter(d => d.id.startsWith(`flag:${id}:`)).map(d => d.id)).toEqual([`flag:${id}:no-report`])
    await w.stop('ag1', 'answer'); expect(((await w.h.board.read()).decisions ?? []).filter(d => d.id.startsWith(`flag:${id}:`))).toHaveLength(1)   // no second dialog
  })
})

describe('the handoff: five fixed fields built from records', () => {
  test('headings in order; empty fields say none', () => {
    const t = handoffOf({}, 'abc1234', '', ''); expect(t.split('\n').filter(l => /^[A-Z]\w+:$/.test(l))).toEqual(['Decided:', 'Rejected:', 'Risks:', 'Files:', 'Remaining:'])
    expect(t).toContain('Rejected:\nnone'); expect(t).toContain('checkpoint abc1234')
    const u = handoffOf({ 'cadre.report': JSON.stringify({ summary: 'login done', risks: ['no rate limit'] }), 'cadre.rejected': 'review of abc1234: missing test\n- [major] a.ts no test', 'cadre.decision': 'keep the old format', 'cadre.lastCheck': 'test failed' }, 'abc1234', ' a.ts | 2 +-', 'diff')
    expect(u).toContain('Decided:\n- keep the old format\n- the last report: login done'); expect(u).toContain('Risks:\n- no rate limit'); expect(u).toContain('Files:\n a.ts | 2 +-\ndiff'); expect(u).toContain('last check: test failed')
  })
})

describe('the amendment ledger', () => {
  const tool = (w: Awaited<ReturnType<typeof world>>, name: string, input: object) => viaEngine(w.h, { tool: `mcp__cadre__${name}`, tool_use_id: 'u', ...input }) as Promise<any>
  async function approved(drive?: 'yolo') {
    const w = await world(); await tool(w, 'plan', { title: 'Auth', description: 'g', lane: 'full', reason: 'r' })
    const { type, package: pkg, scenarios, changelog, interface: iface, paths } = FULL, a = (await tool(w, 'task', { title: 'Add login', description: 'impl', type, package: pkg, scenarios, changelog, interface: iface, paths })).result.id
    await w.text({ cmd: 'approve', args: ['m-1'] })
    if (drive) await w.h.board.update(b => ({ ...b, drive: { ...b.drive, on: true, mode: drive } }))
    return { w, a }
  }
  const S1 = 'S1: Given a user When they log in twice Then one session exists'
  test('an approved task needs reason and evidence; the original stays verbatim; a criterion changes once', async () => {
    const { w, a } = await approved()
    expect((await tool(w, 'amend', { id: a, expectedRevision: 2, scenarios: [S1] })).result).toBe('error: reason: required to change an approved task; give why (reason) and what shows it (evidence: a test output, a file and line), then call again')
    const r = await tool(w, 'amend', { id: a, expectedRevision: 2, scenarios: [S1], reason: 'a double login made two sessions', evidence: 'test/login.test.js:12 fails' })
    expect(r.result.revision).toBe(3)
    expect(JSON.parse((await w.store.get(a)).meta['cadre.amendments'])).toEqual([{ criterion: 'scenario S1', original: FULL.scenarios[0], reason: 'a double login made two sessions', evidence: 'test/login.test.js:12 fails', at: expect.any(Number) }])
    expect((await w.store.get(a)).category).toBe('draft')   // auto: back to the user's dialog
    await w.text({ cmd: 'approve', args: ['m-1'] })
    expect((await tool(w, 'amend', { id: a, expectedRevision: 3, scenarios: ['S1: Given x When y Then z'], reason: 'r', evidence: 'e' })).result).toBe('error: scenario S1: changed once already; a second change to it is the user\'s: ask them')
    expect((await tool(w, 'amend', { id: a, expectedRevision: 3, description: 'impl, one session', reason: 'r', evidence: 'e' })).result.revision).toBe(4)   // another criterion: fine
  })
  test('yolo: no dialog; main\'s change stands and is recorded', async () => {
    const { w, a } = await approved('yolo')
    await tool(w, 'amend', { id: a, expectedRevision: 2, scenarios: [S1], reason: 'r', evidence: 'e' })
    expect((await w.store.get(a)).category).not.toBe('draft'); expect(((await w.h.board.read()).decisions ?? []).some(d => d.id.startsWith('plan:'))).toBe(false)
    expect((await w.store.get(a)).acceptance).toBe(S1)
  })
})
