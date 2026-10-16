import { describe, expect, test } from 'claude-code/testing'
import { HINT, parse, run } from '../commands/cadre'
import { changeLane, goal, laneLine, laneOf, laneOption, nextLane, sendBrief } from '../core/lanes'
import { transition } from '../core/machine'
import { missingOf } from '../core/validate'
import { defaults, pipeOf } from '../task-management/registry'
import type { Task } from '../task-management/store'
import type { Plan } from '../types'
import { guideOf } from '../core/clarify'
import { defaults as cfgDefaults } from '../config/index'
import { BUDGET } from './fixtures/budget.generated'
import { banned } from './fixtures/wording'
import { fakeHost, task } from './support'
import { world } from './fixtures/native/world'

const reg = defaults()
const T = (o: Partial<Task> = {}): Task => ({ id: 'a', title: 'Fix it', description: 'what and why', type: 'bug', category: 'draft', nativeStatus: 'draft', priority: 2, deps: [], labels: [], meta: {}, updatedAt: '', ...o })
const P = (o: Partial<Plan> = {}): Plan => ({ id: 'p1', slug: 's', state: 'draft', epicBranch: 'epic/p1-s', ...o })
const LITE = { kind: 'plan', lane: 'lite', reason: 'one small fix in src/a.ts', type: 'bug', changelog: { category: 'Fixed', entry: 'off-by-one in paging' } }

describe('the typed surface (ADR 0011): five forms only', () => {
  test('pane, setup, init, doctor, goal; old subcommand words get the button hint; goal text passes whole', () => {
    expect(parse('')).toEqual({ cmd: 'pane', args: [] }); expect(parse('  ')).toEqual({ cmd: 'pane', args: [] })
    for (const w of ['setup', 'init', 'doctor']) expect(parse(w)).toEqual({ cmd: w, args: [] })
    for (const t of ['approve p3', 'reject p3 no', 'resolve a1 keep', 'restore', 'release 1.2.0', 'drive on', 'config set x 1', 'sync add redmine', 'adapter token', 'status', 'open plan', 'confirm', 'cancel', 'resume', 'init confirm', 'setup cancel', 'lane p1'])
      expect(parse(t)).toEqual({ hint: HINT })
    expect(parse('fix the off-by-one in src/page.ts')).toEqual({ cmd: 'goal', args: ['fix the off-by-one in src/page.ts'] })
    expect(parse('Setup CI for this repo')).toEqual({ cmd: 'goal', args: ['Setup CI for this repo'] })   // a goal may start with a capitalized word
    expect(parse('what does src/x do?')).toEqual({ cmd: 'goal', args: ['what does src/x do?'] })
  })
  test('a goal: dormant repo refused; only the composer starts one; the brief waits for the timer and carries the guide', async () => {
    const off = fakeHost(); await off.secret.update(() => ({}))
    expect(await run(off, { args: 'fix the bug', origin: { kind: 'composer' } }, () => ({}))).toEqual({ text: 'Welcome to cadre · run /cadre setup once on this machine' })   // a machine without setup: the welcome line (tests/onboard.test.ts: the setup dialog)
    const g = (BUDGET.guides as Record<string, string>).goal, sent: string[] = []
    const h = Object.assign(fakeHost({ files: { '/plug/guides/goal.md': g } }), { root: async () => '/plug', submit: async (t: string) => { sent.push(t) } })
    expect((await run(h, { args: 'fix the bug', origin: { kind: 'sdk' } }, () => ({}))).text).toContain('refused')
    expect(await run(h, { args: 'old status', origin: { kind: 'composer' } }, () => ({}))).toEqual({ text: 'goal: Claude is on it · the plan comes up for approval' })
    expect(sent).toEqual([])   // a command frame cannot submit (live 0.7.0)
    await sendBrief(h); await sendBrief(h)
    expect(sent).toEqual([`Goal from the user: old status\nThere is no mission yet.\n\n${guideOf(g, cfgDefaults().planning)}`])   // the (empty) store has none   // the clarify step carries the settings' numbers (ADR 0020); expect((await h.ui.read()).goal).toBeUndefined()
    expect(await goal(fakeHost(), 'x')).toContain('missing')
  })
  test('the guide and every brief speak task language and name the three lanes', async () => {
    const g = (BUDGET.guides as Record<string, string>).goal
    expect(banned(g.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''))).toEqual([])
    for (const k of ['**ask**', '**lite**', '**full**', '"lane": "lite"', '"repro": true', 'Done when']) expect(g).toContain(k)
    const w = await world(); await w.call('TaskCreate', { subject: 'Fix paging', description: 'd', metadata: LITE })
    await w.call('TaskCreate', { subject: 'More', description: 'd', metadata: { type: 'feature' } })
    const p = (await w.h.board.read()).plan!
    await changeLane(w.h, w.store, reg, p.id)   // full → ask: drops the plan, briefs main
    expect(banned((await w.h.ui.read()).goal)).toEqual([])
  })
})

