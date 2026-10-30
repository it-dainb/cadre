import { describe, expect, test } from 'claude-code/testing'
import { card, comment, commitMessage, contextLine, nextAction, spawnable, subject, tag, taskText } from '../core/render'
import { emptySnapshot, modelView } from '../core/board'
import { task } from './support'
import { GOLD } from './fixtures/render/golden'

const snap = () => ({ ...emptySnapshot('r'), epic: 'p3', plan: { id: 'p3', slug: 'auth', state: 'approved' as const, epicBranch: 'epic/p3-auth' },
  tasks: [task('a1'), task('a4'), task('a2', { state: 'active', step: 'worker', owner: 'ag2' }), task('a3', { state: 'review', step: 'reviewer', owner: 'ag3' }),
    task('a5', { state: 'review', step: 'merge' }), task('a6', { state: 'blocked', step: 'worker' }), task('a7', { state: 'done', step: 'merge' })],
  sync: [{ target: 'pm', state: 'offline' as const, pending: 4, at: 5 }, { target: 'gh', state: 'ok' as const, pending: 0, at: 5 }] })

describe('main context line (DESIGN 4.5)', () => {
  test('the §4.5 example, byte for byte', () => { expect(contextLine(modelView(snap()))).toBe(GOLD.context) })
  test('≤1 KB and stable across volatile fields (cost, phaseSince) because it reads the model view', () => {
    const a = snap(), b = { ...snap(), cost: { tokens: 99 }, tasks: snap().tasks.map(t => ({ ...t, phaseSince: 7 })) }
    expect(contextLine(modelView(a))).toBe(contextLine(modelView(b))); expect(contextLine(modelView(a)).length).toBeLessThan(1024)
  })
  test('draft plan: the missing list rides the line and next names the gap, then the approval', () => {
    const d = { ...snap(), sync: [], plan: { ...snap().plan, state: 'draft' as const }, tasks: [task('a1', { state: 'draft' })], approval: { planId: 'p3', missing: ['a1: scenarios'] } }
    expect(contextLine(modelView(d))).toBe('plan p3 draft · epic/p3-auth · missing: a1: scenarios\nnext: complete the draft plan (see missing)')
    expect(nextAction(modelView({ ...d, approval: { planId: 'p3', missing: [] } }))).toBe('ask the human to approve p3')
  })
  test('no plan → empty line; all closed → complete the epic; nothing actionable → wait', () => {
    expect(contextLine(modelView(emptySnapshot('r')))).toBe('')
    const done = { ...snap(), tasks: [task('a1', { state: 'done' })] }
    expect(nextAction(modelView(done))).toBe('complete the epic: status {id:\"p3\", set:\"completed\"}'); expect(nextAction(modelView({ ...snap(), tasks: [task('a2', { state: 'active', step: 'worker', owner: 'x' })] }))).toBe('wait')
  })
  test('conditional-blocks: ready only when the upstream failed (cancelled)', () => {
    const mk = (up: 'done' | 'cancelled') => ({ ...snap(), tasks: [task('u', { state: up }), task('f', { deps: [{ id: 'u', type: 'conditional-blocks' }] })] })
    expect(contextLine(modelView(mk('cancelled')))).toContain('ready: f'); expect(contextLine(modelView(mk('done')))).not.toContain('ready')
  })
})

describe('nextAction under yolo', () => {
  test('main decides a blocked or spec-change task; any other human-held flag waits for the user', () => {
    const y = (flags: string[]) => nextAction(modelView({ ...snap(), drive: { on: true, mode: 'yolo' }, tasks: [task('a6', { state: 'blocked', step: 'worker', flags })] } as never))
    expect(y(['blocked'])).toBe('decide a6 yourself (status {id:\"a6\", choice or args})')
    expect(y(['needs_human'])).toBe('a6 waits for the user (go on with the rest)')
  })
})

