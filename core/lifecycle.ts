// One agent lifecycle (ADR 0024 §2): a run record per agent and one budget per task. Every binding, wake and budget write goes through here: step() runs the pure
// next() and applies its effects, so the binding table is the index step() keeps (patchBinding in core/board writes plain fields only). classify() is the read view.
import type { Binding, Host, Role, SnapTask } from '../types'
import { emit } from './events'
import { queueResume } from './reuse'
import { scoped } from '../commands/init'

type End = 'done' | 'released' | 'blocked' | 'cancelled'
export type RunState =
  | { state: 'reserved' | 'running' | 'idle-bound' | 'retired' }
  | { state: 'refused' | 'silent'; n: number }   // refused: its report was refused n times; silent: it stopped without a report, nudged n times
  | { state: 'waiting'; on: 'decision' | 'need' | 'rework' | 'review' }
  | { state: 'ended'; cause: End | 'lost' }
export interface LifeView { bind: Record<string, Binding>; tasks: SnapTask[]; runs?: Record<string, Run> }

// the run record's state; a binding with no record is lost (its next event ends it); an unbound agent ended as its task (taskId: its last task) did
export function classify(v: LifeView, agentId: string, taskId?: string): RunState {
  if (agentId.startsWith('~')) return { state: 'reserved' }   // a spawn in flight
  const r = v.runs?.[agentId]?.state, t = v.tasks.find(x => x.id === taskId)
  return r ?? (v.bind[agentId] || !t ? { state: 'ended', cause: 'lost' } : { state: 'ended', cause: t.state === 'done' || t.state === 'cancelled' || t.state === 'blocked' ? t.state : 'released' })
}

// ---- the run record: its $.state copy (ui.runs, CAS) is the only one step() writes; $.store `cadre:<repo>:run:<agentId>` mirrors it, so it survives /clear
// (Doctor reads its log there). One writer per key: the session holding the binding. epoch = the task's spawns when it started (a wake for an older one is dropped). ----
export type RunEvent =
  | { type: 'spawn.ok'; bind: Binding; epoch?: number }   // admission: it is bound (the task's reservation goes)
  | { type: 'report.ok'; wait?: boolean }   // wait: the report parked its task for a decision (blocked, spec change, a red that cannot be made)
  | { type: 'report.refused' } | { type: 'handback' }   // handback: one refused hand-back
  | { type: 'turn.end'; text: string }   // stopped without a report: nudged with text
  | { type: 'resume'; text: string; step?: string; taskId?: string }   // a wake (review findings, a rework, an answer); step: it goes on at that step; taskId: an ask's
  | { type: 'retire' }   // context or cache over: a fresh agent takes over
  | { type: 'end'; cause: End; reason: string }
export interface Run { taskId: string; role: Role; step: string; state: RunState | null; epoch: number; hb?: number; log: { state: string; event: string; cause?: string }[] }   // state null: a binding with no record
export type Effect = { kind: 'unbind'; reason: string } | { kind: 'wake'; text: string; step?: string } | { kind: 'retire' }
const LOG = 20, n = (s: RunState | null, k: 'refused' | 'silent') => (s?.state === k ? s.n : 0)

