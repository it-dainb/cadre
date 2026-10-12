// Lanes (ADR 0011): ask | lite | full. `/cadre <goal>` queues one brief (guides/goal.md, inlined: main cannot read the plugin folder); main picks the lane.
// Here: the deterministic override (pure), the plan's lane on the board + its tasks' `cadre.lane` (pipeline, completeness), the card's lane line and [l] lane.
import { modelText } from './say'
import type { DecisionOption, Host, Plan } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { defaults, kindOf, type TypeRegistry } from '../task-management/registry'
import { cfgOf, draftsOf, missionOf, storeOf, touched } from './dispatch'
import { plural, settleIf } from './decide'
import { MS } from './milestone'
import { epicBranch } from './branches'

export type Lane = 'ask' | 'lite' | 'full' | 'milestone'
export const LANES: readonly Lane[] = ['ask', 'lite', 'full']
const isPublic = (t: Task) => { try { const c = JSON.parse(t.design || 'null'); return !!c && !c.none && (c.symbols ?? []).some((s: any) => s.status === 'new' || s.status === 'changed') } catch { return false } }

// the lane a draft plan gets: main's (or the human's) pick, overridden to full by risk or size; an ask plan holding a code change becomes lite (one task) or full
export function laneOf(asked: Lane, drafts: Task[], reg: TypeRegistry): { lane: Lane; why?: string } {
  if (asked === 'milestone') return { lane: 'milestone' }   // a roadmap of epics (ADR 0015): never overridden down
  const big = drafts.length > 7, why = big ? `${drafts.length} tasks: a milestone fits` : drafts.some(t => t.meta['cadre.breaking'] === 'true') ? 'a task is breaking'
    : drafts.some(t => t.labels?.includes('security') || t.meta['cadre.scope'] === 'security') ? 'a task touches security'
    : drafts.some(isPublic) ? 'a public contract is new or changed'
    : drafts.length >= 3 ? `${drafts.length} tasks`
    : asked === 'lite' && drafts.length > 1 ? 'lite is one task' : ''
  if (why) return asked === 'full' && !big ? { lane: 'full' } : { lane: 'full', why }
  const code = drafts.some(t => { const s = reg[t.type]; return !s || kindOf(s) !== 'spike' })
  if (asked === 'ask' && code) return drafts.length === 1 ? { lane: 'lite', why: 'it changes code' } : { lane: 'full', why: 'it changes code' }
  return { lane: asked }
}
// task lane: 'lite' drops tester/red (registry.pipeOf); 'lite+tdd' (a bug a test reproduces) keeps the type's full pipeline
const taskLane = (lane: Lane, t: Task, reg: TypeRegistry) => (lane !== 'lite' ? '' : t.meta['cadre.repro'] === 'true' && reg[t.type]?.pipeline.includes('tester') ? 'lite+tdd' : 'lite')

