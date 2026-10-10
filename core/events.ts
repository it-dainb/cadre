// Domain events (DESIGN 2.5): envelope, per-type actor/severity/needsHuman table, in-module bus, 500/epic ring, rebuild hook.
// The attention LEVEL (silent/band/toast/notify) is UI policy computed from severity + needsHuman; never stored here.
import type { Actor, CadreEvent, EventRing, EventType, Host, Severity } from '../types'

export const CAP = 500
type Row = [actor: Actor, severity: Severity, needsHuman: boolean, dataKeys: string[]]
// Defaults per type; an emit site may override actor/severity/needsHuman (e.g. sync offline -> warn, flag.raised needing /cadre resolve).
export const TABLE: Record<EventType, Row> = {
  'task.transitioned': ['mod', 'info', false, ['taskId', 'from', 'to']],
  'task.phase_changed': ['mod', 'info', false, ['taskId', 'from', 'to']],
  'task.skipped': ['mod', 'info', false, ['taskId', 'on']],
  'agent.bound': ['mod', 'info', false, ['agentId', 'taskId', 'role']],
  'agent.unbound': ['mod', 'info', false, ['agentId', 'reason']],                 // reason: answer|stopped|stale|rebind
  'check.ran': ['mod', 'info', false, ['taskId', 'name', 'ok']],
  'flag.raised': ['mod', 'warn', true, ['taskId', 'flag']],
  'flag.resolved': ['human', 'info', false, ['taskId', 'flag']],
  'approval.pending': ['mod', 'info', true, ['planId', 'missing']],
  'sync.state_changed': ['sync', 'info', false, ['target', 'state', 'at']],
  'drive.status': ['mod', 'info', false, ['state']],
  'cost.updated': ['mod', 'info', false, ['tokens']],
  'init.stage': ['mod', 'info', false, ['stage', 'state']],
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
  const epic = (await h.board.read()).epic ?? '', at = await h.now()
  let ev!: CadreEvent
  await h.events.update(r => { ev = mk(r.seq + 1, at, type, data, o); return put(r, epic, ev) })
  for (const s of subs) try { await s(h, ev) } catch (e) { h.log(`cadre: subscriber failed on ${type}: ${e}`) }
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
