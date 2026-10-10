// One target's push + pull (DESIGN 11.4 steps 2-3): per-field fnv64 hashes, upsert by stored rid, pull -> 3-way merge -> flags.
import type { Host } from '../../types'
import { emit } from '../../core/events'
import type { Task, TaskStore } from '../store'
import { call } from '../protocol'
import type { AdapterCfg } from '../protocol'
import { hash, merge } from './merge'
import type { Base } from './merge'

export interface Ctx { h: Host; store: TaskStore; name: string; a: AdapterCfg; target: string; t: { project?: string; url?: string; mapping?: any; direction?: string }; actor: string; first: boolean }
type Meta = Base & { rid?: string; etag?: string; skip?: number }
const key = (c: Ctx) => `cadre.sync.${c.target}`
export const metaOf = (c: Ctx, t: Task): Meta => { try { return { l: {}, r: {}, ...JSON.parse(t.meta[key(c)]) } } catch { return { l: {}, r: {} } } }
const save = (c: Ctx, id: string, m: Meta) => c.store.setMeta(id, { [key(c)]: JSON.stringify(m) }, `${c.actor}+sync`)

export function fieldsOf(c: Ctx, t: Task): Record<string, string> {
  const m = c.t.mapping ?? {}
  return { title: t.title, description: t.description, acceptance: t.acceptance ?? '', priority: String(m.priority?.[t.priority] ?? t.priority), status: String(m.status?.[t.category] ?? t.category), type: String(m.type?.[t.type] ?? t.type) }
}
export async function flag(h: Host, taskId: string, f: string): Promise<void> {
  let added = false
  await h.board.update(s => { added = false; const t = s.tasks.find(x => x.id === taskId); if (!t || t.flags.includes(f)) return s; added = true; return { ...s, tasks: s.tasks.map(x => x.id === taskId ? { ...x, flags: [...x.flags, f] } : x) } })
  if (added) await emit(h, 'flag.raised', { taskId, flag: f }, { taskId, actor: 'sync' })
}
const unprio = (c: Ctx, v: string): number | undefined => { const e = Object.entries(c.t.mapping?.priority ?? {}).find(([, x]) => x === v); const n = e ? Number(e[0]) : Number(v); return Number.isInteger(n) && n >= 0 && n <= 4 ? n : undefined }

// pull first (so a concurrent remote edit is merged, not overwritten), then push every task whose hashes moved. Returns {pulled, pushed, next}.
export async function reconcile(c: Ctx, tasks: () => Promise<Task[]>, since: string | undefined, dir: string, pushSet: () => Promise<Task[]>): Promise<{ pulled: number; pushed: number; next?: string }> {
  const notes = new Map<string, string>(), touched = new Set<string>(); let pulled = 0, next: string | undefined
  if (dir !== 'push') {
    const res = await call(c.h, c.name, c.a, 'pull', { project: c.t.project, since })
    next = res.next
    if (res.tasks?.length) {
      const all = await tasks()
      for (const rt of res.tasks as { rid: string; etag?: string; localId?: string; fields: Record<string, string> }[]) {
        const t = all.find(x => x.id === rt.localId) ?? all.find(x => metaOf(c, x).rid === rt.rid); if (!t) continue
        const m = metaOf(c, t); if (rt.etag && rt.etag === m.etag) continue   // dedupe: seen
        const r = merge(fieldsOf(c, t), rt.fields ?? {}, m), keys = Object.keys(r.pull)
        if (keys.length) {
          const patch: Record<string, any> = { ...r.pull }; if ('priority' in patch) { const p = unprio(c, patch.priority); if (p === undefined) delete patch.priority; else patch.priority = p }
          await c.store.update(t.id, patch, `${c.actor}+sync`); await flag(c.h, t.id, 'edited'); pulled++
        }
        if (r.conflict.length) { notes.set(t.id, `cadre: ${r.conflict.join(', ')} changed on both sides; the beads value was kept`); await flag(c.h, t.id, 'conflict') }
        if (r.drift) await flag(c.h, t.id, 'drift')
        if (r.conflict.length || r.drift) touched.add(t.id)   // the pull's own writes are +sync (skipped by the journal scan): push these back this cycle
        await save(c, t.id, { ...m, rid: rt.rid, etag: rt.etag, ...r.next })
      }
    }
  }
  let pushed = 0
  if (dir !== 'pull') {
    const items = []
    const set = await pushSet(), have = new Set(set.map(x => x.id))
    for (const id of touched) if (!have.has(id)) set.push(await c.store.get(id))
    for (const t of set) {
      const m = metaOf(c, t); if (m.skip || t.category === 'draft' || t.type === 'gate') continue
      const fields = fieldsOf(c, t), changed = Object.keys(fields).filter(f => hash(fields[f]) !== m.l[f])
      if (changed.length || !m.rid) items.push({ t, m, fields, changed, note: notes.get(t.id) })
    }
    if (items.length) {
      const res = await call(c.h, c.name, c.a, 'push', { project: c.t.project, tasks: items.map(i => ({ localId: i.t.id, rid: i.m.rid, etag: i.m.etag, changed: i.changed, fields: i.fields, ...(i.note ? { note: i.note } : {}) })) })
      for (const r of res.results as { localId: string; rid: string; etag?: string }[]) {
        const i = items.find(x => x.t.id === r.localId); if (!i) continue
        const hs = Object.fromEntries(Object.entries(i.fields).map(([f, v]) => [f, hash(v)]))
        await save(c, i.t.id, { rid: r.rid, etag: r.etag, l: hs, r: { ...i.m.r, ...Object.fromEntries(i.changed.map(f => [f, hs[f]])) } })
        if (c.first && !i.t.externalRef) await c.store.setExternalRef(i.t.id, `${c.target}:${r.rid}`, `${c.actor}+sync`); pushed++
      }
    }
  }
  return { pulled, pushed, next }
}
