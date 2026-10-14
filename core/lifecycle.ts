// One agent lifecycle (ADR 0024 §2). For now classify() only: the state an agent is in, read from what records it today (the binding table, the board, the task's
// meta, the report retries in ui). close.ts, render.ts and policy/guards.ts each infer a piece of this; the run record and step() replace the inference later.
import type { Binding, SnapTask } from '../types'
import { STEP_CAT } from './machine'

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
