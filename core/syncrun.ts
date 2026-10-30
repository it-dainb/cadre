// Sync, core's side (plan 2.15, D17). On the one 5 s tick a *unit* (a `sync` target, or an adapter with the `events` grant) that is due runs `modules/sync.mjs` once through core/modrun:
// core takes the lease (targets), writes the input (cursor, the module's blob, tasks with a `base`, the journal or the model view), reads CADRE_RESULT back whether or not the process
// exited cleanly, re-checks the lease, and applies the validated result in-process (`applySync`: validate everything, then apply; no dispatcher command). Core keeps no adapter client:
// the module spawns every adapter. Lease + cursor stay on the store's control doc, backoff in `sync.rt:<unit>`, the module's memory in `mod:sync:<unit>`. No regex here.
import type { Host } from '../types'
import { active, firstType } from './pipeline'
import { agentsOf, canon, fnv1a64, modelView, sessionOf } from './board'
import { emit, ofEpic, subscribe } from './events'
import { ROUTES, cfgOf, initConfirm, initPropose, storeOf } from './dispatch'
import { pushDelta } from './briefs'
import { modrun } from './modrun'
import { moduleBad } from './profile'
import { modelText } from './say'
import { wtRootOf } from './branches'
import { SYNC_KEYS } from '../config/index'
import { writeRepoConfig } from '../config/route'
import { repoKeyOf } from '../commands/init'
import { StoreError } from '../task-management/store'
import type { Task, TaskStore } from '../task-management/store'

type A = { command?: string[]; credentialEnv?: string; envPass?: string[]; url?: string; repo?: { module?: string }; grants?: string[] }
export type Unit = { id: string; kind: 'target' | 'events'; adapter: string; a: A; target?: string; t?: Record<string, any> }
type RT = { next: number; backoff: number; state?: string; at?: number; message?: string; stale?: number }
type Lease = { cursor?: string; since?: string; lastHeal?: number; lease?: { session: string; until: number } }
// wall: the kill; deadline: the module stops starting adapter exchanges; the lease outlives the wall by a minute so an apply after the exit cannot outlive it (D22)
export const LIM = { wall: 60_000, deadline: 45_000, batch: 25 }
const LEASE = 120_000, EVERY = 30_000, MAX_BACKOFF = 300_000, MAX_IN = 2_000_000, MAX_STATE = 65_536, MAX_DELTAS = 500
const HUMAN = ['title', 'description', 'acceptance', 'priority'], FLAGS = ['edited', 'conflict', 'drift', 'external'], STATES = ['ok', 'offline', 'auth', 'conflict']
const OPS: Record<string, string[]> = { edit: ['id', 'fields', 'base'], meta: ['id', 'key', 'value', 'base'], flag: ['id', 'flag', 'base'], ref: ['id', 'ref', 'base'], draft: ['title', 'description', 'meta'] }
const KEYS = ['state', 'message', 'retryAfterMs', 'modState', 'partial', 'refused', 'ops', 'cursor', 'since', 'lastHeal', 'target']
const SYNC_ADD = 9   // its own confirm stage: init's stage 8 (sync) must not accept a sync-add code, nor the reverse
const obj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x), str = (x: unknown) => typeof x === 'string'
const INFLIGHT = new Set<string>()

subscribe((h, ev) => { if (ev.type === 'task.transitioned') return h.ui.update(u => ({ ...u, syncWake: 1 })) })   // sync wake (11.4 step 5)

export function unitsOf(cfg: { sync?: Record<string, any>; adapters?: Record<string, any> }): Unit[] {
  const ad = (cfg.adapters ?? {}) as Record<string, A>
  return [...Object.entries(cfg.sync ?? {}).filter(([, t]) => ad[t?.adapter]?.grants?.includes('sync') && t.direction !== 'off').map(([target, t]): Unit => ({ id: target, kind: 'target', adapter: t.adapter, a: ad[t.adapter], target, t })),
    ...Object.entries(ad).filter(([, a]) => a?.grants?.includes('events')).map(([adapter, a]): Unit => ({ id: `events:${adapter}`, kind: 'events', adapter, a }))]
}

