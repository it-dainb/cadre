// One agent lifecycle (ADR 0024 §2): a run record per agent, written only by step() through the pure next(), and one budget per task. classify() is the read-only
// view: the run record's state, else what the binding table and the board say (close.ts and render.ts still infer from those until their writes move here).
import type { Binding, Host, Role, SnapTask } from '../types'
import { STEP_CAT } from './machine'
import { unbindAgent } from './board'
import { emit } from './events'
import { scoped } from '../commands/init'

export type RunState =
  | { state: 'reserved' | 'running' | 'idle-bound' | 'retired' }
  | { state: 'refused' | 'silent'; n: number }   // refused: its report was refused n times; silent: it stopped without a report, nudged n times
  | { state: 'waiting'; on: 'decision' | 'need' | 'rework' | 'review' }
  | { state: 'ended'; cause: 'done' | 'released' | 'blocked' | 'cancelled' | 'lost' }
export interface LifeView { bind: Record<string, Binding>; tasks: SnapTask[]; runs?: Record<string, Run> }

// taskId: the task an unbound agent had (its agent.unbound event), so its end has a cause; without it an unbound agent is lost
export function classify(v: LifeView, agentId: string, taskId?: string): RunState {
  if (agentId.startsWith('~')) return { state: 'reserved' }   // admission's spawn reservation
  const r = v.runs?.[agentId]?.state; if (r) return r   // its run record says it
  const b = v.bind[agentId], t = v.tasks.find(x => x.id === (b?.taskId ?? taskId))
  if (!t) return { state: 'ended', cause: 'lost' }
  if (!b || t.state === 'done' || t.state === 'cancelled') return { state: 'ended', cause: t.state === 'done' || t.state === 'cancelled' || t.state === 'blocked' ? t.state : 'released' }
  if (b.retired) return { state: 'retired' }   // core/reuse: a fresh spawn takes over
  if (t.state === 'blocked') return { state: 'waiting', on: 'decision' }
  if (t.step === b.step && STEP_CAT[b.step] === t.state) return { state: 'running' }   // at its own step: the report and the stop sweep act on it (core/close)
  return b.role === 'worker' && t.step === 'reviewer' ? { state: 'waiting', on: 'review' } : b.role === 'reviewer' && t.step === 'worker' ? { state: 'waiting', on: 'rework' } : { state: 'idle-bound' }
}

// ---- the run record: one per agent. Its $.state copy (ui.runs, CAS) is the only one step() writes; $.store `cadre:<repo>:run:<agentId>` mirrors it, so it
// survives /clear (Doctor reads its log there). One writer per key: the session holding the binding. ----
export type RunEvent =
  | { type: 'spawn.ok'; taskId: string; role: Role; step: string }
  | { type: 'report.ok'; wait?: boolean }   // wait: the report parked its task for a decision (blocked, spec change, a red that cannot be made)
  | { type: 'report.refused' } | { type: 'turn.end' } | { type: 'handback' }   // turn.end: stopped without a report, nudged · handback: one refused hand-back
  | { type: 'end'; cause: 'done' | 'released' | 'blocked' | 'cancelled' }
export interface Run { taskId: string; role: Role; step: string; state: RunState | null; epoch: number; hb?: number; log: { state: string; event: string; cause?: string }[] }   // state null: a binding with no record
export type Effect = { kind: 'unbind'; cause: 'lost' }
const LOG = 20, n = (s: RunState | null, k: 'refused' | 'silent') => (s?.state === k ? s.n : 0)

export function next(run: Run, e: RunEvent): { run: Run; effects: Effect[] } {
  const go = (state: RunState, effects: Effect[] = [], r = run) => ({ run: { ...r, state, log: [...run.log, { state: state.state, event: e.type, ...('cause' in state ? { cause: state.cause } : {}) }].slice(-LOG) }, effects })
  if (e.type === 'spawn.ok') return go({ state: 'running' }, [], { ...run, taskId: e.taskId, role: e.role, step: e.step, epoch: run.epoch + 1 })
  if (run.state === null) return go({ state: 'ended', cause: 'lost' }, [{ kind: 'unbind', cause: 'lost' }])   // a binding cadre has no record of (0.13 state, a lost store key)
  if (run.state.state === 'ended') return { run, effects: [] }
  if (e.type === 'end') return go({ state: 'ended', cause: e.cause })
  if (e.type === 'handback') return go(run.state, [], { ...run, hb: (run.hb ?? 0) + 1 })
  if (run.state.state === 'waiting') return { run, effects: [] }   // invariant 2: a parked run is never nudged or refused into another state; only its end moves it
  if (e.type === 'report.ok') return go(e.wait ? { state: 'waiting', on: 'decision' } : { state: 'idle-bound' })
  return e.type === 'report.refused' ? go({ state: 'refused', n: n(run.state, 'refused') + 1 }) : go({ state: 'silent', n: n(run.state, 'silent') + 1 })
}

