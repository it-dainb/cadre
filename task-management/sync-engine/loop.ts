// Sync tick (DESIGN 11.4), level-triggered and state-based. Called from the one $.clock.every(5000): only the store + adapter processes + $.state, never a submit.
// Per target: lease + cursor (a journal seq) in the store's control doc, CAS per field; pull -> merge -> push by hash, heal every 15 min, backoff 30 s -> 5 min.
// Event-only adapters (`deliver`) ride the same tick; commands they return are refused (ADR 0012).
import { active } from '../../core/pipeline'
import type { Host } from '../../types'
import { canon, fnv1a64, modelView } from '../../core/board'
import { emit, ofEpic, subscribe } from '../../core/events'
import { ROUTES, cfgOf, initConfirm, initPropose, storeOf } from '../../core/dispatch'
import { sessionOf } from '../../core/board'
import { repoKeyOf, wire } from '../../commands/init'
import { AdapterError, call } from '../protocol'
import type { AdapterCfg } from '../protocol'
import { StoreError } from '../store'
import type { TaskStore } from '../store'
import { reconcile, flag } from './reconcile'
import type { Ctx } from './reconcile'

const HEAL = 15 * 60_000, LEASE = 90_000, EVERY = 30_000, MAX_BACKOFF = 300_000
type RT = { next: number; backoff: number }
type State = { cursor?: string; since?: string; lastHeal?: number; lease?: { session: string; until: number } }

subscribe((h, ev) => { if (ev.type === 'task.transitioned') return h.ui.update(u => ({ ...u, syncWake: 1 })) })   // sync wake (11.4 step 5)

// ---- lease: the control doc's `sync.<target>` field; a live lease of another session loses, a race on that field loses (other fields move freely) ----
async function lease(store: TaskStore, target: string, session: string, now: number): Promise<State | null> {
  const k = `sync.${target}`, c = await store.control(), s = (c.doc[k] ?? {}) as State
  if (s.lease && s.lease.until > now && s.lease.session !== session) return null
  try { return (await store.setControl({ [k]: { ...s, lease: { session, until: now + LEASE } } }, { [k]: c.doc[k] })).doc[k] as State } catch (e) { if (e instanceof StoreError && e.code === 'GuardMismatch') return null; throw e }
}

// ---- backoff ----
const rtOf = async (h: Host, k: string) => ((await h.store.get(k)) as RT | undefined) ?? { next: 0, backoff: 0 }
async function failed(h: Host, k: string, now: number, e: unknown): Promise<'offline' | 'auth' | 'conflict'> {
  const code = e instanceof AdapterError ? e.code : '', rt = await rtOf(h, k)
  const backoff = code === 'Auth' ? MAX_BACKOFF : Math.min(MAX_BACKOFF, Math.max(EVERY, rt.backoff * 2))
  await h.store.set(k, { next: now + (e instanceof AdapterError && e.retryAfterMs ? e.retryAfterMs : backoff), backoff }); h.log(`sync: ${(e as Error).message}`)
  return code === 'Auth' ? 'auth' : code === 'Conflict' ? 'conflict' : 'offline'
}

const SYNC_ADD = 9   // its own confirm stage: init's stage 8 (sync) must not accept a sync-add code, nor the reverse
export async function setState(h: Host, target: string, state: 'ok' | 'offline' | 'conflict' | 'auth', pending: number): Promise<void> {
  const at = await h.now(); let was: string | undefined, conflicts = 0
  await h.board.update(s => { was = s.sync.find(x => x.target === target)?.state; conflicts = s.tasks.filter(t => t.flags.some(f => f === 'external' || f.startsWith('drift'))).length; return { ...s, sync: [...s.sync.filter(x => x.target !== target), { target, state, pending, at }] } })
  if (was !== state && !(was === undefined && state === 'ok')) await emit(h, 'sync.state_changed', { target, state, at, ...(pending ? { pending } : {}), ...(conflicts ? { conflicts } : {}) }, { severity: state === 'ok' ? 'info' : 'warn' })
}

