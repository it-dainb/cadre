// Model-visible text only (DESIGN 6.5): the task record, commit message (CCm), result card (6.4), TaskGet text, main context line (4.5).
// Renderers read only records, the model view and Tasks; the band, toasts and pane are ui/'s.
import type { Snapshot, SnapTask } from '../types'
import type { Task } from '../task-management/store'
import { yoloMain } from './flags'

export interface Rec { schemaVersion: 1; kind: string; taskId: string; at: number; actor: string; computed: Record<string, unknown>; claimed: Record<string, unknown> }
const val = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
const kv = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}: ${val(v)}`)

// canonical record -> the task's cadre.rec.<kind> meta: `[cadre:<kind> v1]` header, then computed facts, then what the agent claimed
export const comment = (r: Rec): string =>
  [`[cadre:${r.kind} v${r.schemaVersion}] ${r.taskId} @${r.at} by ${r.actor}`, ...kv(r.computed), ...(Object.keys(r.claimed).length ? ['claimed:', ...kv(r.claimed).map(l => `  ${l}`)] : [])].join('\n')

// Conventional Commits 1.0.0: `<type>[(<scope>)][!]: <description>` + summary + footers
export interface Commit { type: string; scope?: string; breaking?: boolean; breakingNote?: string; description: string; summary?: string; id: string; reviewSha?: string; checks?: string[] }
export const commitMessage = (c: Commit): string => {
  const head = `${c.type}${c.scope ? `(${c.scope})` : ''}${c.breaking ? '!' : ''}: ${c.description}`
  const foot = [...(c.breaking ? [`BREAKING CHANGE: ${c.breakingNote ?? c.description}`] : []), `Refs: ${c.id}`, ...(c.reviewSha ? [`Cadre-Review: pass@${c.reviewSha.slice(0, 7)}`] : []), ...(c.checks?.length ? [`Cadre-Checks: ${c.checks.join(', ')}`] : [])]
  return [head, ...(c.summary ? [c.summary] : []), foot.join('\n')].join('\n\n')
}

// result card, fixed ≤600 chars: TASK c-a1 "Add login" · worker → review · green ✓ (test 41s) · files 4 (+120 −30) · commit 1a2b3c4 · $0.41 (cache 91%) · flags: none · next: …
export interface Card { id: string; title: string; role: string; to: string; green?: { ok: boolean; check: string; secs: number }; files?: number; add?: number; del?: number; commit?: string; usd?: number; cachePct?: number; flags?: string[]; next: string }
// an agent that stopped without calling report: the mod resumes it right after its stop (core/reuse drain, live: ~2 s), so main must not spawn it again and must not end the turn (a headless run would end with it)
export const noReportCard = (t: { id: string; title: string; flags?: string[] }, role: string, step: string): string =>
  card({ id: t.id, title: t.title, role, to: step, flags: t.flags, next: `wait: the ${role} is finishing its report. Do not spawn it again; call status until ${t.id} leaves ${step}` })
// the next step after an agent finished: a NEW agent. Live (bench, sonnet main): "next: spawn TASK-x (worker)" under a tester's card read as the worker's own
// empty report; main messaged the finished tester and ended its turn. So the line says who finished and the exact call. No ';' (nextAction joins on it).
export const startNew = (id: string, step: string, done?: string): string => `${done ? `the ${done} has finished (do not message it). Now ` : ''}start a NEW agent for the ${step} step: Agent tool, prompt "TASK-${id}"`
export const card = (c: Card): string => [
  `TASK ${c.id} "${c.title}"`, `${c.role} → ${c.to}`,
  c.green && `green ${c.green.ok ? '✓' : '✗'} (${c.green.check} ${c.green.secs}s)`,
  c.files !== undefined && `files ${c.files} (+${c.add ?? 0} −${c.del ?? 0})`,
  c.commit && `commit ${c.commit.slice(0, 7)}`,
  c.usd !== undefined && `$${c.usd.toFixed(2)}${c.cachePct !== undefined ? ` (cache ${c.cachePct}%)` : ''}`,
  `flags: ${c.flags?.length ? c.flags.map(flagName).join(',') : 'none'}`, `next: ${c.next}`,
].filter(Boolean).join(' · ').slice(0, 600)

// flag names as the model reads them (an internal word becomes a task word)
export const flagName = (f: string): string => f.replace(/^quarantine/, 'stray-edit')

// state as a subject prefix: `[review✓] title`
export const tag = (t: Pick<SnapTask, 'state' | 'step'>): string => (t.state === 'review' && t.step === 'merge' ? 'review✓' : t.state)
export const subject = (t: SnapTask): string => `[${tag(t)}] ${t.title}`

// TaskGet text: description + scenarios + contract + changelog + records (meta cadre.rec.<kind> = the stored record, rendered by `comment`'s facts)
export function taskText(t: Task, st?: SnapTask): string {
  const out = [t.description.trim()]
  if (t.acceptance?.trim()) out.push('Scenarios:', ...t.acceptance.trim().split('\n').map(l => `- ${l}`))
  if (t.design) {
    const d = JSON.parse(t.design)
    out.push(d.none ? `Contract: none (${d.reason})` : 'Contract:', ...(d.symbols ?? []).map((s: any) => `- [${s.status}] ${s.name} (${s.kind}) (${(s.params ?? []).join(', ')}) -> ${s.returns}${s.errors?.length ? ` throws ${s.errors.join(', ')}` : ''}${s.doc ? `: ${s.doc}` : ''}`))
  }
  const cl = t.meta['cadre.changelog'] && JSON.parse(t.meta['cadre.changelog'])
  if (cl) out.push(cl.none ? `Changelog: none (${cl.reason})` : `Changelog: ${cl.category}: ${cl.entry}`)
  const bits = [`type ${t.type}`, t.meta['cadre.package'] && `package ${t.meta['cadre.package']}`, t.meta['cadre.scope'] && `scope ${t.meta['cadre.scope']}`, t.meta['cadre.breaking'] === 'true' && 'breaking', st?.step && `step ${st.step}`, st?.owner && `owner ${st.owner}`, st?.flags.length && `flags ${st.flags.map(flagName).join(',')}`].filter(Boolean)
  out.push(bits.join(' · '))
  for (const [k, v] of Object.entries(t.meta).sort(([a], [b]) => (a < b ? -1 : 1))) if (k.startsWith('cadre.rec.')) out.push(`[${k.slice(10)}] ${v.replace(/^\[cadre:[^\]]*\] \S+ @\d+ by \S+\n?/, '')}`)
  return out.filter(Boolean).join('\n')
}

// main's context line (DESIGN 4.5), ≤1 KB: `plan p3 approved · epic/p3-auth · ready: a1 a4 · running: a2(w) a3(r) · a5 review✓ · a6 blocked · sync: pm offline (4)` + `next:`
const LETTER: Record<string, string> = { tester: 't', worker: 'w', reviewer: 'r', explorer: 'e' }
const closed = (t?: SnapTask) => t?.state === 'done' || t?.state === 'cancelled'
// ready, derived from the snapshot alone (the store's ready() is the truth; this is only for the hint): todo + every blocking dep satisfied
const isReady = (t: SnapTask, all: SnapTask[]) => t.state === 'todo' && t.deps.every(d => (d.type === 'conditional-blocks' ? all.find(x => x.id === d.id)?.state === 'cancelled' : closed(all.find(x => x.id === d.id))))
// idle: active tasks at an agent step with no agent bound for it (session.idleOf), e.g. right after the tester reported. Not running; next names the step.
export function contextLine(s: Omit<Snapshot, 'seq' | 'cost'>, idle: string[] = []): string {
  if (!s.plan) return ''
  const ts = s.tasks as SnapTask[]
  const ready = ts.filter(t => isReady(t, ts)), running = ts.filter(t => t.owner && !idle.includes(t.id) && (t.state === 'active' || (t.state === 'review' && t.step === 'reviewer')))
  const parts = [`${s.plan.lane === 'milestone' ? 'milestone' : 'plan'} ${s.plan.id} ${s.plan.state}`, s.plan.epicBranch, s.plan.epics?.length && `epics: ${s.plan.epics.map(e => `${e.id} ${e.state}`).join(' ')}`, ready.length && `ready: ${ready.map(t => t.id).join(' ')}`, running.length && `running: ${running.map(t => `${t.id}(${LETTER[t.step] ?? '?'})`).join(' ')}`,
    ...ts.filter(t => !running.includes(t) && ['review', 'blocked'].includes(t.state)).map(t => `${t.id} ${tag(t)}`),
    ...s.sync.filter(x => x.state !== 'ok').map(x => `sync: ${x.target} ${x.state} (${x.pending})`)]
  if (s.approval.missing.length) parts.push(`missing: ${s.approval.missing.join('; ')}`)
  const self = !!s.drive && modOn(s as Pick<Snapshot, 'drive'>)   // the steps run by themselves (ADR 0018)
  return `${parts.filter(Boolean).join(' · ').slice(0, 1000)}\nnext: ${nextAction(s, idle, self)}`
}
// what an agent should start for now, as data (ADR 0018: the spawner runs these itself; nextAction words them for main): reviewers nobody runs, then every
// ready task of a live epic (role 'claim': admission picks its first step). With the binding table, also active steps no live agent runs (tester -> worker, a decision).
export function spawnable(s: Omit<Snapshot, 'seq' | 'cost'>, bind?: Record<string, { taskId: string; role: string; retired?: boolean }>): { id: string; role: string }[] {
  const ts = s.tasks as SnapTask[], es = s.plan?.epics ?? [], live = (t: SnapTask) => !t.epic || es.find(e => e.id === t.epic)?.state === 'running'   // milestone (ADR 0015): a stopped epic's tasks wait
  const runs = (t: SnapTask) => Object.entries(bind ?? {}).some(([a, b]) => b.taskId === t.id && b.role === t.step && (a.startsWith('~') || !b.retired))   // per step: another step's start does not hold this one
  return [...ts.filter(t => t.state === 'review' && t.step === 'reviewer' && !t.owner && !runs(t)).map(t => ({ id: t.id, role: 'reviewer' })),
    ...(bind ? ts.filter(t => t.state === 'active' && (t.step === 'tester' || t.step === 'worker') && !runs(t)).map(t => ({ id: t.id, role: t.step })) : []),
    ...ts.filter(t => isReady(t, ts) && live(t)).map(t => ({ id: t.id, role: 'claim' })),
    ...(s.drive?.planner === 'agent' ? es.filter(e => (e.state === 'ready' || e.state === 'planning') && !Object.values(bind ?? {}).some(b => b.taskId === e.id)).map(e => ({ id: e.id, role: 'planner' })) : [])]   // milestone.epicPlanner agent (ADR 0021): a ready epic's planner
}
// mod mode (ADR 0018): what main hears when the plan's steps are all cadre's (spawn, complete a task or an epic)
// the instruction to spawn a step goes only to a main that spawns: where cadre starts the agents (drive.spawn mod) it is dropped, or main tries and is refused
// mod mode (ADR 0018) is on for this run: cadre spawns, closes and completes; main plans and talks to the user. A stopped or off drive spawns nothing: main may.
export const modOn = (s: Pick<Snapshot, 'drive'>) => !!(s.drive.on && !s.drive.stopped && s.drive.spawn === 'mod')
export const spawnIt = (s: Pick<Snapshot, 'drive'>, what: string) => (modOn(s) ? '' : `; ${what}`)
export const RUNS = 'wait: the tasks run by themselves and you hear when each lands, so talk with the user or plan what is next'
export function nextAction(s: Omit<Snapshot, 'seq' | 'cost'>, idle: string[] = [], mod = false): string {
  const ts = s.tasks as SnapTask[], a: string[] = []
  if (s.plan?.state === 'draft') return s.approval.missing.length ? 'complete the draft plan (see missing)' : `ask the human to approve ${s.plan.id}`
  if (!mod) a.push(...ts.filter(t => t.state === 'review' && t.step === 'merge').map(t => `complete TASK-${t.id}`))
  const y = s.drive?.on && !s.drive.stopped && s.drive.mode === 'yolo'   // yolo: main answers blocked tasks itself (core/drive)
  a.push(...ts.filter(t => t.state === 'blocked').map(t => (y && t.flags.some(yoloMain) ? `decide ${t.id} yourself (status {id:"${t.id}", choice or args})` : t.flags.includes('spec_change') ? `wait: the user decides the spec change of ${t.id} in its own dialog` : `${t.id} waits for the user (go on with the rest)`)))   // live: main asked the spec change a second time
  const sp = mod ? [] : spawnable(s), es = s.plan?.epics ?? []   // mod mode (ADR 0018): the spawner starts all of these, idle steps included
  a.push(...sp.filter(x => x.role === 'reviewer').map(x => `spawn TASK-${x.id} (reviewer)`))
  if (!mod) a.push(...ts.filter(t => t.state === 'active' && idle.includes(t.id)).map(t => startNew(t.id, t.step)))
  const r = sp.find(x => x.role === 'claim'); if (r) a.push(`spawn TASK-${r.id}`)   // one per turn; the ready list on the line says the rest
  for (const e of es) {
    if (s.drive?.planner === 'agent' && (e.state === 'ready' || e.state === 'planning')) continue   // a planner agent drafts its tasks (ADR 0021): never main's step
    if (e.state === 'ready') a.push(`plan epic ${e.id}: task calls with epic "${e.id}", then epic {id:"${e.id}", planned:true}`)
    if (e.state === 'planning') a.push(`finish planning epic ${e.id} (see missing), then epic {id:"${e.id}", planned:true}`)
    if (!mod && e.state === 'running' && ts.every(t => t.epic !== e.id || closed(t))) a.push(`complete epic ${e.id}: status {id:"${e.id}", set:"completed"}`)
  }
  if (a.length) return a.join('; ')
  if (mod) return RUNS
  if (es.length) return es.every(e => e.state === 'landed') ? `complete the milestone: status {id:"${s.plan?.id}", set:"completed"}` : 'wait'
  return ts.length && ts.every(closed) ? `complete the epic: status {id:"${s.plan?.id}", set:"completed"}` : 'wait'
}
