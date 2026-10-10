// TaskStore over `bd` (DESIGN 11.2). Nothing outside adapters/beads/ knows bd. Passes tests/store-contract.ts.
import { StoreError } from '../../store'
import type { Category, DepType, NewTask, Task, TaskId, TaskStore } from '../../store'
import type { TypeRegistry } from '../../registry'
import { Bd, type BdOpts } from './bd'
import { categoryOf, closeReason, toTask } from './map'

const BUILTIN = ['bug', 'feature', 'task', 'epic', 'chore', 'decision', 'spike', 'story', 'milestone']
const CLOSED: Category[] = ['done', 'cancelled']
const SCHED: DepType[] = ['blocks', 'waits-for', 'conditional-blocks']
const first = (d: any) => (Array.isArray(d) ? d[0] : d)

export class BdStore implements TaskStore {
  private bd: Bd; private journal: boolean | undefined
  constructor(private o: BdOpts) { this.bd = new Bd(o) }

  async probe() {
    try {
      const v = (await this.bd.call(['version'])).version as string
      const [a, b] = v.split('.').map(Number), ok = a > 1 || (a === 1 && b >= 3)   // bd >= 1.3.0
      this.journal ??= (await this.bd.call(['config', 'get', 'events-journal'], { json: false }).catch(() => 'false')).trim() === 'true'
      return { ok, journal: this.journal, version: v, detail: ok ? 'bd ok' : `bd ${v} is older than 1.3.0` }
    } catch (e) { return { ok: false, journal: false, version: '', detail: String(e) } }
  }
  async init(o: { types: TypeRegistry; journal: boolean }) {
    await this.bd.call(['init', '--non-interactive', '--init-if-missing', '--skip-agents', '--skip-hooks'], { json: false })
    const types = [...new Set([...Object.keys(o.types), 'decision', 'milestone', 'gate'])].filter(t => !BUILTIN.slice(0, 5).includes(t))
    for (const kv of [['status.custom', 'draft:frozen,in_review:wip'], ['types.custom', types.join(',')], ['events-journal', String(o.journal)]]) await this.bd.call(['config', 'set', ...kv], { json: false })
    this.journal = o.journal
  }

