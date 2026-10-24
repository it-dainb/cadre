// A need: a run asks for help (report outcome "request"), waits on it, and the helper's answer wakes that run. One record per task, `need:<task>` in the control doc, holds
// the request, the answer and whether it was delivered; it goes with the task (lifecycle.prune). The helper is a run on the requester's task and tree (binding parent, needId),
// started by the spawner from a frame (core/spawner.helpers), read-only. Every helper ends and answers exactly once: its report, or (a stop without one, the turn cap, a loop,
// limits.helpers.minutes) a failure: the first respawns it, the second answers "failed" and gives the human one dialog. The wake key is (agent, run epoch, needId).
import type { Binding, Host } from '../types'
import { ctlGet, ctlKeys, ctlSet } from './board'
import { StoreError } from '../task-management/store'
import { storeOf } from './dispatch'
import { emit } from './events'
import { ask } from './decide'
import { cfgOf } from './dispatch'
import { limited } from './drive'
import { runOf, step } from './lifecycle'
import { ROLES_DEFAULT } from './roles'

export interface Need { task: string; needId: string; n: number; requester: string; epoch: number; helper: string; ask: string; why: string; paths?: string[]; fails: number; answer?: string; ok?: boolean; delivered?: boolean }
export const needOf = (h: Host, task: string) => ctlGet<Need>(h, `need:${task}`)
const put = (h: Host, n: Need) => ctlSet(h, { [`need:${n.task}`]: n })
const HELPERS = ['explore']
export const question = (n: Need) => `${n.ask}\n\nWhy it is asked: ${n.why}${n.paths?.length ? `\nLook at: ${n.paths.join(', ')}` : ''}`
const FAILED = 'The helper could not answer your request. Go on without it, or report outcome "blocked" with what you need.'
export const reply = (n: Need) => (n.ok ? `Answer to your request:\n${n.answer}\nGo on with your task.` : FAILED)

// report{outcome:"request"} of a worker, tester or planner: refused outside its canRequest, over the cap, or where nobody can start the helper
export async function request(h: Host, agentId: string, b: Binding, r: { request?: { helper: string; ask: string; why: string; paths?: string[] } }): Promise<string> {
  const q = r.request!, can = ROLES_DEFAULT[b.role].canRequest ?? [], old = await needOf(h, b.taskId), max = (await cfgOf(h)).limits.helpers.perTask
  if (!can.includes(q.helper)) throw new Error(`request.helper: you may ask for ${can.join(' or ') || 'nothing'}`)
  if (!HELPERS.includes(q.helper)) throw new Error(`request.helper: ${q.helper} is not available here; ask for ${HELPERS.join(' or ')}, or report outcome "blocked"`)
  if ((await h.board.read()).drive.spawn !== 'mod') throw new Error('request: nobody can start a helper now; report outcome "blocked" with the question')
  if ((old?.n ?? 0) >= max) throw new Error(`request: this task has used its ${max} requests; go on without help, or report outcome "blocked"`)
  const n = (old?.n ?? 0) + 1, needId = `n${n}`
  await put(h, { task: b.taskId, needId, n, requester: agentId, epoch: (await runOf(h, agentId))!.epoch, helper: q.helper, ask: q.ask, why: q.why, ...(q.paths?.length ? { paths: q.paths } : {}), fails: 0 })
  await step(h, agentId, { type: 'request', needId })
  await emit(h, 'help.asked', { taskId: b.taskId, helper: q.helper }, { agentId, taskId: b.taskId })
  return 'request recorded; a helper looks into it and you are resumed with its answer. Stop and wait.'
}