// ---- lease: the control doc's `sync.<target>` field; a live lease of another session loses, a race on that field loses (other fields move freely). `held`: the re-check before an apply ----
async function lease(store: TaskStore, target: string, session: string, now: number, held = false): Promise<Lease | null> {
  const k = `sync.${target}`, c = await store.control(), s = (c.doc[k] ?? {}) as Lease
  if (held ? !(s.lease && s.lease.session === session && s.lease.until > now) : s.lease && s.lease.until > now && s.lease.session !== session) return null
  try { return (await store.setControl({ [k]: { ...s, lease: { session, until: now + LEASE } } }, { [k]: c.doc[k] })).doc[k] as Lease } catch (e) { if (e instanceof StoreError && e.code === 'GuardMismatch') return null; throw e }
}

const rtOf = async (h: Host, id: string) => ((await h.store.get(`sync.rt:${id}`)) as RT | undefined) ?? { next: 0, backoff: 0 }
export async function setState(h: Host, target: string, state: 'ok' | 'offline' | 'conflict' | 'auth', pending: number): Promise<void> {
  const at = await h.now(); let was: string | undefined, conflicts = 0
  await h.board.update(s => { was = s.sync.find(x => x.target === target)?.state; conflicts = s.tasks.filter(t => t.flags.some(f => f === 'external' || f.startsWith('drift'))).length; return { ...s, sync: [...s.sync.filter(x => x.target !== target), { target, state, pending, at }] } })
  if (was !== state && !(was === undefined && state === 'ok')) await emit(h, 'sync.state_changed', { target, state, at, ...(pending ? { pending } : {}), ...(conflicts ? { conflicts } : {}) }, { severity: state === 'ok' ? 'info' : 'warn' })
}
// the unit's outcome: the module's result sets state, backoff (30 s doubling to 5 min; an auth failure waits the longest; a rate limit says how long) and the Doctor row's facts
async function settle(h: Host, u: Unit, state: string, message?: string, retryAfterMs?: number, stale = 0): Promise<void> {
  const now = await h.now(), rt = await rtOf(h, u.id), bad = state !== 'ok', backoff = state === 'auth' ? MAX_BACKOFF : Math.min(MAX_BACKOFF, Math.max(EVERY, rt.backoff * 2))
  await h.store.set(`sync.rt:${u.id}`, { next: now + (bad ? retryAfterMs || backoff : EVERY), backoff: bad ? backoff : 0, state, at: now, ...(message ? { message } : {}), ...(stale ? { stale } : {}) })
  if (bad) h.log(`sync ${u.id}: ${message}`)
  if (u.target) await setState(h, u.target, state as 'ok', 0)
}