// one $.state map per kind (CAS) mirrored key by key to $.store: the mirror always sets what $.state holds after the update, never a local copy
type Kind = 'runs' | 'budgets'
const keyOf = (h: Host, k: Kind, id: string) => scoped(h, `${k === 'runs' ? 'run' : 'budget'}:${id}`)
const mapOf = <T>(u: Record<string, unknown>, k: Kind) => (u[k] as Record<string, T> | undefined) ?? {}
async function load<T>(h: Host, k: Kind, id: string): Promise<T | undefined> { return mapOf<T>(await h.ui.read(), k)[id] ?? ((await h.store.get(await keyOf(h, k, id))) as T | undefined) }
async function put<T>(h: Host, k: Kind, id: string, seed: T | undefined, f: (x: T | undefined) => T): Promise<T> {
  await h.ui.update(u => { const m = mapOf<T>(u, k); return { ...u, [k]: { ...m, [id]: f(m[id] ?? seed) } } })
  const now = mapOf<T>(await h.ui.read(), k)[id]; await h.store.set(await keyOf(h, k, id), now); return now
}
export const runOf = (h: Host, agentId: string) => load<Run>(h, 'runs', agentId)
// read (the $.state copy, else the mirror after a /clear), next(), CAS-write, mirror, apply the effects. An agent with neither a binding nor a record (a
// marker-less explorer) has no run: nothing happens.
export async function step(h: Host, agentId: string, e: RunEvent): Promise<Run | undefined> {
  const b = (await h.bind.read())[agentId], had = await runOf(h, agentId)
  const from = e.type === 'spawn.ok' ? e : b, cur: Run | undefined = had ?? (from && { taskId: from.taskId, role: from.role, step: from.step, state: null, epoch: 0, log: [] })
  if (!cur) return undefined
  let fx: Effect[] = []
  const now = await put<Run>(h, 'runs', agentId, cur, r => { const x = next(r!, e); fx = x.effects; return x.run })
  for (const f of fx) if (f.kind === 'unbind') { await unbindAgent(h, agentId); await emit(h, 'agent.unbound', { agentId, reason: f.cause }, { agentId, taskId: now.taskId }) }
  return now
}

// ---- one budget per task (ADR 0024 §2.5): it only grows, across agents and recoveries; only the human's Retry resets one counter. drive resume never touches it ----
export interface Budget { startFails: number; silentRuns: number; nudges: number; refusals: number; red: number; rework: number; rebase: number }
const ZERO: Budget = { startFails: 0, silentRuns: 0, nudges: 0, refusals: 0, red: 0, rework: 0, rebase: 0 }
export const budgetOf = async (h: Host, taskId: string): Promise<Budget> => ({ ...ZERO, ...(await load<Budget>(h, 'budgets', taskId)) })
export const charge = async (h: Host, taskId: string, k: keyof Budget): Promise<number> => (await put<Budget>(h, 'budgets', taskId, await budgetOf(h, taskId), b => ({ ...ZERO, ...b, [k]: (b?.[k] ?? 0) + 1 })))[k]
// human.retry{counter}: from any session; it re-reads the mirror before its set, so the newest record wins on every other counter
export async function retry(h: Host, taskId: string, k: keyof Budget, to = 0): Promise<void> {
  const fresh = { ...ZERO, ...((await h.store.get(await keyOf(h, 'budgets', taskId))) as Budget | undefined) }
  await put<Budget>(h, 'budgets', taskId, fresh, b => ({ ...fresh, ...b, [k]: to }))
}
// task done or cancelled: its agents' records and its budget go (the store is small, ST-15)
export async function prune(h: Host, taskId: string, agentIds: string[]): Promise<void> {
  const drop = (k: Kind, ids: string[]) => h.ui.update(u => ({ ...u, [k]: Object.fromEntries(Object.entries(mapOf(u, k)).filter(([a]) => !ids.includes(a))) }))
  await drop('runs', agentIds); await drop('budgets', [taskId])
  for (const a of agentIds) await h.store.del(await keyOf(h, 'runs', a))
  await h.store.del(await keyOf(h, 'budgets', taskId))
}