const MODE_TTL = 3_600_000
// after any draft change of a first draft (native/tasks, before touched): the effective lane onto the board and the tasks
export async function relane(h: Host, store: TaskStore, reg: TypeRegistry): Promise<void> {
  const p = (await h.board.read()).plan; if (!p || p.slug === 'mission' || p.state !== 'draft' || p.approvedAt) return
  const epic = await store.get(p.id), asked = (epic.meta['cadre.lane'] || 'full') as Lane, drafts = await draftsOf(store, p.id), r = laneOf(asked, drafts, reg)
  let mode = epic.meta['cadre.mode'] as 'auto' | 'yolo' | undefined
  if (!mode) {   // the mode of the goal that started it (`/cadre yolo <goal>`), taken once; a plan main starts on its own is auto
    const def = (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto'   // drive.mode: the user's default (a repo file can only force auto)
    const now = await h.now()
    await h.ui.update(u => { const fresh = typeof u.modeAt === 'number' && now - u.modeAt < MODE_TTL; mode = fresh && (u.mode === 'yolo' || u.mode === 'auto') ? u.mode : def; const { mode: _m, modeAt: _a, ...rest } = u; return rest })   // ponytail: the next plan within the hour takes it (the goal may go to the ask lane first); an older one is stale, never a plan main starts later on its own
    await store.setMeta(p.id, { 'cadre.mode': mode! }, 'human')
  }
  for (const t of drafts) { const l = taskLane(r.lane, t, reg); if ((t.meta['cadre.lane'] ?? '') !== l) await store.setMeta(t.id, { 'cadre.lane': l }, 'main') }
  await h.board.update(b => (b.plan?.id === p.id ? { ...b, plan: { ...b.plan, mode, lane: r.lane, laneReason: epic.meta['cadre.laneReason'] || undefined, laneOverride: r.why } } : b))
}
export async function retouch(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> { await relane(h, store, reg); return touched(h, store, reg) }

// the roadmap rules (main's planning API for the milestone lane), in the plan's first answer and in a lane change brief
export const roadmapRules = (id = '<plan id>'): string => [
  'Roadmap rules',
  '- Every later TaskCreate is one epic of this milestone: subject = its name, description = its goal in one line, metadata {"size": <its tasks, 1-7>, "paths": ["files or folders it changes"]}. Order epics with TaskUpdate addBlockedBy.',
  '- An epic is a plan of 1-7 tasks that works on its own. Code that 2+ epics need goes into ONE thin core epic first (metadata.core:true, size 1-2) that blocks them. Two epics on one path need a dependency. Epics with no dependency path between them run at the same time.',
  `- When "missing:" says critic review: spawn ONE Agent (no task id) with the whole roadmap in its prompt (each epic: id, name, goal, size, paths, dependencies) and ask it for gaps, overlaps, a wrong order, epics too big or too small, and a missing core epic. Fix what it gets right, then TaskUpdate ${id} with metadata.critique "<what it found and what you changed>".`,
  '- The user approves the roadmap only. Each epic\'s tasks are planned when the next: line names the epic.',
].join('\n')
// the decision's first line (core/dispatch.redraw): "auto · lite · 1 task · fix · <reason>" (the mode drive runs it in, ADR 0013); an override names itself
export function laneLine(plan: Plan | null, drafts: Task[], reg: TypeRegistry = defaults()): string | null {
  if (!plan?.lane) return null
  const n = plural(drafts.length, plan.lane === 'milestone' ? 'epic' : 'task'), ty = drafts.length === 1 ? reg[drafts[0].type]?.commit ?? drafts[0].type : ''
  return [plan.mode ?? 'auto', plan.lane, n, ty, plan.laneOverride ? `${plan.laneOverride} → ${plan.lane}` : '', plan.laneReason ?? ''].filter(Boolean).join(' · ').slice(0, 160)
}
// the Lane → <next> option: ask → lite → full → ask, skipping a lane the plan cannot take; null when there is nothing to change
export function nextLane(plan: Plan, drafts: Task[], reg: TypeRegistry): Lane {
  if (plan.lane === 'milestone') return 'full'; if (drafts.length > 7) return 'milestone'   // more than 7 tasks: offer the milestone lane; a roadmap goes back to one plan
  const from = LANES.indexOf(plan.lane ?? 'full')
  for (let i = 1; i < 3; i++) { const l = LANES[(from + i) % 3]; if (l === 'ask' || laneOf(l, drafts, reg).lane === l) return l }
  return 'ask'
}
export const laneOption = (plan: Plan | null, drafts: Task[], reg: TypeRegistry = defaults()): DecisionOption | null =>
  plan?.lane && plan.state === 'draft' && !plan.approvedAt ? { key: 'l', label: `Lane → ${nextLane(plan, drafts, reg)}`, verb: 'change', run: `lane ${plan.id}` } : null

// `lane <planId>` (the plan decision's Lane option, dialog only: commands/cadre). ask drops the draft plan and asks main to spawn the question; full asks main for the missing fields.
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
  const ms = to === 'milestone' || p.lane === 'milestone'
  if (ms) { await store.dropDrafts(drafts.map(t => t.id)); const pre = to === 'milestone' ? MS : (await cfgOf(h)).branches.epicPrefix; await h.board.update(b => (b.plan ? { ...b, tasks: [], plan: { ...b.plan, epics: undefined, epicBranch: epicBranch(pre, p.id, epic.title) } } : b)) }   // tasks and epics do not convert: main drafts the other shape
  await store.setMeta(p.id, { 'cadre.lane': to, 'cadre.laneReason': 'changed by you' }, 'human')
  await retouch(h, store, reg)
  if (to === 'milestone') await queueBrief(h, `The user moved plan ${p.id} to the milestone lane: its tasks were dropped. Draft it as a roadmap of epics instead.\n${roadmapRules(p.id)}`)
  else if (ms) await queueBrief(h, `The user moved plan ${p.id} from the milestone lane to one plan: its epics were dropped. Draft its tasks now (TaskCreate per task, as the plan rules say), then tell the user to approve it in the dialog (key 1 opens it).`)
  else if (to === 'full') await queueBrief(h, `The user moved plan ${p.id} to the full lane. Give each task what the plan rules ask (scenarios, interface, changelog, package) and split it into tasks if needed; the "missing:" line says what is left. Then tell the user to approve it in the dialog (key 1 opens it).`)
  return `${p.id}: lane ${to}`
}

// ---- briefs to main (the goal, a change request, an approved plan): `$.prompt.submit` is refused from a command or press frame (live 0.7.0), so it waits in `ui.goal` and goes out from commands/agentrun.pump ----
export const queueBrief = (h: Host, text: string) => h.ui.update(u => ({ ...u, goal: text }))
export async function sendBrief(h: Host): Promise<void> {
  let text: string | undefined; await h.ui.update(u => { text = u.goal as string | undefined; if (!text) return u; const { goal: _g, ...r } = u; return r })
  if (!text) return
  await h.submit?.(modelText('brief', text)).catch((e: Error) => h.log(`could not hand the goal to Claude: ${e.message.slice(0, 120)}`))
  const now = await h.now(); await h.secret.update(s => (s.goalRun && !s.goalRun.on ? { ...s, goalRun: { ...s.goalRun, on: true, seen: now } } : s))   // the goal run starts when main has the brief (commands/agentrun.goalStop)
}
// `/cadre <goal>` · `/cadre yolo <goal>` (commands/cadre, human origin, active repo): the guide inlined after the goal
export async function goal(h: Host, text: string, mode: 'auto' | 'yolo' = 'auto'): Promise<string> {
  const g = await h.readText(`${(await h.root?.()) ?? '.'}/guides/goal.md`)
  if (!g) return 'the goal guide is missing from the plugin; ask the human to reinstall it'
  const at = await h.now(); await h.ui.update(({ halt: _h, ...u }) => ({ ...u, mode, modeAt: at }))
  await h.secret.update(s => ({ ...s, goalRun: { text, mode, follow: 0 } }))   // main's stop is checked until the lane's step is done (commands/agentrun.goalStop)   // relane stamps it on the plan this goal drafts (within MODE_TTL)
  const none = !(await h.board.read()).mission && !(await Promise.resolve().then(() => storeOf(h)).then(missionOf).catch(() => 'unknown'))   // no recorded mission (a repo set up for this goal): main drafts it into the plan (ADR 0014)
  await queueBrief(h, `Goal from the user: ${text.slice(0, 1000)}${none ? '\nThere is no mission yet.' : ''}\n\n${g}`)
  return `goal${mode === 'yolo' ? ' (yolo)' : ''}: Claude is on it · the plan comes up for approval${mode === 'yolo' ? ' · after that nothing is asked until it lands on dev' : ''}`
}
