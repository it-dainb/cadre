// In-memory TaskStore: CADRE_STORE=memory, and the op engine of the file store (adapters/file: it hydrates `tasks`/`journal`/`ctl`, sets `mint`, reads `log`). Same contract test (tests/store-contract.ts).
import { StoreError } from '../../store'
import type { Category, DepType, NewTask, Task, TaskId, TaskStore } from '../../store'

const NATIVE: Record<Category, string> = { draft: 'draft', todo: 'open', active: 'in_progress', review: 'in_review', blocked: 'blocked', done: 'closed', cancelled: 'closed' }
const LEASE_MS = 5 * 60_000
const BLOCKING: DepType[] = ['blocks', 'waits-for', 'conditional-blocks']

export class MemoryStore implements TaskStore {
  tasks: Map<TaskId, Task> | null = null
  private n = 0
  journal = false
  ctl: { revision: string; doc: Record<string, unknown> } = { revision: '0', doc: {} }
  log: { seq: string; op: string; id: TaskId; actor: string; status?: string; assignee?: string; category?: Category; at?: number }[] = []
  constructor(private now: () => number = () => Date.now(), public mint: () => TaskId = () => `m-${++this.n}`) {}

  private db() { if (!this.tasks) throw new StoreError('NotInitialized'); return this.tasks }
  private t(id: TaskId): Task { const t = this.db().get(id); if (!t) throw new StoreError('NotFound', id); return t }
  // every mutation: bump revision + updatedAt, journal it, hand back a copy
  private touch(t: Task, op: string, actor = 'mod'): Task {
    t.revision = String(Number(t.revision ?? 0) + 1); t.updatedAt = new Date(this.now()).toISOString(); t.nativeStatus = NATIVE[t.category]
    this.log.push({ seq: String(this.log.length + 1), op, id: t.id, actor, status: t.nativeStatus, assignee: t.assignee, category: t.category, at: this.now() })
    return structuredClone(t)
  }
  private mk(o: Partial<Task> & { title: string; type: string; category: Category }): Task {
    const t: Task = { id: this.mint(), description: '', nativeStatus: '', priority: 2, deps: [], labels: [], meta: {}, updatedAt: '', ...o }
    this.db().set(t.id, t); this.touch(t, 'create'); return t
  }
  private mine(t: Task, actor: string) { if (t.assignee !== actor) throw new StoreError('GuardMismatch', `${t.id} is held by ${t.assignee ?? 'nobody'}`) }
  private closed = (t?: Task) => t?.category === 'done' || t?.category === 'cancelled'
  private satisfied(d: { id: TaskId; type: DepType }): boolean {
    const up = this.db().get(d.id)
    if (d.type === 'conditional-blocks') return up?.category === 'cancelled'                       // runs only if upstream failed
    if (d.type === 'waits-for') return this.closed(up) && [...this.db().values()].filter(k => k.parent === d.id).every(this.closed)
    return this.closed(up)                                                                        // blocks
  }

