// The sync module (plan 2.15, D17): `node sync.mjs`, one run per due unit, started by core/syncrun through core/modrun. It is stateless: core hands it the cursor, the module's own blob,
// the tasks, the journal (or the model view for an events adapter) in CADRE_INPUT, and reads one validated result back from CADRE_RESULT. It spawns the adapter (the cadre-adapter stdio
// protocol, docs/protocol.md) and holds the adapter's credential only to pass it on. It stops starting adapter exchanges after its deadline and rewrites the result after every completed push
// batch, so a kill leaves the last complete batch. No regex here.
import { spawnSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(process.env.CADRE_INPUT, 'utf8')), T0 = Date.now(), A = input.adapter, L = input.limits ?? {}, DEADLINE = L.deadlineMs ?? 45_000, BATCH = L.batch ?? 25
const publish = r => { writeFileSync(`${process.env.CADRE_RESULT}.tmp`, JSON.stringify(r)); renameSync(`${process.env.CADRE_RESULT}.tmp`, process.env.CADRE_RESULT) }
const late = () => Date.now() - T0 > DEADLINE

// ---- the adapter client: one spawn per request, stdin closed after it; the adapter gets the allowlist plus its own credential and envPass names ----
const CODES = ['Offline', 'Auth', 'RateLimited', 'Conflict', 'NotFound', 'Invalid', 'Unsupported']
const NEEDS = { ping: null, describe: null, describeSchema: 'sync', listProjects: 'sync', validateAccess: 'sync', push: 'sync', pull: 'sync', deliver: 'events' }
class AdapterError extends Error { constructor(code, message = code, retryAfterMs) { super(message); this.code = code; this.retryAfterMs = retryAfterMs } }
const aenv = () => Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR', ...(A.envPass ?? []), ...(A.credentialEnv ? [A.credentialEnv] : [])].filter(n => process.env[n] !== undefined).map(n => [n, process.env[n]]))
function call(method, params = {}) {
  if (!(method in NEEDS)) throw new AdapterError('Unsupported', `unknown method ${method}`)
  const need = NEEDS[method]; if (need && !A.grants?.includes(need)) throw new AdapterError('Unsupported', `adapter ${A.name} lacks the ${need} grant`)
  if (!Array.isArray(A.argv) || !A.argv.length) throw new AdapterError('Invalid', `adapter ${A.name} has no command`)
  if (A.credentialEnv && !process.env[A.credentialEnv]) throw new AdapterError('Auth', `environment variable ${A.credentialEnv} is not set`)
  const r = spawnSync(A.argv[0], A.argv.slice(1), { input: JSON.stringify({ protocol: 'cadre-adapter', v: 1, method, params }), env: aenv(), encoding: 'utf8', timeout: 30_000, maxBuffer: 1 << 26 })
  if (r.error) throw new AdapterError('Offline', `adapter ${A.name}: ${r.error.message}`)
  let m; try { m = JSON.parse(r.stdout) } catch { throw new AdapterError(r.status ? 'Offline' : 'Invalid', `adapter ${A.name}: ${r.status ? `exit ${r.status}` : 'reply is not JSON'} ${r.stderr.slice(0, 200)}`.trim()) }
  if (!m || m.v !== 1 || typeof m.ok !== 'boolean') throw new AdapterError('Invalid', `adapter ${A.name}: unsupported protocol version ${m?.v}`)
  if (!m.ok) { const e = m.error ?? {}; throw new AdapterError(CODES.includes(e.code) ? e.code : 'Invalid', String(e.message ?? e.code ?? 'error'), typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined) }
  return m.result
}
const failed = (e, extra = {}) => ({ state: e.code === 'Auth' ? 'auth' : e.code === 'Conflict' ? 'conflict' : 'offline', message: e.message, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}), ...extra })