async function cycle(h: Host, cfg: any, target: string, store: TaskStore, force: boolean): Promise<boolean> {
  const t = cfg.sync[target], a = cfg.adapters[t.adapter] as AdapterCfg, now = await h.now(), actor = String((await h.store.get(`cadre:${repoKeyOf(await h.cwd())}:actor`)) ?? 'cadre/sync')
  const s = await lease(store, target, await sessionOf(h), now); if (!s) return false
  const prevOk = (await h.board.read()).sync.find(x => x.target === target)?.state ?? 'ok'
  let heal = force || !s.cursor || now - (s.lastHeal ?? 0) >= HEAL || prevOk !== 'ok', head = s.cursor, ids = new Set<string>()
  const ev = await store.events(s.cursor, 500).catch(e => { if (e instanceof StoreError && e.code === 'TooOld') return undefined; throw e })   // folded past the cursor: heal from the head
  if (ev === undefined) { heal = true; head = (await store.events(undefined, 0))?.head }
  if (!ev) heal = true; else {
    head = ev.events.length >= 500 ? ev.events[ev.events.length - 1].seq : ev.head
    // journal entries: op + the task's status/assignee after it; a status/assignee change shows only as a difference from the previous entry of that task
    const seenK = `sync.seen:${target}`, seen = ((await h.store.get(seenK)) as Record<string, string> | undefined) ?? {}
    for (const e of ev.events) {
      const now2 = `${e.status ?? ''}|${e.assignee ?? ''}`, moved = e.id in seen && seen[e.id] !== now2; seen[e.id] = now2
      if (e.actor?.endsWith('+sync')) continue
      ids.add(e.id)
      if (moved && e.actor && e.actor !== actor && e.actor !== 'mod' && !e.actor.startsWith('cadre/')) await flag(h, e.id, 'external')   // 11.4.6: status/assignee by a foreign actor only
    }
    await h.store.set(seenK, seen)
  }
  const live = () => store.list({})
  const c: Ctx = { h, store, name: t.adapter, a, target, t, actor, first: Object.keys(cfg.sync)[0] === target }
  const r = await reconcile(c, live, s.since, t.direction ?? 'both', async () => heal ? live() : (await Promise.all([...ids].map(i => store.get(i).catch(() => null)))).filter((x): x is NonNullable<typeof x> => !!x))
  // crash between the push and this write only replays idempotent pushes (the cursor moves last)
  await store.setControl({ [`sync.${target}`]: { cursor: head, since: r.next ?? new Date(now - 120_000).toISOString(), lastHeal: r.deferred ? 0 : heal ? now : s.lastHeal,   // a deferred decision (its task not on the tracker yet) forces a heal next tick
    lease: { session: s.lease!.session, until: now + LEASE } } })
  return true
}

// ---- deliver (events grant): adapters get the view and the events; they can decide nothing (ADR 0012) ----
// after a ring rebuild (rehydrate): every adapter gets reset:true + a snapshot on its next deliver (2.5)
export async function resetDelivery(h: Host): Promise<void> { for (const n of Object.keys((await cfgOf(h)).adapters)) { const k = `deliver:${n}`, st = await h.store.get(k); if (st) await h.store.set(k, { ...(st as object), init: false }) } }
export async function deliver(h: Host, name: string, a: AdapterCfg, force = false): Promise<{ sent: boolean; results: string[] }> {
  const k = `deliver:${name}`, st = ((await h.store.get(k)) as { acked: number; epic?: string; hash?: string; sub?: string[] | null; init?: boolean } | undefined) ?? { acked: 0 }
  const ring = await h.events.read(), b = await h.board.read(), evs = ofEpic(ring, b.epic ?? '')
  if (st.sub === undefined) st.sub = (await call(h, name, a, 'describe')).subscribe ?? null
  const view = modelView(b), hash = fnv1a64(canon(view))
  const have = st.acked === 0 || evs.some(e => e.seq === st.acked), reset = !st.init || st.epic !== (b.epic ?? '') || st.acked > ring.seq || !have && evs.length > 0 && evs[0].seq > st.acked
  const fresh = (reset ? evs : evs.filter(e => e.seq > st.acked)), sub = st.sub
  if (!force && !reset && !fresh.length && hash === st.hash) return { sent: false, results: [] }
  const top = evs.length ? Math.max(...evs.map(e => e.seq)) : st.acked
  const sent = fresh.filter(e => !sub || sub.includes(e.type))
  const res = await call(h, name, a, 'deliver', { events: sent, snapshot: view, ...(reset ? { reset: true } : {}) })
  if (typeof res?.ack !== 'number') throw new AdapterError('Invalid', `adapter ${name}: deliver must return {ack: seq}`)
  await h.store.set(k, { acked: sent.length ? Math.min(res.ack, top) : top, epic: b.epic ?? '', hash, sub, init: true })
  const results = Array.isArray(res.commands) && res.commands.length ? [`refused: adapter ${name} cannot send commands; decisions are buttons in the pane`] : []   // ADR 0012
  return { sent: true, results }
}