  private async create(args: string[], description: string): Promise<string> {
    return (await this.bd.call(['create', ...args, '--stdin', '--allow-empty-description'], { stdin: description })).id
  }
  async createEpic(title: string, goal: string) { return this.create(['-t', 'epic', '-s', 'draft', `--title=${title}`], goal) }
  async createDraft(n: NewTask) {
    const id = await this.create(['-t', n.type, '--parent', n.parent, '-s', 'draft', `--title=${n.title}`, `--priority=${n.priority ?? 2}`,
      ...(n.acceptance ? [`--acceptance=${n.acceptance}`] : []), ...(n.design ? [`--design=${n.design}`] : []), ...(n.meta && Object.keys(n.meta).length ? [`--metadata=${JSON.stringify(n.meta)}`] : [])], n.description)
    // `bd create --deps blocks:x` points the other way round; `dep add <id> <on>` = id depends on `on` (the order is unambiguous)
    for (const d of [...(n.deps ?? []), ...(n.discoveredFrom ? [{ id: n.discoveredFrom, type: 'discovered-from' as DepType }] : [])]) await this.link(id, d)
    if (n.gate) await this.bd.call(['gate', 'create', '--blocks', id, `--type=${n.gate.await}`, ...(n.gate.arg ? [`--await-id=${n.gate.arg}`] : [])])
    return this.get(id)
  }
  async dropDrafts(ids: TaskId[]) {
    for (const id of ids) if ((await this.get(id)).category !== 'draft') throw new StoreError('Invalid', `${id} is not a draft`)
    for (const id of ids) await this.bd.call(['delete', id, '--force'])
  }
  // bd's own cycle check ignores waits-for/conditional-blocks edges, so walk every scheduling edge before adding one
  async link(id: TaskId, dep: { id: TaskId; type: DepType }) {
    if (SCHED.includes(dep.type)) {
      const seen = new Set<TaskId>(), reach = async (from: TaskId): Promise<boolean> => {   // sequential: bd calls stay in a deterministic order
        if (from === id) return true
        if (seen.has(from)) return false
        seen.add(from); for (const d of (await this.get(from)).deps) if (SCHED.includes(d.type) && (await reach(d.id))) return true
        return false
      }
      if (await reach(dep.id)) throw new StoreError('Cycle', `${id} <- ${dep.id}`)
    }
    await this.bd.call(['dep', 'add', id, dep.id, '--type', dep.type])
  }
  async approve(ids: TaskId[]) {
    for (const id of ids) if ((await this.get(id)).category !== 'draft') throw new StoreError('Invalid', `${id} is not a draft`)
    if (ids.length) await this.bd.call(['update', ...ids, '-s', 'open'])
  }
  async amend(id: TaskId) {
    const t = await this.get(id)
    if (t.category !== 'todo' && t.category !== 'blocked') throw new StoreError('Invalid', `${id} is ${t.category}`)
    await this.bd.call(['update', id, '-s', 'draft'])
  }
  async get(id: TaskId) { return toTask(first(await this.bd.call(['show', id]))) }
  async list(f: { parent?: TaskId; updatedAfter?: string }) {
    const xs = ((await this.bd.call(['list', ...(f.parent ? ['--parent', f.parent] : []), '--all', '-n', '0'])) as any[]).map(toTask)
    return f.updatedAfter ? xs.filter(t => t.updatedAt > f.updatedAfter!) : xs
  }
  // `bd ready --parent` reaches grandchildren (bd ids are <parent>.<n>) and lists a conditional-blocks dependant once its upstream closed at all;
  // the contract wants direct children, and a dependant runs only when the upstream FAILED (cancelled), else the machine skips it.
  async ready(parent: TaskId) {
    const ids = ((await this.bd.call(['ready', '--parent', parent, '-n', '0'])) as any[]).map(x => x.id as string).filter(id => id.startsWith(`${parent}.`) && !id.slice(parent.length + 1).includes('.'))
    if (!ids.length) return []
    const all = new Map((await this.list({ parent })).map(t => [t.id, t])), out: TaskId[] = []
    for (const id of ids) {
      let ok = true
      for (const d of all.get(id)?.deps ?? []) if (d.type === 'conditional-blocks' && ((all.get(d.id) ?? (await this.get(d.id))).category !== 'cancelled')) ok = false
      if (ok) out.push(id)
    }
    return out
  }

  async claim(id: TaskId, actor: string) {
    const t = await this.get(id)
    if (t.assignee && t.category !== 'todo') throw new StoreError('AlreadyClaimed', `${id} is held by ${t.assignee}`)
    if (t.category !== 'todo') throw new StoreError('NotClaimable', `${id} is ${t.category}`)
    await this.bd.call(['update', id, '--claim'], { actor }); return this.get(id)
  }
  async resume(id: TaskId, actor: string) {
    const t = await this.get(id)
    if (t.assignee !== actor) throw new StoreError('GuardMismatch', `${id} is held by ${t.assignee ?? 'nobody'}`)
    if (t.category !== 'review' && t.category !== 'blocked' && t.category !== 'active') throw new StoreError('Invalid', `${id} is ${t.category}`)
    await this.bd.call(['update', id, '-s', 'in_progress', '--if-assignee', actor], { actor }); await this.bd.call(['heartbeat', id], { actor }); return this.get(id)
  }
  async release(id: TaskId, actor: string, why: string) {
    await this.bd.call(['update', id, '-s', 'open', '--assignee=', '--if-assignee', actor], { actor }); await this.comment(id, `released: ${why}`, actor)
  }
  async move(id: TaskId, to: 'review' | 'blocked', actor: string) {
    const t = await this.get(id)
    if (!(t.category === 'active' || (to === 'blocked' && t.category === 'review'))) throw new StoreError('Invalid', `${id}: ${t.category} -> ${to}`)
    await this.bd.call(['update', id, '-s', to === 'review' ? 'in_review' : 'blocked', '--if-assignee', actor], { actor }); return this.get(id)
  }
  async heartbeat(id: TaskId) {   // bd lets only the holder beat, so beat as the assignee
    const t = await this.get(id); if (!t.assignee) throw new StoreError('Invalid', `${id} is not claimed`)
    await this.bd.call(['heartbeat', id], { actor: t.assignee })
  }

