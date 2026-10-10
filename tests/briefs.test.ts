import { describe, expect, test } from 'claude-code/testing'
import { PLAN_RULES, attachment, brief, context, drainDelta, missingLine, pushDelta, queueCard, renderCard, renderContract } from '../core/briefs'
import { viewHash } from '../core/board'
import { fakeHost, task } from './support'
import { DESIGN, GOLDEN } from './fixtures/briefs/golden'
import type { Snapshot } from '../types'

const base = { id: 'bd-a1', title: 'Add login', type: 'feature', description: 'Users sign in with a password.', scenarios: 'S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError', contract: DESIGN, notes: 'start with the happy path' }
const extra = {
  tester: { testPaths: ['tests/**'] },
  worker: { locked: ['tests/login.test.ts'], redCard: 'red ✓ 2 failing', deps: [{ id: 'bd-a0', title: 'Schema', out: 'users table' }], findings: ['check lint: 1 warning'], decisions: ['use bcrypt'], handoff: 'checkpoint 1a2b3c4\n a.ts | 3 +', others: ['src/other/**'], protectedPaths: ['.git/', '.cadre/'] },
  reviewer: { sourceCommit: '1a2b3c4', diffStat: ' a.ts | 3 +', diff: 'diff --git a/a.ts b/a.ts', locked: ['tests/login.test.ts'], greenCard: 'green ✓ (test 41s)', report: 'done: login added', changelog: 'Added: login (bd-a1)', flags: ['edited:pm:title'] },
  explorer: { question: 'where is auth?', notes: undefined },
}

describe('briefs: goldens per role (4.2), static header first, variable task data last', () => {
  for (const role of ['tester', 'worker', 'reviewer', 'explorer'] as const)
    test(`${role}: byte-for-byte`, async () => { expect(brief(role, { ...base, ...extra[role] })).toBe(GOLDEN[role]) })
  test('the header is static: identical across tasks; task data comes after it', async () => {
    const a = brief('worker', { ...base, id: 'x-1' }), b = brief('worker', { ...base, id: 'y-9', title: 'Other' })
    expect(a.split('\n\n')[0]).toBe(b.split('\n\n')[0]); expect(a.split('\n\n')[0].length).toBeLessThan(1500); expect(a.indexOf('# TASK-x-1')).toBeGreaterThan(a.indexOf('cadre worker brief'))
  })
  test('caps: notes 500, spec 4 KB, context 3 KB, diff 3 KB; empty sections are dropped', async () => {
    const w = brief('worker', { ...base, notes: 'n'.repeat(900), description: 'd'.repeat(9000), findings: ['f'.repeat(9000)] })
    expect(w.split('## Orchestrator notes\n')[1].length).toBeLessThanOrEqual(500)
    const spec = w.slice(w.indexOf('## Description'), w.indexOf('## Findings')); expect(spec.length).toBeLessThanOrEqual(4096 + 40)
    expect(w.slice(w.indexOf('## Findings'), w.indexOf('## Orchestrator')).length).toBeLessThanOrEqual(3072 + 4)
    expect(brief('reviewer', { ...base, diff: 'x'.repeat(9000) }).length).toBeLessThan(9000)
    expect(brief('worker', { id: 'a', title: 't', type: 'docs' })).not.toContain('## Handoff')
  })
  test('contract renders compact lines; none and unparsable pass through', async () => {
    expect(renderContract(JSON.stringify({ none: true, reason: 'internal' }))).toBe('none: internal'); expect(renderContract('not json')).toBe('not json'); expect(renderContract(undefined)).toBe('')
  })
  test('plan rules <= 1.5 KB and byte-stable; missing line <= 200 chars', async () => {
    expect(PLAN_RULES.length).toBeLessThanOrEqual(1500); expect(PLAN_RULES).not.toMatch(/\d{4}-\d\d-\d\d|p\d|bd-/)
    expect(missingLine([])).toBe(''); expect(missingLine(['scenarios on a1', 'changelog on a2'])).toBe('missing: scenarios on a1; changelog on a2'); expect(missingLine(['x'.repeat(500)]).length).toBe(200)
  })
})

describe('deltas (4.3): per agentId, <= 1 KB, drained once', () => {
  test('queued per agent, drained in order, other agents untouched, nothing left behind', async () => {
    const h = fakeHost()
    await pushDelta(h, 'ag1', 'decision: use bcrypt'); await pushDelta(h, 'ag1', 'dep bd-a0 closed'); await pushDelta(h, 'ag2', 'other')
    expect(await drainDelta(h, 'ag1')).toBe('decision: use bcrypt\ndep bd-a0 closed'); expect(await drainDelta(h, 'ag1')).toBeNull(); expect(await drainDelta(h, 'ag2')).toBe('other')
  })
  test('over 1 KB: the rest waits for the next drain; one oversized entry is truncated', async () => {
    const h = fakeHost(); for (const c of 'abc') await pushDelta(h, 'ag1', c.repeat(600))
    for (let i = 0; i < 3; i++) expect((await drainDelta(h, 'ag1'))!.length).toBeLessThanOrEqual(1024)
    expect(await drainDelta(h, 'ag1')).toBeNull()
    await pushDelta(h, 'ag3', 'z'.repeat(5000)); expect((await drainDelta(h, 'ag3'))!.length).toBe(1024)
  })
})

