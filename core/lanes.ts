// Lanes (ADR 0011): ask | lite | full. `/cadre <goal>` queues one brief (guides/goal.md, inlined: main cannot read the plugin folder); main picks the lane.
// Here: the deterministic override (pure), the plan's lane on the board + its tasks' `cadre.lane` (pipeline, completeness), the card's lane line and [l] lane.
import type { DecisionOption, Host, Plan } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { defaults, kindOf, type TypeRegistry } from '../task-management/registry'
import { draftsOf, touched } from './dispatch'
import { settleIf } from './decide'

export type Lane = 'ask' | 'lite' | 'full'
export const LANES: readonly Lane[] = ['ask', 'lite', 'full']
const isPublic = (t: Task) => { try { const c = JSON.parse(t.design || 'null'); return !!c && !c.none && (c.symbols ?? []).some((s: any) => s.status === 'new' || s.status === 'changed') } catch { return false } }

// the lane a draft plan gets: main's (or the human's) pick, overridden to full by risk or size; an ask plan holding a code change becomes lite (one task) or full
export function laneOf(asked: Lane, drafts: Task[], reg: TypeRegistry): { lane: Lane; why?: string } {
  const why = drafts.some(t => t.meta['cadre.breaking'] === 'true') ? 'a task is breaking'
    : drafts.some(t => t.labels?.includes('security') || t.meta['cadre.scope'] === 'security') ? 'a task touches security'
    : drafts.some(isPublic) ? 'a public contract is new or changed'
    : drafts.length >= 3 ? `${drafts.length} tasks`
    : asked === 'lite' && drafts.length > 1 ? 'lite is one task' : ''
  if (why) return asked === 'full' ? { lane: 'full' } : { lane: 'full', why }
  const code = drafts.some(t => { const s = reg[t.type]; return !s || kindOf(s) !== 'spike' })
  if (asked === 'ask' && code) return drafts.length === 1 ? { lane: 'lite', why: 'it changes code' } : { lane: 'full', why: 'it changes code' }
  return { lane: asked }
}
// task lane: 'lite' drops tester/red (registry.pipeOf); 'lite+tdd' (a bug a test reproduces) keeps the type's full pipeline
const taskLane = (lane: Lane, t: Task, reg: TypeRegistry) => (lane !== 'lite' ? '' : t.meta['cadre.repro'] === 'true' && reg[t.type]?.pipeline.includes('tester') ? 'lite+tdd' : 'lite')

// after any draft change of a first draft (native/tasks, before touched): the effective lane onto the board and the tasks
export async function relane(h: Host, store: TaskStore, reg: TypeRegistry): Promise<void> {
  const p = (await h.board.read()).plan; if (!p || p.slug === 'mission' || p.state !== 'draft' || p.approvedAt) return
  const epic = await store.get(p.id), asked = (epic.meta['cadre.lane'] || 'full') as Lane, drafts = await draftsOf(store, p.id), r = laneOf(asked, drafts, reg)
  for (const t of drafts) { const l = taskLane(r.lane, t, reg); if ((t.meta['cadre.lane'] ?? '') !== l) await store.setMeta(t.id, { 'cadre.lane': l }, 'main') }
  await h.board.update(b => (b.plan?.id === p.id ? { ...b, plan: { ...b.plan, lane: r.lane, laneReason: epic.meta['cadre.laneReason'] || undefined, laneOverride: r.why } } : b))
}
export async function retouch(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> { await relane(h, store, reg); return touched(h, store, reg) }

// the card (core/dispatch.redraw): "lite · 1 task · fix · <reason>"; an override names itself
export function laneLine(plan: Plan | null, drafts: Task[], reg: TypeRegistry = defaults()): string | null {
  if (!plan?.lane) return null
  const n = `${drafts.length} task${drafts.length === 1 ? '' : 's'}`, ty = drafts.length === 1 ? reg[drafts[0].type]?.commit ?? drafts[0].type : ''
  return [plan.lane, n, ty, plan.laneOverride ? `${plan.laneOverride} → ${plan.lane}` : '', plan.laneReason ?? ''].filter(Boolean).join(' · ').slice(0, 160)
}
// [l] Lane → <next>: ask → lite → full → ask, skipping a lane the plan cannot take; null when there is nothing to change
export function nextLane(plan: Plan, drafts: Task[], reg: TypeRegistry): Lane {
  const from = LANES.indexOf(plan.lane ?? 'full')
  for (let i = 1; i < 3; i++) { const l = LANES[(from + i) % 3]; if (l === 'ask' || laneOf(l, drafts, reg).lane === l) return l }
  return 'ask'
}
export const laneOption = (plan: Plan | null, drafts: Task[], reg: TypeRegistry = defaults()): DecisionOption | null =>
  plan?.lane && plan.state === 'draft' && !plan.approvedAt ? { key: 'l', label: `Lane → ${nextLane(plan, drafts, reg)}`, verb: 'change', run: `lane ${plan.id}` } : null

// `lane <planId>` (the card's [l], press only: commands/cadre). ask drops the draft plan and asks main to spawn the question; full asks main for the missing fields.
export async function changeLane(h: Host, store: TaskStore, reg: TypeRegistry, planId: string): Promise<string> {
  const p = (await h.board.read()).plan
  if (!p || p.id !== planId || !laneOption(p, [], reg)) return `refused: no first draft plan ${planId}`
  const drafts = await draftsOf(store, p.id), to = nextLane(p, drafts, reg), epic = await store.get(p.id)
  if (to === 'ask') {
    await store.dropDrafts([...drafts.map(t => t.id), p.id])
    await store.record('decision', `Plan ${p.id} moved to the ask lane`, epic.title)
    await h.board.update(b => ({ ...b, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b); await settleIf(h, 'plan:')
    await queueBrief(h, `The user moved "${epic.title}" to the ask lane: it needs an answer, not a change. Spawn one Agent with this question as its prompt and stop:\n${epic.title}\n${epic.description}`.trim())
    return `${p.id}: moved to the ask lane · Claude asks an explorer`
  }
  await store.setMeta(p.id, { 'cadre.lane': to, 'cadre.laneReason': 'changed by you' }, 'human')
  await retouch(h, store, reg)
  if (to === 'full') await queueBrief(h, `The user moved plan ${p.id} to the full lane. Give each task what the plan rules ask (scenarios, interface, changelog, package) and split it into tasks if needed; the "missing:" line says what is left. Then tell the user to approve it on the card.`)
  return `${p.id}: lane ${to}`
}

// ---- the goal brief: `$.prompt.submit` is refused from a command or press frame (live 0.7.0), so it waits in `ui.goal` and goes out from commands/agentrun.pump ----
export const queueBrief = (h: Host, text: string) => h.ui.update(u => ({ ...u, goal: text }))
export async function sendBrief(h: Host): Promise<void> {
  let text: string | undefined; await h.ui.update(u => { text = u.goal as string | undefined; if (!text) return u; const { goal: _g, ...r } = u; return r })
  if (text) await h.submit?.(text).catch((e: Error) => h.log(`cadre: could not hand the goal to Claude: ${e.message.slice(0, 120)}`))
}
// `/cadre <goal>` (commands/cadre, human origin, active repo): the guide inlined after the goal
export async function goal(h: Host, text: string): Promise<string> {
  const g = await h.readText(`${(await h.root?.()) ?? '.'}/guides/goal.md`)
  if (!g) return 'cadre: the goal guide is missing from the plugin; reinstall cadre'
  await queueBrief(h, `Goal from the user: ${text.slice(0, 1000)}\n\n${g}`)
  return 'goal: Claude is on it · the lane and the plan show on the card'
}
