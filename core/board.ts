// Read model (DESIGN 2.5): snapshot, model/human views, CAS helper, binding table. Snapshot types live in types/index.d.ts.
import type { Binding, Host, Snapshot, SnapTask } from '../types'
import { StoreError, type Task, type TaskStore } from '../task-management/store'
import '../commands/init'   // load order only: core/dispatch (via commands/init) must finish before the sync loop registers ROUTES.sync (a cycle the kit's loader is strict about)

// store + config arrive through two optional Host members that register.ts wires (CONTRACTS)
export const storeOf = (h: Host): Promise<TaskStore> => { const f = (h as any).taskStore; if (!f) throw new StoreError('Unavailable', 'no task store'); return f() }
// the repo's durable keys beside the drive record (run records, budgets, spawn intents, task owners, the board pointer): the store's control doc, so any session
// (after a quit, with $.store empty) reads them back. A write sets whole keys (shallow merge); undefined removes one.
export const ctlGet = async <T>(h: Host, k: string): Promise<T | undefined> => (await (await storeOf(h)).control()).doc[k] as T | undefined
export const ctlKeys = async (h: Host, prefix: string): Promise<string[]> => Object.entries((await (await storeOf(h)).control()).doc).filter(([k, v]) => k.startsWith(prefix) && v != null).map(([k]) => k.slice(prefix.length))
export const ctlSet = async (h: Host, kv: Record<string, unknown>): Promise<void> => { await (await storeOf(h)).setControl(kv) }

export const emptySnapshot = (repo = ''): Snapshot => ({
  schemaVersion: 1, seq: 0, repo, mission: null, epic: null, plan: null, tasks: [],
  approval: { planId: null, missing: [] },
  drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null },
  sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [],
})
export const isCold = (s: Snapshot): boolean => s.seq === 0   // lazy rehydrate trigger (DESIGN 13.4)

// canonical JSON: sorted keys, undefined dropped. fnv1a64 over it = the snapshot hash (diff gate).
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  for (const b of new TextEncoder().encode(s)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}

// Two views of one schema. Neither carries a code (those live in the `secret` atom).
export const humanView = (s: Snapshot): Snapshot => structuredClone(s)   // band, pane, toasts (never an adapter, ADR 0012)
// model view (main context, TaskGet, cards, adapters without grant): drops volatile fields so the hash only moves on real change
export function modelView(s: Snapshot): Omit<Snapshot, 'seq' | 'cost'> {
  const { seq: _s, cost: _c, decisions: _d, ...v } = structuredClone(s)   // decisions are for the human only
  v.tasks.forEach(t => { delete (t as Partial<SnapTask>).phaseSince; delete t.ctx })   // volatile: the hash only moves on real change
  v.sync.forEach(x => { delete (x as Partial<typeof x>).at })
  const { turns: _t, costUsd: _u, startedAt: _a, ...drive } = v.drive
  return { ...v, drive: drive as Snapshot['drive'] }
}
export const viewHash = (s: Snapshot): string => fnv1a64(canon(modelView(s)))

// condition {on,state} for a task with a conditional-blocks dep (runs only if upstream FAILS): derived, never stored
export function conditionOf(t: SnapTask, all: SnapTask[]): SnapTask['condition'] {
  const d = t.deps.find(x => x.type === 'conditional-blocks'); if (!d) return undefined
  const up = all.find(x => x.id === d.id)?.state
  return { on: d.id, state: up === 'cancelled' ? 'met' : up === 'done' ? 'not-met' : 'pending' }
}
export const withConditions = (s: Snapshot): Snapshot => ({ ...s, tasks: s.tasks.map(t => ({ ...t, condition: conditionOf(t, s.tasks) })) })

// CAS: fn runs against the freshest board and may re-run on conflict, so it must be pure. `stamp` then syncs seq to the last applied event.
export const commit = (h: Host, fn: (s: Snapshot) => Snapshot): Promise<Snapshot> => h.board.update(fn)
export const stamp = (h: Host, seq: number): Promise<Snapshot> => h.board.update(s => (seq > s.seq ? { ...s, seq } : s))

// Binding table: agentId -> Binding (DESIGN 4.4.4); one agent = one task.
// plain fields only; everything else in a binding is written by core/lifecycle.step
export const patchBinding = (h: Host, a: string, f: Partial<Pick<Binding, 'lastReviewedCommit' | 'ctxTokens' | 'lastAt' | 'sessionId'>>) => h.bind.update(t => (t[a] ? { ...t, [a]: { ...t[a], ...f } } : t))
export const agentsOf = (t: Record<string, Binding>, taskId: string): string[] => Object.keys(t).filter(a => t[a].taskId === taskId)
// active tasks of this session at an agent step that no live agent runs (the tester reported: the worker is not spawned yet). The context line and drive name
// the step for them instead of "running · wait" (live: main stalled there). Another session's claim (its hb owner) is never idle here.
export async function idleOf(h: Host, s?: Snapshot): Promise<string[]> {
  s ??= await h.board.read(); const b = Object.values(await h.bind.read()), me = await sessionOf(h), out: string[] = []
  for (const t of s.tasks) {
    if (t.state !== 'active' || !['tester', 'worker', 'explorer'].includes(t.step) || b.some(x => x.taskId === t.id && !x.retired && (x.step === t.step || !x.step))) continue   // no step: a spawn in flight
    const o = await ctlGet<{ s?: string }>(h, `hb:${t.id}`).catch(() => undefined)
    if (!o?.s || o.s === me) out.push(t.id)
  }
  return out
}

// ui/ hooks register here at load (core never imports ui/, DESIGN 2.3): register.ts sets them.
export const UI: { mapCard?: (h: Host, toolUseId: string, taskId: string) => Promise<unknown>; banner?: (h: Host, o: { decisions?: number; next?: string; stale?: number }) => Promise<void> } = {}
export const safe = async <T>(h: Host, what: string, f: () => Promise<T>) => { try { return await f() } catch (x) { h.log(`${what} failed: ${x}`) } }
// session = this process's random id (secret atom); a lease is live while leaseUntil is in the future
export const leaseLive = (t: Pick<Task, 'leaseUntil'>, now: number) => !!t.leaseUntil && Date.parse(t.leaseUntil) > now
export async function sessionOf(h: Host): Promise<string> {
  const n = h.rand(4); await h.secret.update(s => (s.session ? s : { ...s, session: n })); return (await h.secret.read()).session!
}
