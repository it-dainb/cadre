// Model-visible text only (DESIGN 6.5): beads comment, commit message (CCm), result card (6.4), TaskGet text, main context line (4.5).
// Renderers read only records, the model view and Tasks; the band, toasts and pane are ui/'s.
import type { Snapshot, SnapTask } from '../types'
import type { Task } from '../task-management/store'

export interface Rec { schemaVersion: 1; kind: string; taskId: string; at: number; actor: string; computed: Record<string, unknown>; claimed: Record<string, unknown> }
const val = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
const kv = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}: ${val(v)}`)

// canonical record -> beads comment: `[cadre:<kind> v1]` header, then computed facts, then what the agent claimed
export const comment = (r: Rec): string =>
  [`[cadre:${r.kind} v${r.schemaVersion}] ${r.taskId} @${r.at} by ${r.actor}`, ...kv(r.computed), ...(Object.keys(r.claimed).length ? ['claimed:', ...kv(r.claimed).map(l => `  ${l}`)] : [])].join('\n')

// Conventional Commits 1.0.0: `<type>[(<scope>)][!]: <description>` + summary + footers
export interface Commit { type: string; scope?: string; breaking?: boolean; breakingNote?: string; description: string; summary?: string; id: string; reviewSha?: string; checks?: string[] }
export const commitMessage = (c: Commit): string => {
  const head = `${c.type}${c.scope ? `(${c.scope})` : ''}${c.breaking ? '!' : ''}: ${c.description}`
  const foot = [...(c.breaking ? [`BREAKING CHANGE: ${c.breakingNote ?? c.description}`] : []), `Refs: ${c.id}`, ...(c.reviewSha ? [`Cadre-Review: pass@${c.reviewSha.slice(0, 7)}`] : []), ...(c.checks?.length ? [`Cadre-Checks: ${c.checks.join(', ')}`] : [])]
  return [head, ...(c.summary ? [c.summary] : []), foot.join('\n')].join('\n\n')
}

// result card, fixed ≤600 chars: TASK bd-a1 "Add login" · worker → review · green ✓ (test 41s) · files 4 (+120 −30) · commit 1a2b3c4 · $0.41 (cache 91%) · flags: none · next: …
export interface Card { id: string; title: string; role: string; to: string; green?: { ok: boolean; check: string; secs: number }; files?: number; add?: number; del?: number; commit?: string; usd?: number; cachePct?: number; flags?: string[]; next: string }
// an agent that stopped without calling report: the mod resumes it right after its stop (core/reuse drain, live: ~2 s), so main must not spawn it again and must not end the turn (a headless run would end with it)
export const noReportCard = (t: { id: string; title: string; flags?: string[] }, role: string, step: string): string =>
  card({ id: t.id, title: t.title, role, to: step, flags: t.flags, next: `wait: the ${role} is finishing its report. Do not spawn it again; call TaskList until ${t.id} leaves ${step}` })
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
// ready, derived from the snapshot alone (bd ready is the truth; this is only for the hint): todo + every blocking dep satisfied
const isReady = (t: SnapTask, all: SnapTask[]) => t.state === 'todo' && t.deps.every(d => (d.type === 'conditional-blocks' ? all.find(x => x.id === d.id)?.state === 'cancelled' : closed(all.find(x => x.id === d.id))))
export function contextLine(s: Omit<Snapshot, 'seq' | 'cost'>): string {
  if (!s.plan) return ''
  const ts = s.tasks as SnapTask[]
  const ready = ts.filter(t => isReady(t, ts)), running = ts.filter(t => t.owner && (t.state === 'active' || (t.state === 'review' && t.step === 'reviewer')))
  const parts = [`plan ${s.plan.id} ${s.plan.state}`, s.plan.epicBranch, ready.length && `ready: ${ready.map(t => t.id).join(' ')}`, running.length && `running: ${running.map(t => `${t.id}(${LETTER[t.step] ?? '?'})`).join(' ')}`,
    ...ts.filter(t => !running.includes(t) && ['review', 'blocked'].includes(t.state)).map(t => `${t.id} ${tag(t)}`),
    ...s.sync.filter(x => x.state !== 'ok').map(x => `sync: ${x.target} ${x.state} (${x.pending})`)]
  if (s.approval.missing.length) parts.push(`missing: ${s.approval.missing.join('; ')}`)
  return `${parts.filter(Boolean).join(' · ').slice(0, 1000)}\nnext: ${nextAction(s)}`
}
export function nextAction(s: Omit<Snapshot, 'seq' | 'cost'>): string {
  const ts = s.tasks as SnapTask[], a: string[] = []
  if (s.plan?.state === 'draft') return s.approval.missing.length ? 'complete the draft plan (see missing)' : `ask the human to approve ${s.plan.id}`
  a.push(...ts.filter(t => t.state === 'review' && t.step === 'merge').map(t => `complete TASK-${t.id}`))
  const y = s.drive?.on && !s.drive.stopped && s.drive.mode === 'yolo'   // yolo: main answers blocked tasks itself (core/drive)
  a.push(...ts.filter(t => t.state === 'blocked').map(t => (y ? `decide ${t.id} yourself (TaskUpdate ${t.id} metadata.decision)` : `ask the human about ${t.id}`)))
  a.push(...ts.filter(t => t.state === 'review' && t.step === 'reviewer' && !t.owner).map(t => `spawn TASK-${t.id} (reviewer)`))
  const r = ts.find(t => isReady(t, ts)); if (r) a.push(`spawn TASK-${r.id}`)   // one per turn; the ready list on the line says the rest
  return a.length ? a.join('; ') : ts.length && ts.every(closed) ? `complete the epic: TaskUpdate ${s.plan?.id} completed` : 'wait'
}