// ---- the input: tasks with a `base` (the hash of what a pull may edit, plus the unit's meta as read now) ----
const baseOf = (t: Task, target: string): string => fnv1a64(canon([t.title, t.description, t.acceptance ?? '', t.priority, t.meta[`cadre.sync.${target}`] ?? '']))
// what the module needs of the adapter: how to start it and the names (never the values) of its credential and pass-through variables
const adapterOf = async (h: Host, u: Unit) => ({ name: u.adapter, argv: u.a.repo?.module ? ['node', `${await h.cwd()}/.cadre/modules/${u.a.repo.module}`] : u.a.command ?? [], grants: u.a.grants, ...(u.a.credentialEnv ? { credentialEnv: u.a.credentialEnv } : {}), envPass: u.a.envPass ?? [], ...(u.a.url ? { url: u.a.url } : {}) })
async function inputOf(h: Host, cfg: any, u: Unit, store: TaskStore, st: Lease, force: boolean): Promise<Record<string, unknown>> {
  const base = { unit: u.id, force, now: await h.now(), adapter: await adapterOf(h, u), modState: await h.store.get(`mod:sync:${u.id}`) }
  if (u.kind === 'events') {
    const ring = await h.events.read(), b = await h.board.read(), view = modelView(b)
    return { ...base, kind: 'events', events: { epic: b.epic ?? '', seq: ring.seq, events: ofEpic(ring, b.epic ?? ''), snapshot: view, hash: fnv1a64(canon(view)) } }
  }
  const target = u.target!, actor = String((await h.store.get(`cadre:${repoKeyOf(await h.cwd())}:actor`)) ?? 'cadre/sync')
  const ev = await store.events(st.cursor, 500).then(x => x ?? {}, async e => { if (e instanceof StoreError && e.code === 'TooOld') return { tooOld: true, head: (await store.events(undefined, 0))?.head }; throw e })
  const tasks = (await store.list({})).filter(t => t.category !== 'draft').map(t => ({ id: t.id, title: t.title, description: t.description, acceptance: t.acceptance, type: t.type, category: t.category, priority: t.priority, externalRef: t.externalRef, link: t.meta.link, meta: { [`cadre.sync.${target}`]: t.meta[`cadre.sync.${target}`] }, base: baseOf(t, target) }))
  return { ...base, kind: 'target', self: actor, first: Object.keys(cfg.sync)[0] === target, wasOk: ((await h.board.read()).sync.find(x => x.target === target)?.state ?? 'ok') === 'ok',
    target: { name: target, project: u.t?.project, url: u.t?.url ?? u.a.url, mapping: u.t?.mapping, direction: u.t?.direction }, state: { cursor: st.cursor, since: st.since, lastHeal: st.lastHeal }, journal: ev, tasks }
}

