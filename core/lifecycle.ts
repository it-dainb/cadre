// One agent lifecycle (ADR 0024 §2): a run record per agent, written only by step() through the pure next(). classify() is the read-only view of the older records
// (the binding table, the board, the task's meta, the report retries in ui) that close.ts and render.ts still infer from until their writes move here.
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
export interface LifeView { bind: Record<string, Binding>; tasks: SnapTask[]; ui?: Record<string, unknown>; meta?: Record<string, string> }   // meta: the agent's task's

// taskId: the task an unbound agent had (its agent.unbound event), so its end has a cause; without it an unbound agent is lost
export function classify(v: LifeView, agentId: string, taskId?: string): RunState {
  if (agentId.startsWith('~')) return { state: 'reserved' }   // admission's spawn reservation
  const b = v.bind[agentId], t = v.tasks.find(x => x.id === (b?.taskId ?? taskId))
  if (!t) return { state: 'ended', cause: 'lost' }
  if (!b || t.state === 'done' || t.state === 'cancelled') return { state: 'ended', cause: t.state === 'done' || t.state === 'cancelled' || t.state === 'blocked' ? t.state : 'released' }
  if (b.retired) return { state: 'retired' }   // core/reuse: a fresh spawn takes over
  if (t.state === 'blocked') return { state: 'waiting', on: 'decision' }
  if (t.step === b.step && STEP_CAT[b.step] === t.state) {   // at its own step: the report and the stop sweep act on it (core/close)
    const [st, k] = String(v.meta?.['cadre.nudge'] ?? '').split(':'), r = ((v.ui?.retries as Record<string, number> | undefined) ?? {})[`report:${agentId}`] ?? 0
    return r ? { state: 'refused', n: r } : st === b.step && Number(k) ? { state: 'silent', n: Number(k) } : { state: 'running' }
  }
  return b.role === 'worker' && t.step === 'reviewer' ? { state: 'waiting', on: 'review' } : b.role === 'reviewer' && t.step === 'worker' ? { state: 'waiting', on: 'rework' } : { state: 'idle-bound' }
}

// ---- the run record: one per agent. Its $.state copy (ui.runs, CAS) is the only one step() writes; $.store `cadre:<repo>:run:<agentId>` mirrors it, so it
// survives /clear (Doctor reads its log there). One writer per key: the session holding the binding. ----
export type RunEvent =
  | { type: 'spawn.ok'; taskId: string; role: Role; step: string }
  | { type: 'report.ok'; wait?: boolean }   // wait: the report parked its task for a decision (blocked, spec change, a red that cannot be made)
  | { type: 'report.refused' } | { type: 'turn.end' }   // turn.end: stopped without a report, nudged
  | { type: 'end'; cause: 'done' | 'released' | 'blocked' | 'cancelled' }
export interface Run { taskId: string; role: Role; step: string; state: RunState | null; epoch: number; log: { state: string; event: string; cause?: string }[] }   // state null: a binding with no record
export type Effect = { kind: 'unbind'; cause: 'lost' }
const LOG = 20, n = (s: RunState | null, k: 'refused' | 'silent') => (s?.state === k ? s.n : 0)

export function next(run: Run, e: RunEvent): { run: Run; effects: Effect[] } {
  const go = (state: RunState, effects: Effect[] = [], r = run) => ({ run: { ...r, state, log: [...run.log, { state: state.state, event: e.type, ...('cause' in state ? { cause: state.cause } : {}) }].slice(-LOG) }, effects })
  if (e.type === 'spawn.ok') return go({ state: 'running' }, [], { ...run, taskId: e.taskId, role: e.role, step: e.step, epoch: run.epoch + 1 })
  if (run.state === null) return go({ state: 'ended', cause: 'lost' }, [{ kind: 'unbind', cause: 'lost' }])   // a binding cadre has no record of (0.13 state, a lost store key)
  if (run.state.state === 'ended') return { run, effects: [] }
  if (e.type === 'end') return go({ state: 'ended', cause: e.cause })
  if (e.type === 'report.ok') return go(e.wait ? { state: 'waiting', on: 'decision' } : { state: 'idle-bound' })
  return e.type === 'report.refused' ? go({ state: 'refused', n: n(run.state, 'refused') + 1 }) : go({ state: 'silent', n: n(run.state, 'silent') + 1 })
}

const runKey = (h: Host, a: string) => scoped(h, `run:${a}`)
export async function runOf(h: Host, agentId: string): Promise<Run | undefined> {
  return ((await h.ui.read()).runs as Record<string, Run> | undefined)?.[agentId] ?? ((await h.store.get(await runKey(h, agentId))) as Run | undefined)
}
// read (the $.state copy, else the mirror after a /clear), next(), CAS-write, mirror what $.state now holds, apply the effects. An agent with neither a binding
// nor a record (a marker-less explorer) has no run: nothing happens.
export async function step(h: Host, agentId: string, e: RunEvent): Promise<Run | undefined> {
  const b = (await h.bind.read())[agentId], had = await runOf(h, agentId)
  const from = e.type === 'spawn.ok' ? e : b, cur: Run | undefined = had ?? (from && { taskId: from.taskId, role: from.role, step: from.step, state: null, epoch: 0, log: [] })
  if (!cur) return undefined
  let fx: Effect[] = []
  await h.ui.update(u => { const rs = (u.runs as Record<string, Run> | undefined) ?? {}, r = next(rs[agentId] ?? cur, e); fx = r.effects; return { ...u, runs: { ...rs, [agentId]: r.run } } })
  const now = ((await h.ui.read()).runs as Record<string, Run>)[agentId]
  await h.store.set(await runKey(h, agentId), now)
  for (const f of fx) if (f.kind === 'unbind') { await unbindAgent(h, agentId); await emit(h, 'agent.unbound', { agentId, reason: f.cause }, { agentId, taskId: now.taskId }) }
  return now
}
// task done or cancelled: its agents' records go (the store is small, ST-15)
export async function prune(h: Host, agentIds: string[]): Promise<void> {
  await h.ui.update(u => ({ ...u, runs: Object.fromEntries(Object.entries((u.runs as Record<string, Run> | undefined) ?? {}).filter(([a]) => !agentIds.includes(a))) }))
  for (const a of agentIds) await h.store.del(await runKey(h, a))
}
