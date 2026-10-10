// Read model (DESIGN 2.5): snapshot, model/human views, CAS helper, binding table. Snapshot types live in types/index.d.ts.
import type { Binding, Host, Snapshot, SnapTask } from '../types'
import type { Task } from '../task-management/store'

export const emptySnapshot = (repo = ''): Snapshot => ({
  schemaVersion: 1, seq: 0, repo, mission: null, epic: null, plan: null, tasks: [],
  approval: { planId: null, missing: [] },
  drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null },
  sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [],
})
export const isCold = (s: Snapshot): boolean => s.seq === 0   // lazy rehydrate trigger (DESIGN 13.4)

// canonical JSON: sorted keys, undefined dropped. fnv1a64 over it = the snapshot hash (diff gate) and code8's input.
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  for (const b of new TextEncoder().encode(s)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}

// Two views of one schema. Neither carries a code (those live in the `secret` atom).
export const humanView = (s: Snapshot): Snapshot => structuredClone(s)   // band, pane, toasts, adapters granted `commands`
// model view (main context, TaskGet, cards, adapters without grant): drops volatile fields so the hash only moves on real change
export function modelView(s: Snapshot): Omit<Snapshot, 'seq' | 'cost'> {
  const { seq: _s, cost: _c, ...v } = structuredClone(s)
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
export const bindAgent = (h: Host, agentId: string, b: Binding) => h.bind.update(t => ({ ...t, [agentId]: b }))
export const unbindAgent = (h: Host, agentId: string) => h.bind.update(({ [agentId]: _gone, ...rest }) => rest)
export const bindingOf = (t: Record<string, Binding>, agentId?: string): Binding | undefined => (agentId ? t[agentId] : undefined)
export const agentsOf = (t: Record<string, Binding>, taskId: string): string[] => Object.keys(t).filter(a => t[a].taskId === taskId)

// ui/ hooks register here at load (core never imports ui/, DESIGN 2.3): register.ts sets them.
export const UI: { mapCard?: (h: Host, toolUseId: string, taskId: string) => Promise<unknown>; banner?: (h: Host, o: { decisions?: number; next?: string; stale?: number }) => Promise<void> } = {}
export const safe = async <T>(h: Host, what: string, f: () => Promise<T>) => { try { return await f() } catch (x) { h.log(`cadre: ${what} failed: ${x}`) } }
// session = this process's random id (secret atom); a lease is live while leaseUntil is in the future
export const leaseLive = (t: Pick<Task, 'leaseUntil'>, now: number) => !!t.leaseUntil && Date.parse(t.leaseUntil) > now
export async function sessionOf(h: Host): Promise<string> {
  const n = h.rand(4); await h.secret.update(s => (s.session ? s : { ...s, session: n })); return (await h.secret.read()).session!
}