  async probe() { return { ok: true, journal: this.journal, version: 'memory', detail: this.tasks ? 'initialized' : 'not initialized' } }
  async init(o: { journal: boolean }) { this.tasks ??= new Map(); this.journal = o.journal }
  async createEpic(title: string, goal: string) { return this.mk({ title, description: goal, type: 'epic', category: 'draft' }).id }
  async createDraft(n: NewTask) {
    this.t(n.parent)
    const deps = [...(n.deps ?? [])]; if (n.discoveredFrom) deps.push({ id: n.discoveredFrom, type: 'discovered-from' })
    const t = this.mk({ title: n.title, description: n.description, acceptance: n.acceptance, design: n.design, type: n.type, priority: (n.priority ?? 2) as Task['priority'], parent: n.parent, deps, meta: { ...n.meta }, category: 'draft' })
    if (n.gate) { const g = this.mk({ title: `gate:${n.gate.await}`, type: 'gate', category: 'todo', parent: n.parent, meta: { 'gate.await': n.gate.await, 'gate.arg': n.gate.arg ?? '' } }); t.deps.push({ id: g.id, type: 'blocks' }) }
    return this.touch(t, 'draft')
  }
  async dropDrafts(ids: TaskId[]) { for (const id of ids) { if (this.t(id).category !== 'draft') throw new StoreError('Invalid', `${id} is not a draft`) } ids.forEach(id => this.db().delete(id)) }
  async link(id: TaskId, dep: { id: TaskId; type: DepType }) {
    const t = this.t(id); this.t(dep.id)
    const reach = (from: TaskId, seen = new Set<TaskId>()): boolean =>   // does `from` already depend (blocking) on id?
      from === id || (!seen.has(from) && (seen.add(from), (this.db().get(from)?.deps ?? []).some(d => BLOCKING.includes(d.type) && reach(d.id, seen))))
    if (BLOCKING.includes(dep.type) && reach(dep.id)) throw new StoreError('Cycle', `${id} <- ${dep.id}`)
    t.deps.push(dep); this.touch(t, 'link')
  }
  async approve(ids: TaskId[]) { ids.forEach(id => { if (this.t(id).category !== 'draft') throw new StoreError('Invalid', `${id} is not a draft`) }); ids.forEach(id => { const t = this.t(id); t.category = 'todo'; this.touch(t, 'approve') }) }
  async amend(id: TaskId) { const t = this.t(id); if (t.category !== 'todo' && t.category !== 'blocked') throw new StoreError('Invalid', `${id} is ${t.category}`); t.category = 'draft'; this.touch(t, 'amend') }
  async get(id: TaskId) { return structuredClone(this.t(id)) }
  async list(f: { parent?: TaskId; updatedAfter?: string }) {
    return [...this.db().values()].filter(t => (f.parent === undefined || t.parent === f.parent) && (!f.updatedAfter || t.updatedAt > f.updatedAfter)).map(t => structuredClone(t))
  }
  async ready(parent: TaskId) { return [...this.db().values()].filter(t => t.parent === parent && t.category === 'todo' && t.type !== 'gate' && t.deps.every(d => !BLOCKING.includes(d.type) || this.satisfied(d))).map(t => t.id) }
  async claim(id: TaskId, actor: string) {
    const t = this.t(id)
    if (t.assignee && t.category !== 'todo') throw new StoreError('AlreadyClaimed', `${id} is held by ${t.assignee}`)
    if (t.category !== 'todo') throw new StoreError('NotClaimable', `${id} is ${t.category}`)
    Object.assign(t, { category: 'active', assignee: actor, leaseUntil: new Date(this.now() + LEASE_MS).toISOString() }); return this.touch(t, 'claim', actor)
  }
  async resume(id: TaskId, actor: string) {
    const t = this.t(id); this.mine(t, actor)
    if (t.category !== 'review' && t.category !== 'blocked' && t.category !== 'active') throw new StoreError('Invalid', `${id} is ${t.category}`)
    t.category = 'active'; return this.touch(t, 'resume', actor)
  }
  async release(id: TaskId, actor: string, _why: string) {
    const t = this.t(id); this.mine(t, actor)
    t.category = 'todo'; delete t.assignee; delete t.leaseUntil; this.touch(t, 'release', actor)
  }
  async move(id: TaskId, to: 'review' | 'blocked', actor: string) {
    const t = this.t(id); this.mine(t, actor)
    if (!(t.category === 'active' || (to === 'blocked' && t.category === 'review'))) throw new StoreError('Invalid', `${id}: ${t.category} -> ${to}`)
    t.category = to; return this.touch(t, `move:${to}`, actor)
  }
  async heartbeat(id: TaskId) { const t = this.t(id); if (!t.assignee) throw new StoreError('Invalid', `${id} is not claimed`); t.leaseUntil = new Date(this.now() + LEASE_MS).toISOString(); this.touch(t, 'heartbeat', t.assignee) }
  async update(id: TaskId, patch: Parameters<TaskStore['update']>[1], actor: string) { const t = this.t(id); Object.assign(t, patch); return this.touch(t, 'update', actor) }
  async setMeta(id: TaskId, kv: Record<string, string>, actor: string, ifRevision?: string) {
    const t = this.t(id)
    if (ifRevision !== undefined && t.revision !== ifRevision) throw new StoreError('GuardMismatch', `${id} is at revision ${t.revision}`)
    Object.assign(t.meta, kv); return this.touch(t, 'meta', actor)
  }
  async setExternalRef(id: TaskId, ref: string, actor: string) { const t = this.t(id); t.externalRef = ref; this.touch(t, 'externalRef', actor) }
  async resolveGate(gateId: TaskId, reason: string) { const g = this.t(gateId); if (g.type !== 'gate') throw new StoreError('Invalid', `${gateId} is not a gate`); await this.close(gateId, { outcome: 'done', note: reason }) }
  async record(kind: 'mission' | 'decision', title: string, body: string, link?: TaskId) {
    return this.mk({ title, description: body, type: kind === 'mission' ? 'milestone' : 'decision', category: kind === 'mission' ? 'todo' : 'done', meta: link ? { link } : {} }).id
  }
  async close(id: TaskId, o: { outcome: 'done' | 'cancelled'; note?: string; session?: string; ifRevision?: string }) {
    const t = this.t(id)
    if (this.closed(t)) throw new StoreError('NotClosable', `${id} is ${t.category}`)
    if (o.ifRevision !== undefined && t.revision !== o.ifRevision) throw new StoreError('GuardMismatch', `${id} is at revision ${t.revision}`)
    t.category = o.outcome; delete t.leaseUntil; if (o.note) t.meta['close.note'] = o.note
    return this.touch(t, 'close', o.session)
  }
  async control() { this.db(); return structuredClone(this.ctl) }
  async setControl(patch: Record<string, unknown>, ifRevision?: string) {
    this.db(); if (ifRevision !== undefined && this.ctl.revision !== ifRevision) throw new StoreError('GuardMismatch', `control is at revision ${this.ctl.revision}`)
    this.ctl = { revision: String(Number(this.ctl.revision) + 1), doc: { ...this.ctl.doc, ...patch } }; return structuredClone(this.ctl)
  }
  async events(since?: string, limit = 500) {
    if (!this.journal) return null
    const n = Number(since ?? 0); return { head: String(this.log.length), events: this.log.filter(e => Number(e.seq) > n).slice(0, limit) }
  }
}