const planBoard = (over: Partial<Snapshot> = {}): Partial<Snapshot> => ({
  seq: 3, epic: 'p3', plan: { id: 'p3', slug: 'auth', state: 'approved', epicBranch: 'epic/p3-auth' },
  tasks: [task('a1'), task('a2', { state: 'active', step: 'worker', owner: 'x' }), task('a5', { state: 'review', step: 'merge' })], ...over,
})
const submit = async (h: any, e: any = { text: 'hi' }) => { let got: any; await context(h, e, (x: any) => (got = x)); return got }

describe('main context line (4.5): gated, diff-gated, main only', () => {
  test('no plan and no init request: untouched', async () => { expect((await submit(fakeHost())).context).toBeUndefined() })
  test('plan exists: one context block with the board line + next:; the same view is not repeated; a real change is', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, ...planBoard() }))
    const first = await submit(h); expect(first.context).toHaveLength(1); expect(first.context[0]).toContain('plan p3 approved'); expect(first.context[0]).toContain('next: complete TASK-a5'); expect(first.context[0].length).toBeLessThanOrEqual(1024)
    expect((await submit(h)).context).toBeUndefined()
    await h.board.update(s => ({ ...s, seq: 9, cost: { tokens: 99 } })); expect((await submit(h)).context).toBeUndefined()   // volatile fields don't move the hash
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === 'a1' ? { ...t, state: 'active' as const, owner: 'y' } : t)) })); expect((await submit(h)).context).toHaveLength(1)
  })
  test('a subagent prompt is never touched (main only, S35)', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, ...planBoard() })); expect((await submit(h, { text: 'x', agentId: 'ag1' })).context).toBeUndefined()
  })
  test('pending init requests are exempt from the plan gate and from the diff gate, and carry their own next:', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, seq: 1, init: [{ stage: 4, state: 'pending' as const }] }))
    for (let i = 0; i < 2; i++) { const r = await submit(h); expect(r.context).toHaveLength(1); expect(r.context[0]).toBe('next: spawn the discovery explorer') }
    await h.board.update(s => ({ ...s, init: [{ stage: 3, state: 'pending' as const }] })); expect((await submit(h)).context[0]).toContain('draft TaskCreate{kind:"mission"}')
  })
  test('existing context entries are kept; the line is appended', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, ...planBoard() })); expect((await submit(h, { text: 'x', context: ['keep'] })).context[0]).toBe('keep')
  })
  test('a queued resume card goes first, once, and counts as sent (no second line for the same view)', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, ...planBoard() })); await queueCard(h, 'CARD')
    const r = await submit(h); expect(r.context[0]).toBe('CARD'); expect(r.context).toHaveLength(2)
    expect((await submit(h)).context).toBeUndefined(); expect((await h.secret.read()).ctx).toEqual({ key: viewHash(await h.board.read()) })
  })
})

describe('reminder suppression + resume card', () => {
  test('todo_reminder / task_reminder answer {text:null}; everything else passes on', async () => {
    const pass = (e: any) => ({ passed: e.type })
    expect(attachment(fakeHost(), { type: 'todo_reminder' }, pass)).toEqual({ text: null }); expect(attachment(fakeHost(), { type: 'task_reminder', agentId: 'a' }, pass)).toEqual({ text: null })
    expect(attachment(fakeHost(), { type: 'plan_mode' }, pass)).toEqual({ passed: 'plan_mode' })
  })
  test('card golden, <= 3 KB; only the last 5 decisions', async () => {
    expect(renderCard({ mission: 'ship auth', epic: { id: 'p3', title: 'auth', intent: 'users sign in' }, decisions: ['d1', 'd2'], questions: ['which hash?'], inflight: [{ id: 'bd-a2', step: 'worker', owner: 'ag1', checkpoint: '1a2b3c4' }], drive: 'off', next: 'spawn TASK-bd-a1' })).toBe(GOLDEN.card)
    const big = renderCard({ mission: 'm'.repeat(5000), epic: null, decisions: ['1', '2', '3', '4', '5', '6', '7'], questions: [], inflight: [], drive: 'off', next: 'wait' }); expect(big.length).toBeLessThanOrEqual(3072)
    expect(renderCard({ mission: null, epic: null, decisions: ['1', '2', '3', '4', '5', '6', '7'], questions: [], inflight: [], drive: 'off', next: 'wait' })).not.toContain('\n1\n')
  })
})
