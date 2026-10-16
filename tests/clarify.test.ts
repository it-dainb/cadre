// Clarify before a goal's plan, and /cadre deep (ADR 0020): one explorer, a recorded clarity, at most N informed questions in one round (yolo: assumptions
// in the dialog), the deep loop's rounds, and the goal-run stop check telling the explorer from the ask step.
import { describe, expect, test } from 'claude-code/testing'
import { clarifyCall, clarifyCheck, deepLine, guideOf, nextStep } from '../core/clarify'
import { goal, sendBrief } from '../core/lanes'
import { seen, stopCheck } from '../commands/agentrun'
import { parse, status } from '../commands/cadre'
import { taskCall } from './fixtures/native/world'
import { warm } from '../core/session'
import { defaults } from '../config/index'
import type { Config } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { BUDGET } from './fixtures/budget.generated'
import { banned } from './fixtures/wording'
import { fakeHost } from './support'

const G = (BUDGET.guides as Record<string, string>).goal, DEEP = (BUDGET.guides as Record<string, string>).deep
const VAGUE = { outcome: 0.9, scope: 0.4, acceptance: 0.5, constraints: 0.8 }, CLEAR = { outcome: 0.9, scope: 0.8, acceptance: 0.9, constraints: 0.8 }
async function on(o: { mode?: 'auto' | 'yolo'; deep?: boolean; cfg?: (c: Config) => void } = {}) {
  const c = defaults(); o.cfg?.(c)
  const s = new MemoryStore(), sent: string[] = [], h = Object.assign(fakeHost({ files: { '/plug/guides/goal.md': G, '/plug/guides/deep.md': DEEP } }), { root: async () => '/plug', config: async () => c, taskStore: async () => s, submit: async (t: string) => { sent.push(t) } })
  await s.init({ journal: true } as any); await h.board.update(b => ({ ...b, mission: 'ship it' })); await warm(h)
  await goal(h, 'add a section to the landing page', o.mode ?? 'auto', !!o.deep); await sendBrief(h)
  const call = async (e: any) => { const d = await clarifyCall(h, e); if (d) return d; if (e.tool === 'TaskCreate') { await seen(h, { name: 'mcp__cadre__plan' }); return taskCall(h, { tool_use_id: 'u', ...e }) } return 'PASS' }   // seen: main's tool, as the inner tool.call does
  const clarity = (v: Record<string, number>) => call({ tool: 'TaskCreate', subject: 'clarity', description: '', metadata: { kind: 'clarity', ...v } })
  const askQ = async (n: number) => { const r = await call({ tool: 'AskUserQuestion', questions: Array.from({ length: n }, (_, i) => ({ question: `q${i}` })) }); if (r === 'PASS') await seen(h, { name: 'AskUserQuestion' }); return r }
  const explore = async () => { await seen(h, { name: 'mcp__cadre__explore', ask: true }); await h.ui.update(u => ({ ...u, asks: { a1: { id: 'ask-1', q: 'x', k: 0 } } })) }   // main's explore tool: the first of a goal run is its clarify explorer
  const answered = () => h.ui.update(u => ({ ...u, asks: { a1: { id: 'ask-1', q: 'x', k: 0, answer: 'Hero, Navbar, Timeline in components/' } } }))
  return { h, s, sent, call, clarity, askQ, explore, answered }
}
const ctx = (r: any) => String(r?.context?.[0] ?? r?.deny ?? r)

