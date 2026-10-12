// Domain events (DESIGN 2.5): envelope, per-type actor/severity/needsHuman table, in-module bus, 500/epic ring, rebuild hook.
// The attention LEVEL (silent/band/toast/notify) is UI policy computed from severity + needsHuman; never stored here.
import { ask, flagDecision, holds, settle, yoloOn } from './decide'
import type { Actor, CadreEvent, EventRing, EventType, Host, Severity } from '../types'
import type { TaskStore } from '../task-management/store'

export const CAP = 500
type Row = [actor: Actor, severity: Severity, needsHuman: boolean, dataKeys: string[], optionalKeys?: string[]]
// Defaults per type; an emit site may override actor/severity/needsHuman (e.g. sync offline -> warn, flag.raised needing /cadre resolve).
export const TABLE: Record<EventType, Row> = {
  'task.transitioned': ['mod', 'info', false, ['taskId', 'from', 'to'], ['cites']],   // cites: a spike's citation count on done
  'task.phase_changed': ['mod', 'info', false, ['taskId', 'from', 'to']],
  'task.skipped': ['mod', 'info', false, ['taskId', 'on']],
  'agent.bound': ['mod', 'info', false, ['agentId', 'taskId', 'role'], ['tier']],   // tier: a reviewer's depth (ADR 0016)
  'agent.unbound': ['mod', 'info', false, ['agentId', 'reason']],                 // reason: answer|stopped|stale|rebind
  'check.ran': ['mod', 'info', false, ['taskId', 'name', 'ok'], ['phase', 'failing', 'secs', 'exit']],
  'flag.raised': ['mod', 'warn', true, ['taskId', 'flag']],
  'flag.resolved': ['human', 'info', false, ['taskId', 'flag']],
  'approval.pending': ['mod', 'info', true, ['planId', 'missing']],
  'sync.state_changed': ['sync', 'info', false, ['target', 'state', 'at'], ['pending', 'conflicts']],
  'drive.status': ['mod', 'info', false, ['state'], ['reason']],
  'drive.decided': ['main', 'info', false, ['kind', 'text'], ['taskId']],   // a decision taken without the human (core/drive.decided): Activity, Doctor
  'cost.updated': ['mod', 'info', false, ['tokens']],
  'init.stage': ['mod', 'info', false, ['stage', 'state'], ['name']],
  'plan.landed': ['mod', 'info', false, ['planId', 'sha']],
  'plan.released': ['mod', 'info', false, ['version', 'sha']],
  'release.proposed': ['mod', 'info', true, ['version']],
}
const SECRET_KEYS = ['code8', 'code', 'nonce', 'token', 'initConfirm']   // D7: no event ever carries a code

export type Sub = (h: Host, ev: CadreEvent) => unknown
const subs: Sub[] = []
export const subscribe = (fn: Sub): void => { subs.push(fn) }   // board, toasts, delta queue, resume queue, sync wake

type Opt = Partial<Pick<CadreEvent, 'taskId' | 'agentId' | 'actor' | 'severity' | 'needsHuman'>>
const mk = (seq: number, at: number, type: EventType, data: Record<string, unknown>, o: Opt): CadreEvent => {
  const [actor, severity, needsHuman] = TABLE[type]
  return { schemaVersion: 1, seq, at, type, taskId: o.taskId, agentId: o.agentId, actor: o.actor ?? actor, severity: o.severity ?? severity, needsHuman: o.needsHuman ?? needsHuman, data }
}
const put = (r: EventRing, epic: string, ev: CadreEvent): EventRing =>
  ({ seq: ev.seq, epics: { ...r.epics, [epic]: [...(r.epics[epic] ?? []), ev].slice(-CAP) } })