describe('override (pure)', () => {
  const pub = JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: [], returns: 'S', status: 'new' }] })
  const table: [string, 'ask' | 'lite' | 'full', Task[], string, string?][] = [
    ['lite, one small task', 'lite', [T()], 'lite'],
    ['breaking', 'lite', [T({ meta: { 'cadre.breaking': 'true' } })], 'full', 'a task is breaking'],
    ['security label', 'lite', [T({ labels: ['security'] })], 'full', 'a task touches security'],
    ['security scope', 'lite', [T({ meta: { 'cadre.scope': 'security' } })], 'full', 'a task touches security'],
    ['public contract new', 'lite', [T({ design: pub })], 'full', 'a public contract is new or changed'],
    ['contract unchanged', 'lite', [T({ design: JSON.stringify({ symbols: [{ name: 'x', status: 'unchanged' }] }) })], 'lite'],
    ['contract none', 'lite', [T({ design: JSON.stringify({ none: true, reason: 'internal' }) })], 'lite'],
    ['3 tasks', 'lite', [T(), T({ id: 'b' }), T({ id: 'c' })], 'full', '3 tasks'],
    ['lite is one task', 'lite', [T(), T({ id: 'b' })], 'full', 'lite is one task'],
    ['ask with a code task', 'ask', [T()], 'lite', 'it changes code'],
    ['ask with two code tasks', 'ask', [T(), T({ id: 'b' })], 'full', 'it changes code'],
    ['ask with a spike', 'ask', [T({ type: 'spike' })], 'ask'],
    ['full stays full, no override note', 'full', [T({ meta: { 'cadre.breaking': 'true' } })], 'full'],
  ]
  for (const [name, asked, drafts, lane, why] of table) test(name, () => { expect(laneOf(asked, drafts, reg)).toEqual(why ? { lane, why } : { lane }) })
})

describe('lite pipeline and completeness (registry, machine)', () => {
  test('lite drops tester/red where a worker writes the change; lite+tdd and full keep the type pipeline', () => {
    const p = pipeOf(reg)
    expect(p('bug', 'lite')).toEqual(['worker', 'green', 'reviewer', 'merge']); expect(p('feature', 'lite')).toEqual(['worker', 'green', 'reviewer', 'merge'])
    expect(p('docs', 'lite')).toEqual(['worker', 'reviewer', 'merge']); expect(p('test', 'lite')).toEqual(['tester', 'reviewer', 'merge'])
    expect(p('bug', 'lite+tdd')).toEqual(['tester', 'red', 'worker', 'green', 'reviewer', 'merge']); expect(p('bug')).toEqual(reg.bug.pipeline)
  })
  test('machine: a lite task claims at worker and walks green → reviewer → merge; a lite+tdd bug claims at tester', () => {
    const s0 = (lane: string) => ({ ...fakeBoard(), tasks: [task('a', { type: 'bug', lane })] })
    let r = transition(s0('lite'), { kind: 'claim', id: 'a', at: 1, owner: 'w' }, pipeOf(reg)); expect(r.ok && r.board.tasks[0].step).toBe('worker')
    const steps: string[] = []; let b = (r as any).board
    for (const ev of [{ kind: 'advance' }, { kind: 'advance' }, { kind: 'verdict', verdict: 'pass' }] as const) { r = transition(b, { ...ev, id: 'a', at: 2, actor: 'reviewer' }, pipeOf(reg)); if (!r.ok) break; b = r.board; steps.push(b.tasks[0].step) }
    expect(steps).toEqual(['green', 'reviewer', 'merge'])
    r = transition(s0('lite+tdd'), { kind: 'claim', id: 'a', at: 1, owner: 't' }, pipeOf(reg)); expect(r.ok && r.board.tasks[0].step).toBe('tester')
  })
  test('lite completeness = description + changelog decision (no scenarios, contract, package)', () => {
    expect(missingOf(T({ meta: { 'cadre.lane': 'lite' } }), reg)).toEqual(['changelog'])
    expect(missingOf(T({ description: ' ', meta: { 'cadre.lane': 'lite+tdd', 'cadre.changelog': '{"none":true}' } }), reg)).toEqual(['description'])
    expect(missingOf(T({ meta: { 'cadre.lane': 'lite', 'cadre.changelog': '{"none":true}' } }), reg)).toEqual([])
    expect(missingOf(T(), reg)).toEqual(['scenarios', 'changelog', 'interface', 'package'])
  })
})