export const tick = async (h: Host, force = false): Promise<void> => {
  const cfg = await cfgOf(h), targets = Object.keys(cfg.sync ?? {}), adapters = Object.entries(cfg.adapters ?? {}) as [string, AdapterCfg][]
  if (!targets.length && !adapters.some(([, a]) => a.grants?.includes('events'))) return
  const wake = !!(await h.ui.read()).syncWake; if (wake) await h.ui.update(({ syncWake: _w, ...u }) => u)
  const now = await h.now()
  for (const target of targets) {
    const a = cfg.adapters[cfg.sync[target]?.adapter] as AdapterCfg | undefined, rk = `sync.rt:${target}`
    if (!a?.grants?.includes('sync') || cfg.sync[target].direction === 'off') continue
    if (!force && !wake && now < (await rtOf(h, rk)).next) continue
    try {
      if (await cycle(h, cfg, target, await storeOf(h), force)) { await h.store.set(rk, { next: now + EVERY, backoff: 0 }); await setState(h, target, 'ok', 0) }
    } catch (e) { await setState(h, target, await failed(h, rk, now, e), 0) }
  }
  for (const [name, a] of adapters) {
    if (!a.grants?.includes('events')) continue
    const rk = `deliver.rt:${name}`; if (!force && now < (await rtOf(h, rk)).next) continue
    try { await deliver(h, name, a, force); await h.store.set(rk, { next: 0, backoff: 0 }) } catch (e) { await failed(h, rk, now, e) }
  }
}