// ---- applySync: validate the whole result, then apply it. Only core/syncrun calls it, after the module's process is gone; refusals are thrown before anything is written ----
function shape(r: any, u: { target?: string; kind: string; adapter: string; a: A }): string | null {
  if (!obj(r) || Object.keys(r).some(k => !KEYS.includes(k))) return 'the result has an unknown key'
  if (!STATES.includes(r.state)) return 'the result has no valid state'
  if (r.target !== undefined && r.target !== u.target) return `the result is for target ${r.target}, not ${u.target}`
  if (r.modState !== undefined && JSON.stringify(r.modState).length > MAX_STATE) return 'the module state is over 64 KB'
  if (r.cursor != null && !str(r.cursor) || r.since !== undefined && !str(r.since) || r.lastHeal !== undefined && typeof r.lastHeal !== 'number' || r.refused !== undefined && !(Array.isArray(r.refused) && r.refused.every(str))) return 'a cursor, since, lastHeal or refused value has the wrong type'
  const ops = r.ops ?? []; if (!Array.isArray(ops)) return 'ops is not a list'
  if (ops.length && !(u.kind === 'target' && u.a.grants?.includes('sync'))) return `adapter ${u.adapter} has no sync grant`
  for (const o of ops) {
    const keys = OPS[o?.op]; if (!keys || Object.keys(o).some(k => k !== 'op' && !keys.includes(k))) return `an op outside the closed set: ${String(o?.op).slice(0, 20)}`
    if (o.base !== undefined && !str(o.base) || keys.includes('id') && !str(o.id)) return `${o.op}: id or base is not text`
    const bad = o.op === 'edit' ? !obj(o.fields) || Object.entries(o.fields).some(([k, v]) => !HUMAN.includes(k) || (k === 'priority' ? !Number.isInteger(v) || v < 0 || v > 4 : !str(v)))
      : o.op === 'meta' ? !(o.key === `cadre.sync.${u.target}` || str(o.key) && o.key.startsWith('cadre.remote.') && [...HUMAN, 'status'].includes(o.key.slice('cadre.remote.'.length))) || !str(o.value)
      : o.op === 'flag' ? !FLAGS.includes(o.flag) : o.op === 'ref' ? !str(o.ref) || !o.ref.startsWith(`${u.target}:`) : !str(o.title) || !str(o.description) || o.meta !== undefined && !str(o.meta)
    if (bad) return `${o.op}: a field or key outside what a pull may set`
  }
  return null
}
const raise = async (h: Host, id: string, f: string) => {
  let added = false
  await h.board.update(s => { added = false; const t = s.tasks.find(x => x.id === id); if (!t || t.flags.includes(f)) return s; added = true; return { ...s, tasks: s.tasks.map(x => x.id === id ? { ...x, flags: [...x.flags, f] } : x) } })
  if (added) await emit(h, 'flag.raised', { taskId: id, flag: f }, { taskId: id, actor: 'sync' })
}
// `check`: only validate and compare bases, throwing when a task changed (the wizard's confirm); nothing is written
export async function applySync(h: Host, u: Unit, r: any, check = false): Promise<{ stale: number }> {
  const why = shape(r, u); if (why) throw new Error(`refused: ${why}`)
  const store = await storeOf(h), ops = (r.ops ?? []) as any[], actor = `cadre/${u.adapter}+sync`, target = u.target ?? '', cur = new Map<string, string>()
  for (const id of new Set(ops.filter(o => o.id).map(o => o.id as string))) { try { cur.set(id, baseOf(await store.get(id), target)) } catch (e) { if (e instanceof StoreError && e.code === 'NotFound') throw new Error(`refused: no task ${id}`); throw e } }
  if (check) { if (ops.some(o => o.base !== undefined && o.base !== cur.get(o.id))) throw new Error('refused: a task changed since the proposal was shown; nothing written, run the step again'); return { stale: 0 } }
  let stale = 0, deltas = 0, parent: string | undefined   // parent: the import's one backlog epic, made once
  for (const o of ops) {
    if (o.base !== undefined && o.base !== cur.get(o.id)) { stale++; continue }   // the task changed while the module ran: dropped, retried next cycle
    if (o.op === 'edit') {
      await store.update(o.id, o.fields, actor)
      const msg = `sync: ${o.id} edited on the tracker: ${Object.entries(o.fields).map(([k, v]) => `${k} = ${JSON.stringify(String(v).slice(0, 120))}`).join('; ')}`
      for (const a of agentsOf(await h.bind.read(), o.id)) if (deltas++ < MAX_DELTAS) await pushDelta(h, a, modelText('context', msg))
    } else if (o.op === 'meta') await store.setMeta(o.id, { [o.key]: o.value }, actor)
    else if (o.op === 'flag') await raise(h, o.id, o.flag)
    else if (o.op === 'ref') await store.setExternalRef(o.id, o.ref, actor)
    else { const b = await h.board.read(), t = await store.createDraft({ title: o.title, description: o.description, type: firstType(), parent: (parent ??= b.mission ?? b.epic ?? await store.createEpic('backlog', `imported from ${u.adapter}`)) }); if (o.meta) await store.setMeta(t.id, { [`cadre.sync.${target}`]: o.meta }, actor) }
  }
  if (r.modState !== undefined) await h.store.set(`mod:sync:${u.id}`, r.modState)
  if (u.target && r.state === 'ok' && !r.partial && !stale && r.lastHeal !== undefined) { const k = `sync.${u.target}`, s = ((await store.control()).doc[k] ?? {}) as Lease; await store.setControl({ [k]: { ...s, cursor: r.cursor ?? undefined, since: r.since, lastHeal: r.lastHeal } }) }   // the cursor moves last, and not on a partial result
  for (const l of r.refused ?? []) h.log(`sync ${u.id}: ${l}`)
  return { stale }
}