// ---- 3-way merge (DESIGN 11.4 step 3), pure. Per field: `l`/`r` = hash of the local/remote value at the last sync. The local side wins a conflict. ----
function fnv1a64(s) {
  let h = 0xcbf29ce484222325n
  for (const b of new TextEncoder().encode(s)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}
const HUMAN = ['title', 'description', 'acceptance', 'priority']   // pulled; everything else is push-only (status: a remote change is drift)
const hash = v => fnv1a64(String(v ?? ''))
function merge(local, remote, base) {
  const conflict = [], pull = {}, l = { ...base.l }, r = { ...base.r }; let drift = false
  for (const f of Object.keys(local)) {
    const lh = hash(local[f]), lc = lh !== base.l[f], rv = remote[f], rh = rv === undefined ? base.r[f] : hash(rv), rc = rv !== undefined && rh !== base.r[f]
    if (!HUMAN.includes(f)) { if (f === 'status' && rc && rh !== lh) { drift = true; r[f] = rh; delete l[f] } continue }
    if (rc && rh === lh) { l[f] = r[f] = lh } else if (rc && lc) { conflict.push(f); r[f] = rh } else if (rc) { pull[f] = rv; l[f] = r[f] = rh }
  }
  return { pull, conflict, drift, next: { l, r } }
}

// ---- one target's cycle: journal scan, pull -> merge, push by hash ----
const KEY = `cadre.sync.${input.target?.name ?? input.add?.name}`
const parseMeta = s => { try { return { l: {}, r: {}, ...JSON.parse(s) } } catch { return { l: {}, r: {} } } }
const recordKind = t => t.type === 'milestone' ? 'version' : t.type === 'decision' ? 'comment' : undefined
function cycle() {
  const t = input.target, dir = t.direction ?? 'both', mapping = t.mapping ?? {}, now = input.now, st = input.state ?? {}, j = input.journal ?? {}, url = t.url ? { url: t.url } : {}
  const W = new Map(input.tasks.map(x => [x.id, { ...x, m: parseMeta(x.meta[KEY]) }])), ops = [], metas = new Map(), notes = new Map(), touched = new Set(), ids = new Set(), seen = { ...(input.modState?.seen ?? {}) }
  const metaOps = () => [...metas].map(([id, m]) => ({ op: 'meta', id, key: KEY, value: JSON.stringify(m), base: W.get(id).base }))
  const snap = () => [...ops, ...metaOps()]
  const fieldsOf = w => recordKind(w) ? { title: w.title, description: w.description }
    : { title: w.title, description: w.description, acceptance: w.acceptance ?? '', priority: String(mapping.priority?.[w.priority] ?? w.priority), status: String(mapping.status?.[w.category] ?? w.category), type: String(mapping.type?.[w.type] ?? w.type) }
  const unprio = v => { const e = Object.entries(mapping.priority ?? {}).find(([, x]) => x === v), n = e ? Number(e[0]) : Number(v); return Number.isInteger(n) && n >= 0 && n <= 4 ? n : undefined }
  const flag = (id, f) => ops.push({ op: 'flag', id, flag: f, base: W.get(id).base })
  let heal = !!input.force || !st.cursor || now - (st.lastHeal ?? 0) >= 15 * 60_000 || !input.wasOk, head = st.cursor, deferred = 0, next
  const stop = (extra = {}) => ({ state: 'ok', partial: true, message: 'stopped at the deadline; the rest follows next cycle', ops: snap(), ...extra })
  try {
    if (j.tooOld) { heal = true; head = j.head }
    if (!j.events) heal = true; else {   // journal entries: op + the task's status/assignee after it; a status/assignee change shows only as a difference from the previous entry of that task
      head = j.events.length >= 500 ? j.events[j.events.length - 1].seq : j.head
      for (const e of j.events) {
        const cur = `${e.status ?? ''}|${e.assignee ?? ''}`, moved = e.id in seen && seen[e.id] !== cur; seen[e.id] = cur
        if (e.actor?.endsWith('+sync')) continue
        ids.add(e.id)
        if (moved && W.has(e.id) && e.actor && e.actor !== input.self && e.actor !== 'mod' && !e.actor.startsWith('cadre/')) flag(e.id, 'external')   // 11.4.6: status/assignee by a foreign actor only
      }
    }
    if (dir !== 'push') {
      if (late()) return stop()
      const res = call('pull', { project: t.project, since: st.since, ...url }); next = res.next
      for (const rt of res.tasks ?? []) {
        const w = W.get(rt.localId) ?? [...W.values()].find(x => x.m.rid === rt.rid); if (!w || recordKind(w)) continue
        if (rt.etag && rt.etag === w.m.etag) continue   // dedupe: seen
        const r = merge(fieldsOf(w), rt.fields ?? {}, w.m), keys = Object.keys(r.pull)
        if (keys.length) {
          const patch = { ...r.pull }; if ('priority' in patch) { const p = unprio(patch.priority); if (p === undefined) delete patch.priority; else patch.priority = p }
          ops.push({ op: 'edit', id: w.id, fields: patch, base: w.base }); flag(w.id, 'edited'); Object.assign(w, patch)
        }
        for (const f of r.conflict) { const v = f === 'priority' ? unprio(rt.fields[f]) : rt.fields[f]; if (v !== undefined) ops.push({ op: 'meta', id: w.id, key: `cadre.remote.${f}`, value: String(v), base: w.base }) }   // kept so `/cadre resolve <id> accept` can re-apply it
        if (r.drift) { const sm = Object.entries(mapping.status ?? {}).find(([, x]) => x === rt.fields.status)?.[0]; ops.push({ op: 'meta', id: w.id, key: 'cadre.remote.status', value: sm ?? String(rt.fields.status), base: w.base }) }
        if (r.conflict.length) { notes.set(w.id, `cadre: ${r.conflict.join(', ')} changed on both sides; the local value was kept`); flag(w.id, 'conflict') }
        if (r.drift) flag(w.id, 'drift')
        if (r.conflict.length || r.drift) touched.add(w.id)   // the pull's own writes are +sync (skipped by the journal scan): push these back this cycle
        w.m = { ...w.m, rid: rt.rid, etag: rt.etag, ...r.next }; metas.set(w.id, w.m)
      }
    }
    if (dir !== 'pull') {
      const set = heal ? [...W.values()] : [...new Set([...ids, ...touched])].map(i => W.get(i)).filter(Boolean), items = []
      for (const w of set) {
        if (w.m.skip || w.type === 'gate') continue
        const fields = fieldsOf(w), changed = Object.keys(fields).filter(f => hash(fields[f]) !== w.m.l[f]), rk = recordKind(w); let on
        if (rk === 'comment') { const lt = w.link && W.get(w.link); on = lt ? lt.m.rid : undefined; if (!on) { deferred++; continue } }   // the linked task is not on the tracker yet: next cycle
        if (changed.length || !w.m.rid) items.push({ w, fields, changed, rk, on })
      }
      for (let i = 0; i < items.length; i += BATCH) {
        if (late()) return stop()
        const batch = items.slice(i, i + BATCH)
        const res = call('push', { project: t.project, ...url, tasks: batch.map(x => ({ localId: x.w.id, rid: x.w.m.rid, etag: x.w.m.etag, changed: x.changed, fields: x.fields, ...(notes.has(x.w.id) ? { note: notes.get(x.w.id) } : {}), ...(x.rk ? { kind: x.rk, ...(x.on ? { on: x.on } : {}) } : {}) })) })
        for (const r of res.results) {
          const x = batch.find(b => b.w.id === r.localId); if (!x) continue
          const hs = Object.fromEntries(Object.entries(x.fields).map(([f, v]) => [f, hash(v)]))
          x.w.m = { rid: r.rid, etag: r.etag, l: hs, r: { ...x.w.m.r, ...Object.fromEntries(x.changed.map(f => [f, hs[f]])) } }; metas.set(x.w.id, x.w.m)
          if (input.first && !x.w.externalRef) ops.push({ op: 'ref', id: x.w.id, ref: `${t.name}:${r.rid}`, base: x.w.base })
        }
        if (i + BATCH < items.length) publish({ state: 'offline', message: 'stopped before the end of the run', partial: true, ops: snap() })   // a kill after this leaves the batch just done
      }
    }
  } catch (e) { if (e instanceof AdapterError) return failed(e, { partial: true, ops: snap() }); throw e }
  return { state: 'ok', cursor: head, since: next ?? new Date(now - 120_000).toISOString(), lastHeal: deferred ? 0 : heal ? now : st.lastHeal, modState: { seen: Object.fromEntries(Object.entries(seen).filter(([id]) => W.has(id))) }, ops: snap() }
}

// ---- deliver (events grant): adapters get the view and the events; they can decide nothing (ADR 0012) ----
function deliver() {
  const k = input.events, st = input.modState ?? { acked: 0 }, evs = k.events
  try {
    if (st.sub === undefined) st.sub = call('describe').subscribe ?? null
    const have = st.acked === 0 || evs.some(e => e.seq === st.acked), reset = !st.init || st.epic !== k.epic || st.acked > k.seq || (!have && evs.length > 0 && evs[0].seq > st.acked)
    const fresh = reset ? evs : evs.filter(e => e.seq > st.acked), top = evs.length ? Math.max(...evs.map(e => e.seq)) : st.acked
    if (!input.force && !reset && !fresh.length && k.hash === st.hash) return { state: 'ok', modState: st }
    const sent = fresh.filter(e => !st.sub || st.sub.includes(e.type)), res = call('deliver', { events: sent, snapshot: k.snapshot, ...(reset ? { reset: true } : {}) })
    if (typeof res?.ack !== 'number') throw new AdapterError('Invalid', `adapter ${A.name}: deliver must return {ack: seq}`)
    return { state: 'ok', modState: { acked: sent.length ? Math.min(res.ack, top) : top, epic: k.epic, hash: k.hash, sub: st.sub, init: true },
      ...(Array.isArray(res.commands) && res.commands.length ? { refused: [`refused: adapter ${A.name} cannot send commands; decisions are buttons in the pane`] } : {}) }   // ADR 0012
  } catch (e) { if (e instanceof AdapterError) return failed(e); throw e }
}

// ---- guided setup (11.3): 5 steps; each answers a message or a proposal core shows as a confirmed diff. Never creates a remote project, never writes before the confirm. ----
const CATS = { todo: ['todo', 'new', 'open', 'backlog'], active: ['in progress', 'active', 'doing', 'started'], review: ['in review', 'review'], blocked: ['blocked', 'on hold'], done: ['done', 'closed', 'resolved'], cancelled: ['cancelled', 'canceled', 'rejected', 'wontfix', 'closed'] }
const kv = args => Object.fromEntries(args.filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
function add() {
  const { name, step: n, d, args } = input.add, o = kv(args), pin = A.url, rest = `sync add ${name}`
  const msg = message => ({ state: 'ok', message }), prop = (lines, extra = {}) => ({ state: 'ok', proposal: { lines, ...extra } })
  try {
    if (n === 1) {
      const url = pin ?? o.url ?? d.url; if (!url) return msg(`${rest} 1/5 connection: give the tracker URL: /cadre ${rest} url=<URL>`)
      if (pin && o.url && o.url !== pin) return msg(`${rest} 1/5 connection: the user's adapters.${name}.url pins the tracker URL to ${pin}`)
      call('ping'); call('validateAccess', { stage: 'auth', url })
      return prop([`+ .cadre/config.json: sync.${name} = {adapter: "${name}", url: "${url}"}`, `+ credential: environment variable ${A.credentialEnv ?? '(none)'} is set (name only; the value is never stored)`], { set: { url }, d: { url } })
    }
    if (n === 2) {
      const ps = call('listProjects', { url: d.url }), id = o.project ?? d.project
      if (!id || !ps.some(p => p.id === id)) return msg(`${rest} 2/5 project: the project must already exist (cadre never creates remote projects). Accessible: ${ps.map(p => `${p.id} (${p.name})`).join(', ') || 'none'}\nmap one: /cadre ${rest} project=<id>`)
      return prop([`+ .cadre/config.json: sync.${name}.project = "${id}"`], { set: { project: id }, d: { project: id } })
    }
    if (n === 3) {
      const sc = call('describeSchema', { url: d.url, project: d.project }), over = kv(args.filter(x => x.startsWith('map.')).map(x => x.slice(4)))
      const low = sc.statuses.map(s => [s.toLowerCase(), s]), m = { type: {}, status: {}, priority: {} }, miss = []
      for (const t of input.types) m.type[t] = over[`type.${t}`] ?? sc.trackers.find(x => x.toLowerCase() === t) ?? sc.trackers[0]
      for (const [c, names] of Object.entries(CATS)) { const hit = over[`status.${c}`] ?? low.find(([l]) => names.includes(l))?.[1]; if (hit) m.status[c] = hit; else miss.push(c) }
      const pr = sc.priorities; for (let p = 0; p <= 4; p++) m.priority[p] = pr[Math.min(pr.length - 1, Math.round(p * (pr.length - 1) / 4))]
      if (sc.versions?.length) m.mission = over.mission ?? sc.versions[0]
      const req = (sc.customFields ?? []).filter(f => f.required && f.default === undefined && !(f.name in o))
      if (miss.length || req.length) return msg(`${rest} 3/5 mapping: blocked.${miss.length ? ` No allowed status for: ${miss.join(', ')} (statuses: ${sc.statuses.join(', ')}); give map.status.<category>=<status>.` : ''}${req.length ? ` Required custom fields without a default: ${req.map(f => f.name).join(', ')}.` : ''}` )
      if (sc.customFields?.length) m.fields = Object.fromEntries(sc.customFields.filter(f => f.required).map(f => [f.name, f.default ?? o[f.name]]))
      return prop([`+ .cadre/config.json: sync.${name}.mapping =`, ...Object.entries(m).filter(([, v]) => v && Object.keys(v).length).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)], { set: { mapping: m }, d: { mapping: m } })
    }
    if (n === 4) {
      const v = call('validateAccess', { url: d.url, project: d.project, mapping: d.mapping }), bad = [...(v?.auth ? [] : ['auth']), ...['view', 'add', 'edit'].filter(p => !v?.perms?.[p]).map(p => `no ${p} permission`), ...(v?.missing ?? []).map(x => `missing ${x}`)]
      return bad.length ? msg(`${rest} 4/5 validate: blocked: ${bad.join('; ')} (no writes were made)`) : prop([])
    }
    const mode = o.direction ?? d.mode; if (!['push', 'import', 'empty'].includes(mode)) return msg(`${rest} 5/5 initial direction: /cadre ${rest} direction=push|import|empty\n  push: send local tasks · import: remote tasks become backlog drafts · empty: start empty (existing tasks stay local)`)
    const ops = []; let cursor
    if (mode === 'empty') { for (const t of input.tasks) ops.push({ op: 'meta', id: t.id, key: KEY, value: JSON.stringify({ l: {}, r: {}, skip: 1 }), base: t.base }); cursor = input.journal?.head }
    if (mode === 'import') for (const r of call('pull', { project: d.project }).tasks ?? []) ops.push({ op: 'draft', title: String(r.fields?.title ?? r.rid), description: String(r.fields?.description ?? ''), meta: JSON.stringify({ rid: r.rid, etag: r.etag, l: {}, r: {} }) })
    return prop([`+ .cadre/config.json: sync.${name}.direction = "both"`, `+ sync cursor init (${mode})`], { set: { direction: 'both' }, ops, ...(cursor ? { cursor } : {}) })
  } catch (e) { if (e instanceof AdapterError) return msg(`${rest}: ${e.code}: ${e.message}`); throw e }
}

publish(input.add ? add() : input.kind === 'events' ? deliver() : cycle())