// ---- guided setup (11.3): 5 steps, each a confirmed diff; never creates a remote project ----
type Step = { msg: string } | { lines: string[]; apply(): Promise<void> }
const CATS: Record<string, string[]> = { todo: ['todo', 'new', 'open', 'backlog'], active: ['in progress', 'active', 'doing', 'started'], review: ['in review', 'review'], blocked: ['blocked', 'on hold'], done: ['done', 'closed', 'resolved'], cancelled: ['cancelled', 'canceled', 'rejected', 'wontfix', 'closed'] }
const kv = (args: string[]) => Object.fromEntries(args.filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
async function patchCfg(h: Host, path: string, fn: (j: any) => void): Promise<void> {
  const old = await h.readText(path); let j: any = {}; try { j = old ? JSON.parse(old) : {} } catch { /* replace an unreadable file only after the .bak below */ }
  fn(j); if (old !== null) await h.write(`${path}.bak`, old); await h.write(path, JSON.stringify(j, null, 2) + '\n')
}
async function stepOf(h: Host, n: number, name: string, a: AdapterCfg, d: Record<string, any>, args: string[]): Promise<Step> {
  const o = kv(args), cfgP = `${await h.cwd()}/.cadre/config.json`, set = (f: (x: any) => void) => patchCfg(h, cfgP, j => { j.sync ??= {}; j.sync[name] ??= { adapter: name }; f(j.sync[name]) })
  const cfg = await cfgOf(h)
  if (n === 1) {
    const url = o.url ?? d.url; if (!url) return { msg: `sync add ${name} 1/5 connection: give the tracker URL: /cadre sync add ${name} url=<URL>` }
    await call(h, name, a, 'ping'); await call(h, name, a, 'validateAccess', { stage: 'auth', url })
    return { lines: [`+ .cadre/config.json: sync.${name} = {adapter: "${name}", url: "${url}"}`, `+ credential: environment variable ${a.credentialEnv ?? '(none)'} is set (name only; the value is never stored)`], apply: async () => { d.url = url; await set(x => { x.url = url }) } }
  }
  if (n === 2) {
    const ps: { id: string; name: string }[] = await call(h, name, a, 'listProjects', { url: d.url }), id = o.project ?? d.project
    if (!id || !ps.some(p => p.id === id)) return { msg: `sync add ${name} 2/5 project: the project must already exist (cadre never creates remote projects). Accessible: ${ps.map(p => `${p.id} (${p.name})`).join(', ') || 'none'}\nmap one: /cadre sync add ${name} project=<id>` }
    return { lines: [`+ .cadre/config.json: sync.${name}.project = "${id}"`], apply: async () => { d.project = id; await set(x => { x.project = id }) } }
  }
  if (n === 3) {
    const sc = await call(h, name, a, 'describeSchema', { url: d.url, project: d.project }), types = Object.keys(active().types), over = kv(args.filter(x => x.startsWith('map.')).map(x => x.slice(4)))
    const low = (sc.statuses as string[]).map(s => [s.toLowerCase(), s]), m: any = { type: {}, status: {}, priority: {} }, miss: string[] = []
    for (const t of types) m.type[t] = over[`type.${t}`] ?? (sc.trackers as string[]).find(x => x.toLowerCase() === t) ?? sc.trackers[0]
    for (const [c, names] of Object.entries(CATS)) { const hit = over[`status.${c}`] ?? low.find(([l]) => names.includes(l))?.[1]; if (hit) m.status[c] = hit; else miss.push(c) }
    const pr = sc.priorities as string[]; for (let p = 0; p <= 4; p++) m.priority[p] = pr[Math.min(pr.length - 1, Math.round(p * (pr.length - 1) / 4))]
    if (sc.versions?.length) m.mission = over.mission ?? sc.versions[0]
    const req = (sc.customFields ?? []).filter((f: any) => f.required && f.default === undefined && !(f.name in o))
    if (miss.length || req.length) return { msg: `sync add ${name} 3/5 mapping: blocked.${miss.length ? ` No allowed status for: ${miss.join(', ')} (statuses: ${sc.statuses.join(', ')}); give map.status.<category>=<status>.` : ''}${req.length ? ` Required custom fields without a default: ${req.map((f: any) => f.name).join(', ')}.` : ''}` }
    if (sc.customFields?.length) m.fields = Object.fromEntries(sc.customFields.filter((f: any) => f.required).map((f: any) => [f.name, f.default ?? o[f.name]]))
    return { lines: [`+ .cadre/config.json: sync.${name}.mapping =`, ...Object.entries(m).filter(([, v]) => v && Object.keys(v as object).length).map(([k, v]) => `    ${k}: ${canon(v)}`)], apply: async () => { d.mapping = m; await set(x => { x.mapping = m }) } }
  }
  if (n === 4) {
    const v = await call(h, name, a, 'validateAccess', { url: d.url, project: d.project, mapping: d.mapping }), bad = [...(v?.auth ? [] : ['auth']), ...['view', 'add', 'edit'].filter(p => !v?.perms?.[p]).map(p => `no ${p} permission`), ...(v?.missing ?? []).map((x: string) => `missing ${x}`)]
    return bad.length ? { msg: `sync add ${name} 4/5 validate: blocked: ${bad.join('; ')} (no writes were made)` } : { lines: [], apply: async () => {} }
  }
  const mode = o.direction ?? d.mode; if (!['push', 'import', 'empty'].includes(mode)) return { msg: `sync add ${name} 5/5 initial direction: /cadre sync add ${name} direction=push|import|empty\n  push: send local tasks · import: remote tasks become backlog drafts · empty: start empty (existing tasks stay local)` }
  return { lines: [`+ .cadre/config.json: sync.${name}.direction = "both"`, `+ sync cursor init (${mode})`], apply: async () => {
    const store = await storeOf(h), actor = `cadre/${name}+sync`
    let cursor: string | undefined
    if (mode === 'empty') { for (const t of await store.list({})) if (t.category !== 'draft') await store.setMeta(t.id, { [`cadre.sync.${name}`]: JSON.stringify({ l: {}, r: {}, skip: 1 }) }, actor); cursor = (await store.events(undefined, 0))?.head }
    if (mode === 'import') {
      const b = await h.board.read(), parent = b.mission ?? b.epic ?? await store.createEpic('backlog', 'imported from ' + name), res = await call(h, name, a, 'pull', { project: d.project })
      for (const r of res.tasks ?? []) { const t = await store.createDraft({ title: String(r.fields?.title ?? r.rid), description: String(r.fields?.description ?? ''), type: Object.keys(active().types)[0], parent }); await store.setMeta(t.id, { [`cadre.sync.${name}`]: JSON.stringify({ rid: r.rid, etag: r.etag, l: {}, r: {} }) }, actor) }
    }
    await store.setControl({ [`sync.${name}`]: { cursor, lastHeal: 0 } }); await set(x => { x.direction = 'both' })
  } }
}
export async function syncAdd(h: Host, name: string, args: string[] = []): Promise<string> {
  const a = ((await cfgOf(h)).adapters as Record<string, AdapterCfg>)[name]
  if (!a) return `sync add: no adapters.${name} in ~/.claude/cadre.json (user level: {command, credentialEnv, grants})`
  const k = `sync.add:${name}`, st = ((await h.store.get(k)) as { n: number; d: Record<string, any>; pending?: { n: number; args: string[]; text: string } } | undefined) ?? { n: 1, d: {} }
  try {
    if (args[0] === 'confirm') {
      const p = st.pending; if (!p) return 'sync add: nothing pending'
      if (!(await initConfirm(h, SYNC_ADD))) return 'sync add: nothing pending; run /cadre sync add again for a new diff'
      const s = await stepOf(h, p.n, name, a, st.d, p.args)
      if (!('lines' in s) || s.lines.join('\n') !== p.text) return 'sync add: the remote state changed since the diff was shown; nothing written; run /cadre sync add again'
      await s.apply(); st.n = p.n + 1; delete st.pending; await h.store.set(k, st)
      return st.n > 5 ? (await h.store.del(k), `sync add ${name}: done. Syncing starts on the next tick (/cadre sync now).`) : `sync add ${name}: step ${p.n}/5 done. Next: /cadre sync add ${name}`
    }
    const s = await stepOf(h, st.n, name, a, st.d, args)
    if ('msg' in s) { await h.store.set(k, st); return s.msg }
    if (!s.lines.length) { await s.apply(); st.n++; await h.store.set(k, st); return syncAdd(h, name, []) }
    const text = s.lines.join('\n'); st.pending = { n: st.n, args, text }; await h.store.set(k, st); await initPropose(h, SYNC_ADD, text, { title: `sync add ${name} diff ready · confirm it`, short: `sync add ${name} ready`, sub: `sync add ${name}`, lines: [`sync add ${name}: proposed changes`, ...s.lines.slice(0, 14).map(x => `  ${x}`)] })
    return `sync add ${name} step ${st.n}/5: proposed changes\n${text}\n\nConfirm with the code shown in the cadre band: /cadre sync add ${name} confirm <code>`
  } catch (e) { return `sync add ${name}: ${e instanceof AdapterError ? `${e.code}: ` : ''}${(e as Error).message}` }
}

ROUTES.sync = async (h, c) => {
  if (c.args[0] === 'add') return { text: await syncAdd(h, c.args[1] ?? '', c.args.slice(2)) }
  if (c.args[0] === 'now') await tick(h, true)
  const s = (await h.board.read()).sync
  return { text: s.length ? s.map(x => `${x.target}: ${x.state}${x.pending ? ` (${x.pending} pending)` : ''}`).join('\n') : 'no sync targets (/cadre sync add <adapter>)' }
}