// ---- one run of one unit ----
async function runUnit(h: Host, cfg: any, u: Unit, force: boolean, lim: typeof LIM): Promise<void> {
  const store = await storeOf(h), me = await sessionOf(h), s = u.target ? await lease(store, u.target, me, await h.now()) : {}; if (!s) return
  const root = await h.cwd(), file = u.a.repo?.module
  if (file && (await moduleBad(h, `${root}/.cadre/modules`, file))) return settle(h, u, 'offline', `adapter ${u.adapter}: ${file} is not a module of this repository's .cadre/modules`)
  const input = await inputOf(h, cfg, u, store, s, force)
  if (JSON.stringify(input).length > MAX_IN) return settle(h, u, 'offline', 'snapshot too large')
  const scratch = `${await wtRootOf(h, cfg)}/${repoKeyOf(root)}.scratch/sync-${h.rand(4)}`, plugin = await h.root?.()
  let res: Awaited<ReturnType<typeof modrun>>
  try { res = await modrun(h, { argv: ['node', `${plugin}/modules/sync.mjs`], cwd: root, input: { ...input, limits: { deadlineMs: lim.deadline, batch: lim.batch } }, scratch, envPass: u.a.envPass, credentialEnv: u.a.credentialEnv, timeoutMs: lim.wall }) } finally { await h.run(['rm', '-rf', scratch]) }
  const clean = !res.exit && !res.timedOut, r = res.result as any
  if (r === undefined || res.bad) return settle(h, u, 'offline', res.bad ?? (res.timedOut ? 'the sync module timed out' : 'the sync module gave no result'))
  if (u.target && !(await lease(store, u.target, me, await h.now(), true))) return settle(h, u, 'offline', 'lease lapsed while the module ran; its result was dropped')
  try {
    const { stale } = await applySync(h, u, clean ? r : { ...r, partial: true })   // a result left by a killed or failed run is applied as a partial one: what was pushed is recorded, the cursor stays
    await settle(h, u, clean ? r.state : 'offline', clean ? r.message : res.timedOut ? 'the sync module timed out' : `the sync module exited ${res.exit}`, r.retryAfterMs, stale)
  } catch (e) { await settle(h, u, 'offline', (e as Error).message) }
}

export async function syncTick(h: Host, force = false, lim = LIM): Promise<void> {
  const cfg = await cfgOf(h), us = unitsOf(cfg); if (!us.length) return
  const wake = !!(await h.ui.read()).syncWake; if (wake) await h.ui.update(({ syncWake: _w, ...x }) => x)
  const now = await h.now()
  for (const u of us) {
    if (INFLIGHT.has(u.id) || !(force || (wake && u.target) || now >= (await rtOf(h, u.id)).next)) continue
    INFLIGHT.add(u.id)
    try { await runUnit(h, cfg, u, force, lim) } catch (e) { await settle(h, u, 'offline', (e as Error).message) } finally { INFLIGHT.delete(u.id) }
  }
}