describe('clarify gate (default on)', () => {
  test('the brief carries the clarify step with the settings\' numbers; off drops it; deep replaces it', async () => {
    const p = defaults().planning, on1 = guideOf(G, p)
    expect(on1).toContain('## Before step 2: clarify'); expect(on1).toContain('at most 3 questions'); expect(on1).not.toContain('{maxQuestions}')
    expect(guideOf(G, { ...p, clarify: { ...p.clarify, enabled: false } })).not.toContain('clarify')
    const d = guideOf(G, p, DEEP); expect(d).toContain('talk it through'); expect(d).toContain('at most 8'); expect(d).not.toContain('## Before step 2: clarify')
    for (const t of [on1, d]) expect(banned(t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''))).toEqual([])
    expect(G).not.toMatch(/do not ask the user\. They approve/)   // the mission is drafted from the user's answers too
  })
  test('a vague goal: explorer first → clarity → at most 3 informed questions in ONE round → the plan', async () => {
    const w = await on()
    expect(ctx(await w.clarity(VAGUE))).toMatch(/^call explore first with what in the project the goal touches/)
    await w.explore()
    expect(await stopCheck(w.h, {})).toBeNull()   // the explorer is still answering: its answer brings the next turn
    await w.answered(); expect(await stopCheck(w.h, {})).toMatch(/^The goal is not planned yet/)   // carry-over: exploring is not the ask step
    expect(ctx(await w.askQ(1))).toMatch(/^record the clarity first/)
    const r = ctx(await w.clarity(VAGUE)); expect(r).toContain('clarity: outcome 0.9 · scope 0.4 · acceptance 0.5 · constraints 0.8'); expect(r).toContain('at most 3 questions in ONE AskUserQuestion call, about scope, acceptance'); expect(r).toContain('name what the explorer found'); expect(banned(r)).toEqual([])
    expect(ctx(await w.askQ(4))).toBe('at most 3 questions: keep the ones about scope, acceptance.')
    expect(await clarifyCheck(w.h, { tool: 'AskUserQuestion', tool_use_id: 'q1', input: { questions: [{}, {}] } })).toBeUndefined()   // the permission step judges and counts it once
    expect(await clarifyCall(w.h, { tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{}, {}] })).toBeUndefined(); await seen(w.h, { name: 'AskUserQuestion' })   // the same call at tool.call: not judged again (live: refused as a second round)
    expect(await stopCheck(w.h, {})).toBeNull()   // a stop right after the question passes
    expect(ctx(await w.askQ(1))).toBe('you asked already: draft the plan now with the answers you have.')
    expect(await clarifyCheck(w.h, { tool: 'AskUserQuestion', tool_use_id: 'p', input: { questions: [{}] } }, { plugin: 'cadre' })).toBeUndefined()   // cadre's own dialog (the plan approval) is never refused (live)
    expect(await clarifyCall(w.h, { tool: 'AskUserQuestion', tool_use_id: 'p', questions: [{}] }, { plugin: 'cadre' })).toBeUndefined()
    expect(ctx(await clarifyCall(w.h, { tool: 'AskUserQuestion', tool_use_id: 'm', questions: [{}] }, { plugin: 'engine' }))).toMatch(/^you asked already/)   // the model's own call keeps its check
    expect(ctx(await w.clarity(CLEAR))).toMatch(/clear\. Draft the plan now\.$/)
    await w.call({ tool: 'TaskCreate', subject: 'Add a Timeline section', description: 'components/Timeline', metadata: { kind: 'plan', lane: 'lite', reason: 'one section', type: 'feature', changelog: { category: 'Added', entry: 'timeline' } } })
    expect(await stopCheck(w.h, {})).toBeNull(); expect((await w.h.secret.read()).goalRun).toBeUndefined()
  })
  test('a clear goal: no questions', async () => {
    const w = await on(); await w.explore(); await w.answered()
    expect(await clarifyCheck(w.h, { tool: 'AskUserQuestion', input: { questions: [{}] } })).toEqual({ decision: 'deny', reason: expect.stringMatching(/^record the clarity first/) })   // the dialog opens at the permission step: refused before the user sees it (live)
    expect(ctx(await w.clarity(CLEAR))).toBe('clarity: outcome 0.9 · scope 0.8 · acceptance 0.9 · constraints 0.8 · clear. Draft the plan now.')
    expect(ctx(await w.askQ(1))).toBe('the goal is clear enough: draft the plan now.')
  })
  test('yolo: no questions; the plan must list its assumptions, and the approval dialog shows them', async () => {
    const w = await on({ mode: 'yolo' }); await w.explore(); await w.answered()
    expect(ctx(await w.clarity(VAGUE))).toMatch(/unclear: scope, acceptance\. Do not ask the user/)
    expect(ctx(await w.askQ(1))).toMatch(/^do not ask the user here/)
    const plan = { tool: 'TaskCreate', subject: 'Add a Timeline section', description: 'components/Timeline', metadata: { kind: 'plan', lane: 'lite', reason: 'one section', type: 'feature', changelog: { category: 'Added', entry: 'timeline' } } }
    expect(ctx(await w.call(plan))).toBe('list what you assumed for scope, acceptance: assumed on the plan, one line per point ("<point>: what you assumed")')
    const ok = await w.call({ ...plan, metadata: { ...plan.metadata, assumed: ['scope: the Timeline section only', 'acceptance: it renders on the landing page'] } }); expect(ok.deny).toBeUndefined()
    const d = ((await w.h.board.read()).decisions ?? []).find(x => x.id.startsWith('plan:'))!
    expect(d.lines).toEqual(expect.arrayContaining(['assumed: scope: the Timeline section only', 'assumed: acceptance: it renders on the landing page']))
  })
  test('clarify off: no clarity step, questions as before', async () => {
    const w = await on({ cfg: c => { c.planning.clarify.enabled = false } }); await w.explore()
    expect(ctx(await w.clarity(VAGUE))).toBe('no clarity record is needed here: draft the plan'); expect(await w.askQ(4)).toBe('PASS')
  })
  test('a stop after each new missing step is refused on its own count (a lazy main: not planned x2, then a plan with no task)', async () => {
    const w = await on()
    for (let i = 0; i < 2; i++) expect(await stopCheck(w.h, {})).toMatch(/^The goal is not planned yet/)
    await w.call({ tool: 'TaskCreate', subject: 'Add a Timeline section', description: 'd', metadata: { kind: 'plan', lane: 'full', reason: 'a feature' } })
    expect(await stopCheck(w.h, {})).toMatch(/^Plan \S+ has no tasks yet/)
  })
  test('the ask step: a second explore (the goal\'s own question) ends the goal run\'s check; with clarify off the first one does', async () => {
    const w = await on(); await w.explore(); await w.answered(); expect(await stopCheck(w.h, {})).toMatch(/^The goal is not planned yet/)
    await seen(w.h, { name: 'mcp__cadre__explore', ask: true }); expect(await stopCheck(w.h, {})).toBeNull()
    const v = await on({ cfg: c => { c.planning.clarify.enabled = false } }); await seen(v.h, { name: 'mcp__cadre__explore', ask: true }); expect(await stopCheck(v.h, {})).toBeNull()
    const u = await on(); await seen(u.h, { name: 'mcp__cadre__explore' }); expect((await u.h.secret.read()).goalRun?.explored).toBeUndefined()   // reading an answer again ({id}) is no explorer
  })
})