describe('spawnable: what an agent should start for, as data', () => {
  test('reviewers nobody runs, then every ready task; nextAction words the same (one ready per turn)', () => {
    const s = { ...snap(), tasks: [...snap().tasks, task('a8', { state: 'review', step: 'reviewer' })] }
    expect(spawnable(modelView(s))).toEqual([{ id: 'a8', role: 'reviewer' }, { id: 'a1', role: 'claim' }, { id: 'a4', role: 'claim' }])
    expect(nextAction(modelView(s))).toBe('complete TASK-a5; a6 waits for the user (go on with the rest); spawn TASK-a8 (reviewer); spawn TASK-a1')
  })
  test('with the bindings: an active step no live agent runs; a reservation, a live agent of that role or a retired one decide it', () => {
    const s = modelView({ ...snap(), tasks: [task('a2', { state: 'active', step: 'worker' }), task('a3', { state: 'active', step: 'tester' }), task('a9', { state: 'active', step: 'worker' })] })
    expect(spawnable(s, { g1: { taskId: 'a2', role: 'tester' }, '~a3': { taskId: 'a3', role: 'tester' }, g9: { taskId: 'a9', role: 'worker', retired: true } })).toEqual([{ id: 'a2', role: 'worker' }, { id: 'a9', role: 'worker' }])
    expect(spawnable(s, { g2: { taskId: 'a2', role: 'worker' }, g3: { taskId: 'a3', role: 'tester' }, g9: { taskId: 'a9', role: 'worker' } })).toEqual([])
    expect(spawnable(s)).toEqual([])   // without them: nextAction's view (main reads the cards for those)
  })
})

describe('result card, tags, commit message, beads comment, TaskGet text (goldens)', () => {
  test('result card matches the §6.4 template, ≤600 chars', () => {
    const c = card({ id: 'bd-a1', title: 'Add login', role: 'worker', to: 'review', green: { ok: true, check: 'test', secs: 41 }, files: 4, add: 120, del: 30, commit: '1a2b3c4d5e', usd: 0.41, cachePct: 91, next: 'spawn TASK-bd-a1 (reviewer)' })
    expect(c).toBe(GOLD.card); expect(c.length).toBeLessThanOrEqual(600)
    expect(card({ id: 'x', title: 'y'.repeat(900), role: 'worker', to: 'review', next: 'wait' }).length).toBe(600)
    expect(card({ id: 'a', title: 'T', role: 'tester', to: 'worker', flags: ['edited:pm:title'], next: 'wait' })).toBe('TASK a "T" · tester → worker · flags: edited:pm:title · next: wait')
  })
  test('state tags: review·merge is review✓; subject prefix', () => {
    expect([tag({ state: 'review', step: 'merge' }), tag({ state: 'review', step: 'reviewer' }), tag({ state: 'todo', step: '' })]).toEqual(['review✓', 'review', 'todo'])
    expect(subject(task('a', { state: 'review', step: 'merge', title: 'Add' }))).toBe('[review✓] Add')
  })
  test('commit message: Conventional Commits with footers', () => {
    expect(commitMessage({ type: 'feat', scope: 'auth', description: 'add login', summary: 'Adds email login.', id: 'bd-a1', reviewSha: '1a2b3c4d5e6f', checks: ['test ✓', 'lint ✓'] })).toBe(GOLD.commit)
    expect(commitMessage({ type: 'fix', breaking: true, description: 'drop v1 api', breakingNote: 'v1 endpoints are gone', id: 'bd-b2' })).toBe(GOLD.breaking)
  })
  test('beads comment: [cadre:<kind> v1] header, computed facts, claimed block', () => {
    expect(comment({ schemaVersion: 1, kind: 'check', taskId: 'bd-a1', at: 1700, actor: 'mod', computed: { name: 'test', exit: 0, secs: 41 }, claimed: { note: 'ok' } })).toBe(GOLD.comment)
    expect(comment({ schemaVersion: 1, kind: 'cost', taskId: 'a', at: 1, actor: 'mod', computed: { tokens: 5 }, claimed: {} })).toBe('[cadre:cost v1] a @1 by mod\ntokens: 5')
  })
  test('TaskGet text: scenarios, contract, changelog, facts line, records sorted', () => {
    const t = { id: 'a1', title: 'Add login', description: 'Email login.', acceptance: 'S1: Given a When b Then c\nS2: Given d When e Then f', type: 'feature', category: 'review' as const, nativeStatus: 'in_review', priority: 2 as const, deps: [], labels: [], updatedAt: '',
      design: JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: ['e: string'], returns: 'Session', errors: ['AuthError'], doc: 'logs in', status: 'changed' }] }),
      meta: { 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }), 'cadre.package': '.', 'cadre.breaking': 'true', 'cadre.rec.green': 'green ✓ test 41s', 'cadre.rec.check': 'lint ✓' } }
    expect(taskText(t, task('a1', { state: 'review', step: 'reviewer', owner: 'ag3', flags: ['edited:pm:title'] }))).toBe(GOLD.get)
    expect(taskText({ ...t, acceptance: undefined, design: JSON.stringify({ none: true, reason: 'no api' }), meta: {} })).toBe('Email login.\nContract: none (no api)\ntype feature')
  })
})
