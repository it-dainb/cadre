// State machine (DESIGN 3.2/3.4): legal-from table + pipeline steps as phases. `transition` is pure; `apply` commits + emits.
import type { Actor, Category, Host, PlanState, Snapshot, SnapTask } from '../types'
import { commit, stamp, withConditions } from './board'
import { emit } from './events'
import { storeOf } from './dispatch'
import { strictOf } from '../config/index'

// A pipeline step lives in one beads task; its step decides the category. reviewer/merge = `review` (merge = review pass, awaiting close).
export const STEP_CAT: Record<string, Category> = { tester: 'active', red: 'active', worker: 'active', green: 'active', explorer: 'active', report: 'active', reviewer: 'review', merge: 'review' }
// flags that stop a claim, an integration and a release until the human resolves them
export { BLOCKING } from './decide'
export type Pipe = (type: string, lane?: string) => readonly string[]

export type MKind = 'approve' | 'amend' | 'claim' | 'advance' | 'verdict' | 'close' | 'block' | 'unblock' | 'rewind' | 'release' | 'cancel' | 'skip'
export interface MEvent { kind: MKind; id: string; at: number; actor?: Actor; owner?: string; verdict?: 'pass' | 'changes'; on?: string; cites?: number }   // rewind: `on` = the step to return to (spec_change accept)
export type EmitSpec = { type: 'task.transitioned' | 'task.phase_changed' | 'task.skipped'; data: Record<string, unknown> }
export type Result = { ok: true; board: Snapshot; events: EmitSpec[] } | { ok: false; error: string }

const FROM: Record<MKind, Category[]> = {   // legal-from table
  approve: ['draft'], amend: ['todo', 'blocked'], claim: ['todo'], advance: ['active'], verdict: ['review'], close: ['review', 'active'],
  block: ['active', 'review'], unblock: ['blocked'], rewind: ['active', 'blocked', 'review'], release: ['active', 'review', 'blocked'], skip: ['todo'],
  cancel: ['draft', 'todo', 'active', 'review', 'blocked'],
}

const producer = (p: readonly string[], i: number) => [...p.slice(0, i)].reverse().find(x => x === 'worker' || x === 'tester') ?? p[0]   // the step that produced what review judges

export function transition(s: Snapshot, m: MEvent, pipe: Pipe): Result {
  const t = s.tasks.find(x => x.id === m.id)
  if (!t) return { ok: false, error: `unknown task ${m.id}` }
  const bad = (why: string): Result => ({ ok: false, error: `${m.id}: ${m.kind} is illegal from ${t.state}${t.step ? `·${t.step}` : ''}${why ? ` (${why})` : ''}` })
  if (!FROM[m.kind].includes(t.state)) return bad('')
  const p = pipe(t.type, t.lane), i = p.indexOf(t.step)
  let state: Category = t.state, step = t.step, owner = t.owner
  switch (m.kind) {
    case 'approve': state = 'todo'; break
    case 'amend': state = 'draft'; break
    case 'claim': if (!p.length) return bad('type has no pipeline'); state = 'active'; step = t.step || p[0]; owner = m.owner; break
    case 'advance': { const n = p[i + 1]; if (i < 0 || !n) return bad('no next step'); state = STEP_CAT[n] ?? 'active'; step = n; break }
    case 'verdict':
      if (t.step !== 'reviewer') return bad('not under review')
      if (m.verdict === 'pass') { if (p[i + 1] !== 'merge') return bad('no merge step'); step = 'merge' }
      else { state = 'active'; step = producer(p, i) }   // rework: the producing step
      break
    case 'close': if (!((t.state === 'review' && t.step === 'merge') || (t.state === 'active' && t.step === 'report'))) return bad('not review-passed'); state = 'done'; break
    case 'block': state = 'blocked'; break
    case 'unblock': state = STEP_CAT[t.step] ?? 'active'; break
    case 'rewind': if (!m.on || !p.includes(m.on)) return bad('no such step'); step = m.on; state = STEP_CAT[step] ?? 'active'; break
    case 'release': state = 'todo'; owner = undefined; if (STEP_CAT[t.step] === 'review') step = producer(p, i); break   // a review step is not claimable: back to the producing step
    case 'cancel': case 'skip': state = 'cancelled'; break
  }
  const next: SnapTask = { ...t, state, step, owner, phaseSince: step !== t.step ? m.at : t.phaseSince }
  const events: EmitSpec[] = [{ type: 'task.transitioned', data: { taskId: t.id, from: t.state, to: state, ...(m.kind === 'close' && m.cites !== undefined ? { cites: m.cites } : {}) } }]
  if (step !== t.step) events.push({ type: 'task.phase_changed', data: { taskId: t.id, from: t.step, to: step } })
  if (m.kind === 'skip') events.push({ type: 'task.skipped', data: { taskId: t.id, on: m.on ?? '' } })
  return { ok: true, board: withConditions({ ...s, tasks: s.tasks.map(x => (x.id === t.id ? next : x)) }), events }
}

// todo tasks whose conditional-blocks upstream closed `done`: the condition is not met, so they never run (caller applies `skip`)
export const pendingSkips = (s: Snapshot): { id: string; on: string }[] =>
  s.tasks.flatMap(t => (t.state === 'todo' && t.condition?.state === 'not-met' ? [{ id: t.id, on: t.condition.on }] : []))

// Commit one transition (CAS; recomputed on conflict) then emit its events and sync board.seq. The only write path for task state.
export async function apply(h: Host, m: MEvent, pipe: Pipe): Promise<Result> {
  let res!: Result
  const t0 = (await h.board.read()).tasks.find(x => x.id === m.id), fl = t0?.flags.find(f => f === 'external' || f === 'drift')   // sync flags (11.4): strict refuses the next transition until /cadre resolve
  if (fl && !['release', 'cancel', 'block'].includes(m.kind) && (await strictOf(h)) !== 'advisory') return { ok: false, error: `${m.id} has flag ${fl}; ask the human to resolve it (they answer it in the cadre dialog)` }
  await commit(h, s => { res = transition(s, m, pipe); return res.ok ? res.board : s })
  if (!res.ok) return res
  let seq = 0
  for (const e of res.events) seq = (await emit(h, e.type, e.data, { taskId: m.id, actor: m.actor })).seq
  await stamp(h, seq)
  if (m.kind === 'close') for (let s = pendingSkips(res.board); s.length; s = pendingSkips((await h.board.read()))) {   // a conditional-blocks upstream closed done: dependants never run (3.4 skip)
    for (const k of s) { const r = await apply(h, { kind: 'skip', id: k.id, on: k.on, at: m.at, actor: 'mod' }, pipe); if (!r.ok) return r; await (await Promise.resolve().then(() => storeOf(h)).catch(() => null))?.close(k.id, { outcome: 'cancelled', note: 'skipped: condition not met' }).catch(() => {}) }
  }
  return res
}

// Epic states (DESIGN 3.2): approved -> integrating -> done-on-dev -> released; integration failure returns to approved.
const EPIC: Record<string, Partial<Record<PlanState, PlanState>>> = {
  approve: { draft: 'approved' }, integrate: { approved: 'integrating' }, land: { integrating: 'done-on-dev' },
  fail: { integrating: 'approved' }, release: { 'done-on-dev': 'released' }, lost: { approved: 'blocked', integrating: 'blocked' }, recut: { blocked: 'approved' },
}
export const epicNext = (from: PlanState, ev: keyof typeof EPIC | string): PlanState | undefined => EPIC[ev]?.[from]