describe('a lite plan end to end in the store (native/tasks)', () => {
  test('one TaskCreate drafts the plan and its one task; the lane lands on the board and the task; approvable as is', async () => {
    const w = await world(), r = await w.call('TaskCreate', { subject: 'Fix paging', description: 'off-by-one in src/page.ts', metadata: LITE })
    expect(r.context ?? []).toEqual([])   // no plan rules, nothing missing
    const s = await w.h.board.read(), [t] = await w.store.list({ parent: s.plan!.id })
    expect(s.plan).toMatchObject({ lane: 'lite', laneReason: 'one small fix in src/a.ts' }); expect(s.plan!.laneOverride).toBeUndefined()
    expect(t).toMatchObject({ title: 'Fix paging', type: 'bug' }); expect(t.meta['cadre.lane']).toBe('lite'); expect(s.approval.missing).toEqual([])
    expect(laneLine(s.plan, [t], reg)).toBe('auto · lite · 1 task · fix · one small fix in src/a.ts')
  })
  test('repro: a bug a test reproduces runs tester → red first', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'Fix paging', description: 'd', metadata: { ...LITE, repro: true } })
    const [t] = await w.store.list({ parent: (await w.h.board.read()).plan!.id }); expect(t.meta['cadre.lane']).toBe('lite+tdd')
  })
  test('a second task overrides to full: the task loses its lite lane, the full fields are missing, the card names the override', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'Fix paging', description: 'd', metadata: LITE })
    await w.call('TaskCreate', { subject: 'More', description: 'd', metadata: { type: 'feature' } })
    const s = await w.h.board.read(), ds = await w.store.list({ parent: s.plan!.id })
    expect(s.plan).toMatchObject({ lane: 'full', laneOverride: 'lite is one task' }); expect(ds.every(t => !t.meta['cadre.lane'])).toBe(true)
    expect(s.approval.missing.length).toBe(2); expect(laneLine(s.plan, ds, reg)).toBe('auto · full · 2 tasks · lite is one task → full · one small fix in src/a.ts')
  })
  test('validation: lane and reason only with kind plan; lane values; repro is a boolean', async () => {
    const w = await world()
    expect((await w.call('TaskCreate', { subject: 'x', description: 'd', metadata: { kind: 'plan', lane: 'quick' } })).deny).toContain('metadata.lane')
    await w.call('TaskCreate', { subject: 'P', description: 'd', metadata: { kind: 'plan', lane: 'full', reason: 'big' } })
    expect((await w.call('TaskCreate', { subject: 'x', description: 'd', metadata: { lane: 'lite' } })).deny).toContain('with "kind":"plan"')
    expect((await w.call('TaskCreate', { subject: 'x', description: 'd', metadata: { repro: 'yes' } })).deny).toContain('metadata.repro')
  })
})

describe('the card: lane line + [l] Lane (core/lanes)', () => {
  test('option label names the next lane; nothing to change on an approved plan or with no lane', () => {
    expect(laneOption(P({ lane: 'lite' }), [T()], reg)).toEqual({ key: 'l', label: 'Lane → full', verb: 'change', run: 'lane p1' })
    expect(nextLane(P({ lane: 'full' }), [T()], reg)).toBe('ask'); expect(nextLane(P({ lane: 'ask' }), [T()], reg)).toBe('lite')
    expect(nextLane(P({ lane: 'ask' }), [T({ meta: { 'cadre.breaking': 'true' } })], reg)).toBe('full')   // lite would be overridden: skipped
    expect(laneOption(P({ lane: 'lite', state: 'approved' }), [T()], reg)).toBeNull(); expect(laneOption(P(), [T()], reg)).toBeNull(); expect(laneLine(P(), [], reg)).toBeNull()
  })
  test('lite → full re-classifies in place and asks main for the full fields; full → ask drops the plan and asks main for an explorer', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'Fix paging', description: 'off-by-one', metadata: LITE }); const id = (await w.h.board.read()).plan!.id
    expect(await changeLane(w.h, w.store, reg, id)).toBe(`${id}: lane full`)
    const s = await w.h.board.read(), [t] = await w.store.list({ parent: id })
    expect(s.plan).toMatchObject({ lane: 'full', laneReason: 'changed by you', state: 'draft' }); expect(t.meta['cadre.lane']).toBe(''); expect(s.approval.missing[0]).toContain('scenarios')
    expect((await w.h.ui.read()).goal).toContain('full lane')
    expect(await changeLane(w.h, w.store, reg, id)).toContain('ask lane')
    expect((await w.h.board.read()).plan).toBeNull(); expect(await w.store.list({ parent: id })).toEqual([]); expect((await w.h.ui.read()).goal).toContain('Spawn one Agent')
    expect(await changeLane(w.h, w.store, reg, id)).toContain('refused')
  })
  test('lane is a press-only command: typed it is a hint', async () => {
    const w = await world(); expect(await run(w.h, { args: 'lane p1', origin: { kind: 'composer' } }, () => ({}))).toEqual({ text: HINT })
  })
})

function fakeBoard() { return { schemaVersion: 1 as const, seq: 0, repo: '', mission: null, epic: 'p1', plan: P(), tasks: [], approval: { planId: null, missing: [] }, drive: { on: false, level: 'epic' as const, epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown' as const, unsandboxed: 0 }, resumesQueued: 0, init: [] } }