  async update(id: TaskId, p: Parameters<TaskStore['update']>[1], actor: string) {
    const a = [...(p.title !== undefined ? [`--title=${p.title}`] : []), ...(p.acceptance !== undefined ? [`--acceptance=${p.acceptance}`] : []), ...(p.design !== undefined ? [`--design=${p.design}`] : []),
      ...(p.priority !== undefined ? [`--priority=${p.priority}`] : []), ...(p.labels ? [`--set-labels=${p.labels.join(',')}`] : [])]
    if (p.description !== undefined) await this.bd.call(['update', id, '--stdin', '--allow-empty-description'], { actor, stdin: p.description })
    if (a.length) await this.bd.call(['update', id, ...a], { actor })
    return this.get(id)
  }
  async comment(id: TaskId, text: string, actor: string) { await this.bd.call(['comment', id, '--stdin'], { actor, stdin: text }) }
  // ponytail: bd 1.3.1 has no `update --if-revision`; read-check-write (A30 fallback). The window is one bd call, and cadre's writers hold the claim.
  async setMeta(id: TaskId, kv: Record<string, string>, actor: string, ifRevision?: string) {
    if (ifRevision !== undefined) { const cur = (await this.get(id)).revision; if (cur !== ifRevision) throw new StoreError('GuardMismatch', `${id} is at revision ${cur}`) }
    await this.bd.call(['update', id, ...Object.entries(kv).map(([k, v]) => `--set-metadata=${k}=${v}`)], { actor }); return this.get(id)
  }
  async setExternalRef(id: TaskId, ref: string, actor: string) { await this.bd.call(['update', id, `--external-ref=${ref}`], { actor }) }
  async resolveGate(gateId: TaskId, reason: string) {
    if ((await this.get(gateId)).type !== 'gate') throw new StoreError('Invalid', `${gateId} is not a gate`)
    await this.bd.call(['gate', 'resolve', gateId, `--reason=${reason}`], { json: false })
  }
  async record(kind: 'mission' | 'decision', title: string, body: string, link?: TaskId) {
    const id = await this.create(['-t', kind === 'mission' ? 'milestone' : 'decision', '-s', 'open', `--title=${title}`, ...(link ? [`--metadata=${JSON.stringify({ link })}`] : [])], body)
    if (kind === 'decision') await this.bd.call(['close', id, '--force', '-r=recorded'])
    return id
  }
  async close(id: TaskId, o: { outcome: 'done' | 'cancelled'; note?: string; session?: string; ifRevision?: string }) {
    const t = await this.get(id)
    if (CLOSED.includes(t.category)) throw new StoreError('NotClosable', `${id} is ${t.category}`)
    if (o.ifRevision !== undefined && t.revision !== o.ifRevision) throw new StoreError('GuardMismatch', `${id} is at revision ${t.revision}`)
    await this.bd.call(['close', id, '--force', `-r=${closeReason(o.outcome, o.note)}`, ...(o.session ? [`--session=${o.session}`] : [])]); return this.get(id)
  }
  async events(since = '0', limit = 500) {
    this.journal ??= (await this.probe()).journal
    if (!this.journal) return null
    const rows = await this.bd.lines(['events', 'tail', '--since', since, '--limit', String(limit)])
    return { head: rows.length ? String(rows[rows.length - 1].seq) : since, events: rows.map(r => ({ seq: String(r.seq), op: r.op as string, id: r.issue_id as TaskId, actor: r.actor as string, status: (r.issue as any)?.status, assignee: (r.issue as any)?.assignee, category: (r.issue as any)?.status ? categoryOf((r.issue as any).status, (r.issue as any).close_reason) : undefined, at: r.ts ? Date.parse(r.ts as string) : undefined })) }
  }
}