export async function emit(h: Host, type: EventType, data: Record<string, unknown>, o: Opt = {}): Promise<CadreEvent> {
  const keys = TABLE[type]?.[3]; if (!keys) throw new Error(`unknown event type ${type}`)
  const miss = keys.filter(k => !(k in data)); if (miss.length) throw new Error(`${type}: missing ${miss.join(', ')}`)
  const leak = Object.keys(data).find(k => SECRET_KEYS.includes(k)); if (leak) throw new Error(`${type}: "${leak}" must not ride an event`)
  const b0 = await h.board.read(), epic = b0.epic ?? '', at = await h.now()
  let ev!: CadreEvent
  await h.events.update(r => { ev = mk(r.seq + 1, at, type, data, o); return put(r, epic, ev) })
  try {   // a flag is a decision for the human until it is resolved (ADR 0008)
    const tid = String(data.taskId ?? ''), fl = String(data.flag ?? '')
    if (type === 'flag.raised' && !(yoloOn(b0.drive) && !holds(fl)) && !(b0.decisions ?? []).some(d => d.id === `flag:${tid}:${fl}`)) { const d = flagDecision(tid, fl, b0.tasks.find(t => t.id === tid)?.title); if (d) await ask(h, d) }
    if (type === 'flag.resolved') await settle(h, ...fl.split(',').map(f => `flag:${tid}:${f}`))
  } catch (e) { h.log(`decision update failed: ${e}`) }
  for (const s of subs) try { await s(h, ev) } catch (e) { h.log(`subscriber failed on ${type}: ${e}`) }
  return ev
}

export const emptyRing = (): EventRing => ({ seq: 0, epics: {} })
export const ofEpic = (r: EventRing, epic: string): CadreEvent[] => r.epics[epic] ?? []

// Rehydrate after /clear (DESIGN 2.5): rebuild one epic's ring from beads records (+ journal). Sorted by `at`, fresh seqs, last 500.
// Returns the first new seq; adapters then get `reset:true` + a snapshot (level-triggered).
export async function rebuild(h: Host, epic: string, evs: { at: number; type: EventType; data: Record<string, unknown>; taskId?: string; agentId?: string }[]): Promise<number> {
  let first = 0
  await h.events.update(r => {
    first = r.seq + 1
    const out = [...evs].sort((a, b) => a.at - b.at).map((e, i) => mk(r.seq + 1 + i, e.at, e.type, e.data, e))
    return { seq: r.seq + out.length, epics: { ...r.epics, [epic]: out.slice(-CAP) } }
  })
  return first
}

// ring rebuild (2.5): the journal gives at-stamped transitions; at-stamped records (cadre.rec.<kind>) give phases (and transitions without a journal). Fresh seqs.
const fromRec = (kind: string, id: string, at: number, text: string, tr: boolean) => {
  const ev = (type: 'task.phase_changed' | 'task.transitioned', from: string, to: string) => ({ at, type, taskId: id, data: { taskId: id, from, to } })
  const T = (from: string, to: string) => (tr ? [ev('task.transitioned', from, to)] : [])
  if (kind === 'red') return [ev('task.phase_changed', 'red', 'worker')]
  if (kind === 'report') return [ev('task.phase_changed', 'worker', 'reviewer'), ...T('active', 'review')]
  if (kind === 'review') return /verdict: pass/.test(text) ? [ev('task.phase_changed', 'reviewer', 'merge')] : [ev('task.phase_changed', 'reviewer', 'worker'), ...T('review', 'active')]
  return kind === 'close' ? T('review', 'done') : kind === 'blocked' ? T('active', 'blocked') : kind === 'answer' ? T('active', 'done') : []
}
export async function ring(h: Host, store: TaskStore, epic: string): Promise<number> {
  const tasks = await store.list({ parent: epic }), ids = new Set(tasks.map(t => t.id)), j = await store.events('0', 5000).catch(() => null), evs: Parameters<typeof rebuild>[2] = [], last: Record<string, string> = {}
  for (const r of j?.events ?? []) {
    if (!ids.has(r.id) || !r.category || r.at === undefined) continue
    if (last[r.id] && last[r.id] !== r.category) evs.push({ at: r.at, type: 'task.transitioned', taskId: r.id, data: { taskId: r.id, from: last[r.id], to: r.category } })
    last[r.id] = r.category
  }
  for (const t of tasks) for (const [k, v] of Object.entries(t.meta)) { const at = Number(/ @(\d+) /.exec(v)?.[1]); if (k.startsWith('cadre.rec.') && at) evs.push(...fromRec(k.slice(10), t.id, at, v, !j)) }
  if (!evs.length) return 0
  await rebuild(h, epic, evs); return evs.length
}