describe('/cadre deep', () => {
  test('parse: deep <goal> is its own form; bare deep is a hint; the ready line names it', async () => {
    expect(parse('deep add a pricing page')).toEqual({ cmd: 'deep', args: ['add a pricing page'] })
    expect(parse('deep')).toMatchObject({ hint: expect.stringContaining('usage: /cadre deep <goal>') })
    expect(parse('deeply nested bug')).toEqual({ cmd: 'goal', args: ['deeply nested bug'] })
  })
  test('rounds: one question each at the weakest point, a fresh score between them, a visible score, the cap; then the plan', async () => {
    const w = await on({ deep: true, cfg: c => { c.planning.deep.maxRounds = 2 } })
    expect(w.sent[0]).toContain('talk it through'); expect(w.sent[0]).toContain('at most 2')
    await w.explore(); await w.answered()
    expect(ctx(await w.clarity(VAGUE))).toContain('weakest: scope. Show the user these scores in one line, then ask ONE question about scope')
    expect(await status(w.h)).toContain('talking it through · round 1/2 · outcome 0.9 · scope 0.4')
    expect(ctx(await w.askQ(2))).toBe('one question per round: ask only about scope.')
    expect(await w.askQ(1)).toBe('PASS'); expect(await stopCheck(w.h, {})).toBeNull()
    expect(ctx(await w.askQ(1))).toMatch(/^record the clarity again first/)
    expect(ctx(await w.clarity({ ...VAGUE, scope: 0.8 }))).toContain('weakest: acceptance'); expect(await w.askQ(1)).toBe('PASS')
    expect(ctx(await w.clarity({ ...VAGUE, scope: 0.8 }))).toContain('the question rounds are used up. Draft the plan now')
    expect(ctx(await w.askQ(1))).toBe('the question rounds are used up: draft the plan now.')
  })
  test('deep asks even when the mode is yolo (the mode applies after approval)', () => {
    expect(nextStep(VAGUE, defaults().planning, { mode: 'yolo', deep: true }).text).toContain('ask ONE question about scope')
    expect(deepLine(undefined, defaults().planning)).toBeNull()
  })
})