// the one settle of a request: a compare-and-set on its key (as drive.casDrive), so the first writer wins, a report or a failure; the loser changes nothing and does nothing
async function cas(h: Host, task: string, f: (n: Need) => Need | undefined): Promise<Need | undefined> {
  const store = await storeOf(h), k = `need:${task}`
  for (let i = 0; i < 5; i++) {
    const n = (await store.control()).doc[k] as Need | undefined, x = n && f(n); if (!x) return undefined
    try { await store.setControl({ [k]: x }, { [k]: n }); return x } catch (e) { if (!(e instanceof StoreError && e.code === 'GuardMismatch')) throw e }
  }
}
// the answer is stored (text null: failed), then the requester's wake (dropped by its run epoch and needId when that run is no longer the one that asked)
async function answer(h: Host, n: Need, text: string | null, fail = false): Promise<boolean> {
  const x = await cas(h, n.task, c => (c.needId === n.needId && c.answer === undefined && (!fail || c.fails >= 1) ? { ...c, answer: text ?? FAILED, ok: text !== null } : undefined)); if (!x) return false
  await emit(h, 'help.done', { taskId: x.task, helper: x.helper, ok: x.ok }, { taskId: x.task })
  await step(h, x.requester, { type: 'answered', needId: x.needId, epoch: x.epoch, text: reply(x) }); return true
}
// a helper's report (core/close.report): its answer is the requester's wake
export async function helperDone(h: Host, b: Binding, r: { role: string; answer?: string; citations?: { path?: string; line?: number }[] }): Promise<string> {
  if (r.role !== 'explorer') throw new Error('role: you are a helper; report role "explorer" with answer and citations')
  const n = await needOf(h, b.taskId); if (!n || n.needId !== b.needId) return 'this request is closed. Stop.'
  await answer(h, n, [String(r.answer), ...(r.citations ?? []).slice(0, 10).map(c => `${c.path}:${c.line ?? ''}`)].join('\n').slice(0, 2500))
  return 'answer recorded. Stop.'
}
// a failed helper is stopped like the backstop's (it never runs beside its respawn), ended lost; the first failure leaves the request for the spawner, the second answers failed
async function failed(h: Host, a: string, n: Need, why: string): Promise<void> {
  if ((await needOf(h, n.task))?.answer !== undefined) return   // it answered first
  await h.stopAgent?.(a).catch(() => {}); await step(h, a, { type: 'end', cause: 'lost', reason: why })
  if (!(await answer(h, n, null, true))) return void (await cas(h, n.task, c => (c.needId === n.needId && c.answer === undefined && c.fails < 1 ? { ...c, fails: 1 } : undefined)))   // the first failure: once
  await ask(h, { id: `help:${n.task}:${n.needId}`, kind: 'flag', title: `${n.task}: a helper could not answer`, hash: n.needId, tab: 'epic', sel: n.task, lines: [`The helper asked to look into "${n.ask.slice(0, 120)}" failed twice (${why}). Its task goes on without the answer.`], options: [{ key: 'k', label: 'OK', verb: 'keep' }] })
}
// the helper's turn ended (core/close.stopped): after its report it just ends; without one it failed, a usage limit aside (the drive waits, the spawner starts it again)
export async function helperStopped(h: Host, b: Binding, e: { agentId: string; reason?: string }): Promise<void> {
  const n = await needOf(h, b.taskId); if (!n || n.needId !== b.needId || n.answer !== undefined) return void (await step(h, e.agentId, { type: 'end', cause: 'done', reason: 'answer' }))
  if (await limited(h, e)) { return void (await step(h, e.agentId, { type: 'end', cause: 'released', reason: 'usage limit' })) }
  await failed(h, e.agentId, n, (await runOf(h, e.agentId))?.exit ? 'it repeated one call' : 'it stopped without an answer')
}
// the 5 s tick: a helper still running past limits.helpers.minutes failed (only by the session that holds it)
export async function overdue(h: Host, me: string): Promise<void> {
  const now = await h.now(), max = (await cfgOf(h)).limits.helpers.minutes * 60_000
  for (const [a, b] of Object.entries(await h.bind.read())) {
    if (!b.parent || b.sessionId !== me || now - b.startedAt < max) continue
    const n = await needOf(h, b.taskId); if (n && n.needId === b.needId && n.answer === undefined) await failed(h, a, n, `it ran past ${max / 60_000} minutes`)
  }
}
export const running = (bind: Record<string, Binding>, n: Need) => Object.values(bind).some(b => b.taskId === n.task && b.needId === n.needId)   // a helper of this request is bound (its record is never rewritten by the helper's start: a late write lost its answer)
// the spawner's view: the tasks with a request no helper runs (a respawn after a failure or a process death), and those whose requester waits for one
export async function pending(h: Host): Promise<{ start: string[]; hold: string[] }> {
  const bind = await h.bind.read(), start: string[] = [], hold: string[] = []
  for (const t of await ctlKeys(h, 'need:')) { const n = await needOf(h, t); if (n && n.answer === undefined) { hold.push(t); if (!running(bind, n)) start.push(t) } }
  return { start, hold }
}
// admission's rebind: an answer the requester never got goes into the fresh agent's brief, once
export async function undelivered(h: Host, task: string): Promise<string | undefined> { const n = await needOf(h, task); return n && n.answer !== undefined && !n.delivered ? reply(n) : undefined }
export async function delivered(h: Host, task: string, agentId?: string): Promise<void> { const n = await needOf(h, task); if (n && n.answer !== undefined && (!agentId || n.requester === agentId)) await put(h, { ...n, delivered: true }) }
// the task goes (closed, cancelled, released) or is retried: its helpers are stopped with no answer and no respawn, the wait ends, the record goes
export async function drop(h: Host, task: string): Promise<void> {
  const n = await needOf(h, task); if (!n) return
  for (const [a, b] of Object.entries(await h.bind.read())) if (b.taskId === task && b.parent) { await h.stopAgent?.(a).catch(() => {}); await step(h, a, { type: 'end', cause: 'lost', reason: 'dropped' }) }
  await step(h, n.requester, { type: 'end', cause: 'cancelled', reason: 'dropped' }); await ctlSet(h, { [`need:${task}`]: undefined })
}