// ---- guided setup (11.3): `/cadre sync add <adapter>` runs the module's `add` mode; its proposal is held here and shown through the nonce gate; only the human's confirm writes ----
type Add = { n: number; d: Record<string, any>; pending?: { n: number; args: string[]; text: string; proposal: any } }
async function addStep(h: Host, cfg: any, name: string, st: Add, args: string[]): Promise<any> {
  const u: Unit = { id: `add:${name}`, kind: 'target', adapter: name, a: cfg.adapters[name], target: name }, store = await storeOf(h), root = await h.cwd()
  const input = { unit: u.id, kind: 'target', mode: 'add', now: await h.now(), adapter: await adapterOf(h, u), add: { name, step: st.n, d: st.d, args }, types: Object.keys(active().types),
    tasks: (await store.list({})).filter(t => t.category !== 'draft').map(t => ({ id: t.id, base: baseOf(t, name) })), journal: { head: (await store.events(undefined, 0))?.head } }
  const file = u.a.repo?.module; if (file && (await moduleBad(h, `${root}/.cadre/modules`, file))) return { message: `adapter ${name}: ${file} is not a module of this repository's .cadre/modules` }
  const scratch = `${await wtRootOf(h, cfg)}/${repoKeyOf(root)}.scratch/add-${h.rand(4)}`
  let res: Awaited<ReturnType<typeof modrun>>
  try { res = await modrun(h, { argv: ['node', `${await h.root?.()}/modules/sync.mjs`], cwd: root, input, scratch, envPass: u.a.envPass, credentialEnv: u.a.credentialEnv, timeoutMs: LIM.wall }) } finally { await h.run(['rm', '-rf', scratch]) }
  return res.result ?? { message: res.bad ?? 'the sync module gave no result' }
}
export async function syncAdd(h: Host, name: string, args: string[] = []): Promise<string> {
  const cfg = await cfgOf(h); if (!cfg.adapters[name]) return `sync add: no adapters.${name} in the user config (user level: {command, credentialEnv, grants})`
  const k = `sync.add:${name}`, st = ((await h.store.get(k)) as Add | undefined) ?? { n: 1, d: {} }
  try {
    if (args[0] === 'confirm') {
      const p = st.pending; if (!p) return 'sync add: nothing pending'
      if (!(await initConfirm(h, SYNC_ADD))) return 'sync add: nothing pending; run /cadre sync add again for a new diff'
      const { set = {}, ops = [], cursor, d = {} } = p.proposal
      if (!obj(set) || Object.keys(set).some(x => !SYNC_KEYS.includes(x))) return 'sync add: the proposal names a key outside the sync target; nothing written'
      // order: check (a task edited since the proposal refuses it, nothing written) -> the config -> the ops. A failed config write leaves nothing imported, so a re-run cannot import twice
      const res = { state: 'ok', ops, cursor, lastHeal: 0 }, au: Unit = { id: `add:${name}`, kind: 'target', adapter: name, a: cfg.adapters[name], target: name }
      await applySync(h, au, res, true)
      const w = await writeRepoConfig(h, cur => { cur.sync ??= {}; cur.sync[name] = { adapter: name, ...cur.sync[name], ...set }; return cur }); if (!w.ok) return `sync add: ${w.why}`
      if ((await applySync(h, au, res)).stale) return `sync add: a task changed during the confirm, so its part was not written; run /cadre sync add ${name} again`
      st.d = { ...st.d, ...d }; st.n = p.n + 1; delete st.pending; await h.store.set(k, st)
      return st.n > 5 ? (await h.store.del(k), `sync add ${name}: done. Syncing starts on the next tick (/cadre sync now).`) : `sync add ${name}: step ${p.n}/5 done. Next: /cadre sync add ${name}`
    }
    for (let i = 0; i < 5; i++) {   // a step with nothing to write (the validation) goes on by itself
      const r = await addStep(h, cfg, name, st, args), p = r.proposal
      if (!p) { await h.store.set(k, st); return String(r.message ?? 'sync add: the module gave no proposal') }
      if (p.lines.length) {
        const text = p.lines.join('\n'); st.pending = { n: st.n, args, text, proposal: p }; await h.store.set(k, st)
        await initPropose(h, SYNC_ADD, text, { title: `sync add ${name} diff ready · confirm it`, short: `sync add ${name} ready`, sub: `sync add ${name}`, lines: [`sync add ${name}: proposed changes`, ...p.lines.slice(0, 14).map((x: string) => `  ${x}`)] })
        return `sync add ${name} step ${st.n}/5: proposed changes\n${text}\n\nConfirm with the code shown in the cadre band: /cadre sync add ${name} confirm <code>`
      }
      st.n++; args = []
    }
  } catch (e) { return `sync add ${name}: ${(e as Error).message}` }
  return `sync add ${name}: no step to run`
}

ROUTES.sync = async (h, c) => {
  if (c.args[0] === 'add') return { text: await syncAdd(h, c.args[1] ?? '', c.args.slice(2)) }
  if (c.args[0] === 'now') await syncTick(h, true)
  const s = (await h.board.read()).sync
  return { text: s.length ? s.map(x => `${x.target}: ${x.state}${x.pending ? ` (${x.pending} pending)` : ''}`).join('\n') : 'no sync targets (/cadre sync add <adapter>)' }
}