export function next(run: Run, e: RunEvent): { run: Run; effects: Effect[] } {
  const go = (state: RunState, effects: Effect[] = [], r = run) => ({ run: { ...r, state, log: [...run.log, { state: state.state, event: e.type, ...('cause' in state ? { cause: state.cause } : {}) }].slice(-LOG) }, effects })
  const s = run.state?.state, wake = (x: { text: string; step?: string }): Effect => ({ kind: 'wake', text: x.text, ...(x.step ? { step: x.step } : {}) })
  if (e.type === 'spawn.ok') return go({ state: 'running' }, [], { ...run, taskId: e.bind.taskId, role: e.bind.role, step: e.bind.step, epoch: e.epoch ?? run.epoch + 1 })
  if (run.state === null) return go({ state: 'ended', cause: 'lost' }, [{ kind: 'unbind', reason: 'lost' }])   // a binding cadre has no record of (an older store, a lost key)
  if (s === 'ended') return { run, effects: [] }
  if (e.type === 'end') return go({ state: 'ended', cause: e.cause }, [{ kind: 'unbind', reason: e.reason }])
  if (e.type === 'handback') return go(run.state, [], { ...run, hb: (run.hb ?? 0) + 1 })
  if (e.type === 'resume') return go(s === 'waiting' || s === 'idle-bound' || s === 'retired' ? { state: 'running' } : run.state, [wake(e)], e.step ? { ...run, step: e.step } : run)   // an answer or a rework ends the wait
  if (s === 'waiting') return { run, effects: [] }   // invariant 2: a parked run is never retired, nudged or refused into another state
  if (e.type === 'retire') return go({ state: 'retired' }, [{ kind: 'retire' }])
  if (e.type === 'report.ok') return go(e.wait ? { state: 'waiting', on: 'decision' } : { state: 'idle-bound' })
  return e.type === 'report.refused' ? go({ state: 'refused', n: n(run.state, 'refused') + 1 }) : go({ state: 'silent', n: n(run.state, 'silent') + 1 }, [wake(e)])
}

// one $.state map per kind (CAS) mirrored key by key to $.store: the mirror always sets what $.state holds after the update, never a local copy. New run keys are
// listed under `runs`, so session start can prune them ($.store cannot list keys).
type Kind = 'runs' | 'budgets'
const keyOf = (h: Host, k: Kind | 'index', id = '') => scoped(h, k === 'index' ? 'runs' : `${k === 'runs' ? 'run' : 'budget'}:${id}`)
const mapOf = <T>(u: Record<string, unknown>, k: Kind) => (u[k] as Record<string, T> | undefined) ?? {}
async function load<T>(h: Host, k: Kind, id: string): Promise<T | undefined> { return mapOf<T>(await h.ui.read(), k)[id] ?? ((await h.store.get(await keyOf(h, k, id))) as T | undefined) }
async function put<T>(h: Host, k: Kind, id: string, seed: T | undefined, f: (x: T | undefined) => T): Promise<T> {
  await h.ui.update(u => { const m = mapOf<T>(u, k); return { ...u, [k]: { ...m, [id]: f(m[id] ?? seed) } } })
  const now = mapOf<T>(await h.ui.read(), k)[id], ix = ((await h.store.get(await keyOf(h, 'index'))) as string[] | undefined) ?? []
  if (k === 'runs' && !ix.includes(id)) await h.store.set(await keyOf(h, 'index'), [...ix, id])
  await h.store.set(await keyOf(h, k, id), now); return now
}
export const runOf = (h: Host, agentId: string) => load<Run>(h, 'runs', agentId)
// read (the $.state copy, else the mirror after a /clear), next(), CAS-write, mirror, apply the effects. An agent with neither a binding nor a record (a
// marker-less explorer) has no run: only a wake goes out (its ask's).
export async function step(h: Host, agentId: string, e: RunEvent): Promise<Run | undefined> {
  const b = e.type === 'spawn.ok' ? e.bind : (await h.bind.read())[agentId], had = await runOf(h, agentId)
  const cur: Run | undefined = had ?? (b && { taskId: b.taskId, role: b.role, step: b.step, state: null, epoch: 0, log: [] })
  if (!cur) return void (e.type === 'resume' && e.taskId && (await queueResume(h, { agentId, taskId: e.taskId, text: e.text })))
  if (e.type === 'spawn.ok') { e = { ...e, epoch: await charge(h, b!.taskId, 'epoch') }; await h.bind.update(({ [`~${b!.taskId}`]: _r, ...t }) => ({ ...t, [agentId]: b! })) }
  let fx: Effect[] = []
  const now = await put<Run>(h, 'runs', agentId, cur, r => { const x = next(r!, e); fx = x.effects; return x.run })
  for (const f of fx) {
    if (f.kind === 'unbind') { await h.bind.update(({ [agentId]: _gone, ...rest }) => rest); await emit(h, 'agent.unbound', { agentId, reason: f.reason }, { agentId, taskId: now.taskId }) }
    else if (f.kind === 'retire') await h.bind.update(t => (t[agentId] ? { ...t, [agentId]: { ...t[agentId], retired: true } } : t))
    else { if (f.step) await h.bind.update(t => (t[agentId] ? { ...t, [agentId]: { ...t[agentId], step: f.step! } } : t)); await queueResume(h, { agentId, taskId: now.taskId, text: f.text, epoch: now.epoch }) }
  }
  return now
}
// a spawn's reservation (admission): CAS, false while another spawn holds it or a live agent of that role is bound
export async function reserve(h: Host, id: string, role: Role, sessionId: string): Promise<boolean> {
  let got = false
  await h.bind.update(b => { got = !b[`~${id}`] && !Object.keys(b).some(a => b[a].taskId === id && b[a].role === role); return got ? { ...b, [`~${id}`]: { taskId: id, role, step: '', worktree: '~', sessionId, ctxTokens: 0, startedAt: 0 } } : b })
  return got
}
export const unreserve = (h: Host, id: string) => h.bind.update(({ [`~${id}`]: _r, ...t }) => t)
// after a /clear (core/session): this process's binding comes back under the new session id when its run record survived; without one it is lost
export async function restore(h: Host, a: string, b: Binding): Promise<boolean> {
  if (!(await runOf(h, a))) { await emit(h, 'agent.unbound', { agentId: a, reason: 'lost' }, { agentId: a, taskId: b.taskId }); return false }
  await h.bind.update(t => ({ ...t, [a]: b })); return true
}

// ---- one budget per task (ADR 0024 §2.5): it only grows, across agents and recoveries; only the human's Retry resets one counter. drive resume never touches it.
// epoch counts the task's spawns (the wake key). ----
export interface Budget { startFails: number; silentRuns: number; nudges: number; refusals: number; red: number; rework: number; rebase: number; epoch: number }
const ZERO: Budget = { startFails: 0, silentRuns: 0, nudges: 0, refusals: 0, red: 0, rework: 0, rebase: 0, epoch: 0 }
export const budgetOf = async (h: Host, taskId: string): Promise<Budget> => ({ ...ZERO, ...(await load<Budget>(h, 'budgets', taskId)) })
export const charge = async (h: Host, taskId: string, k: keyof Budget): Promise<number> => (await put<Budget>(h, 'budgets', taskId, await budgetOf(h, taskId), b => ({ ...ZERO, ...b, [k]: (b?.[k] ?? 0) + 1 })))[k]
// human.retry{counter}: from any session; it re-reads the mirror before its set, so the newest record wins on every other counter
export async function retry(h: Host, taskId: string, k: keyof Budget, to = 0): Promise<void> {
  const fresh = { ...ZERO, ...((await h.store.get(await keyOf(h, 'budgets', taskId))) as Budget | undefined) }
  await put<Budget>(h, 'budgets', taskId, fresh, b => ({ ...fresh, ...b, [k]: to }))
}
// the store is small (ST-15): a closed task's runs and budget go at once; at session start every ended run, or one whose task is no longer in flight, goes
export async function prune(h: Host, taskId: string | undefined, agentIds: string[]): Promise<void> {
  const drop = (k: Kind, ids: string[]) => h.ui.update(u => ({ ...u, [k]: Object.fromEntries(Object.entries(mapOf(u, k)).filter(([a]) => !ids.includes(a))) }))
  await drop('runs', agentIds); for (const a of agentIds) await h.store.del(await keyOf(h, 'runs', a))
  await h.store.set(await keyOf(h, 'index'), (((await h.store.get(await keyOf(h, 'index'))) as string[] | undefined) ?? []).filter(a => !agentIds.includes(a)))
  if (taskId) { await drop('budgets', [taskId]); await h.store.del(await keyOf(h, 'budgets', taskId)) }
}
export async function pruneRuns(h: Host, live: (taskId: string) => Promise<boolean>): Promise<void> {
  const gone: string[] = []
  for (const a of ((await h.store.get(await keyOf(h, 'index'))) as string[] | undefined) ?? []) { const r = await runOf(h, a); if (!r || r.state?.state === 'ended' || !(await live(r.taskId))) gone.push(a) }
  if (gone.length) await prune(h, undefined, gone)
}
