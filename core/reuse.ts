// The one sender (DESIGN 2.2, 4.4, 7, 8, 9): resume queue per sessionId + drain (#1), resume vs fresh, checkpoints, cost ledger (turn.step),
// compaction answer, lazy rehydrate (board, bindings, ring) + resume card, drive (deterministic goal; state + lease on the control issue: A30 metadata fallback), /goal observer.
import type { Binding, Hook, Host, Snapshot } from '../types'
import { StoreError, type TaskStore } from '../task-management/store'
import { controlOf, resetDelivery } from '../task-management/sync-engine/loop'
import { repoKeyOf } from '../commands/init'
import { ROUTES, cfgOf, mirror, registryOf, storeOf } from './dispatch'
import { isCold, modelView, stamp, viewHash } from './board'
import { emit, rebuild, subscribe } from './events'
import { nextAction } from './render'
import { brief, drainDelta, queueCard, renderCard } from './briefs'
import { leaseLive, resolveDeps, sessionOf, beat } from './admission'
import { policyOf, setPolicy } from '../policy/guards'
import { resolve } from '../config/index'
import { epicBranch, slug } from './branches'
import * as G from './git'

// ui/ hooks register here at load (core never imports ui/, DESIGN 2.3): register.ts sets them.
export const UI: { mapCard?: (h: Host, toolUseId: string, taskId: string) => Promise<unknown>; banner?: (h: Host, o: { decisions?: number; next?: string; stale?: number }) => Promise<void> } = {}
const qk = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:resumes`
interface Entry { sessionId: string; agentId: string; taskId: string; text: string }
const safe = async <T>(h: Host, what: string, f: () => Promise<T>) => { try { return await f() } catch (x) { h.log(`cadre: ${what} failed: ${x}`) } }
const counted = (h: Host, q: Entry[], me: string) => h.board.update(s => ({ ...s, resumesQueued: q.filter(x => x.sessionId === me).length }))

// ---- resume queue (4.4): anything may queue; only drain sends. One entry per agentId; a later text is appended. ----
export async function queueResume(h: Host, r: { agentId: string; taskId: string; text: string }): Promise<void> {
  const b = (await h.bind.read())[r.agentId]
  if (b && b.taskId !== r.taskId) return void h.log(`cadre: resume to ${r.agentId} refused: it works on ${b.taskId}, not ${r.taskId}`)
  const me = await sessionOf(h), k = await qk(h), q = ((await h.store.get(k)) as Entry[] | undefined) ?? [], old = q.find(x => x.agentId === r.agentId)
  const text = old && old.text !== r.text ? `${old.text}\n\n${r.text}` : r.text
  const next = [...q.filter(x => x.agentId !== r.agentId), { sessionId: b?.sessionId ?? me, agentId: r.agentId, taskId: r.taskId, text }]
  await h.store.set(k, next); await counted(h, next, me)
}

// fresh instead of resume (4.4.3): over maxContextPct, or idle past the cache TTL with context > 30 %. Window = 200k unless the model says otherwise.
const ctxPct = (b: Binding) => Math.round((b.ctxTokens / 200_000) * 100)
const stale = (b: Binding, now: number, cfg: any) => ctxPct(b) > cfg.reuse.maxContextPct || (now - (b.lastAt ?? b.startedAt) > cfg.reuse.cacheTtlMs && ctxPct(b) > 30)
async function retire(h: Host, a: string, b: Binding, why: string) {   // the agent stays bound but retired: admission rebinds it fresh with a computed handoff
  await h.bind.update(t => (t[a] ? { ...t, [a]: { ...t[a], retired: true } } : t))
  h.toast(`cadre: ${b.taskId}: fresh agent needed (${why}); spawn TASK-${b.taskId}`)
}
async function sendMine(h: Host, store: TaskStore | undefined, cfg: any) {
  const me = await sessionOf(h), k = await qk(h), q = ((await h.store.get(k)) as Entry[] | undefined) ?? [], mine = q.filter(x => x.sessionId === me)
  if (!mine.length) return
  await h.store.set(k, q.filter(x => x.sessionId !== me)); await counted(h, [], me)   // taken before sending: a re-queue is a new entry, never a loop
  const now = await h.now(), bind = await h.bind.read()
  for (const r of mine) {
    const b = bind[r.agentId]
    if (store && !leaseLive(await store.get(r.taskId), now)) continue   // stale lease: that agent is gone; the rebind handoff replaces it (8.4)
    if (!b || b.retired) continue
    if (stale(b, now, cfg)) { await retire(h, r.agentId, b, `context ${ctxPct(b)}%`); continue }
    const delta = await drainDelta(h, r.agentId), res = await h.sendTo!(r.agentId, delta ? `${r.text}\n\n${delta}` : r.text)
    if (!res.isDelivered) await retire(h, r.agentId, b, res.reason ?? 'not delivered')
  }
}

// roles.tdd.author:same (3.5): the agent that wrote the tests stays bound; after red✓ (red -> worker) it is resumed with the worker brief.
subscribe(async (h, ev) => {
  if (ev.type !== 'task.phase_changed' || ev.data.from !== 'red' || ev.data.to !== 'worker') return
  const id = String(ev.data.taskId), bind = await h.bind.read(), a = Object.keys(bind).find(k => bind[k].taskId === id && bind[k].role === 'worker' && bind[k].step === 'tester')
  if (!a) return
  const t = await (await storeOf(h)).get(id)
  await h.bind.update(x => (x[a] ? { ...x, [a]: { ...x[a], step: 'worker' } } : x))
  await queueResume(h, { agentId: a, taskId: id, text: brief('worker', { id, title: t.title, type: t.type, description: t.description, scenarios: t.acceptance, contract: t.design,
    locked: t.meta['cadre.locked'] ? JSON.parse(t.meta['cadre.locked']) : undefined, redCard: t.meta['cadre.red'] }) })
})

// ---- checkpoint (8.4): commit a dirty worktree as wip; dirty locked paths refuse it and raise locked-dirty ----
export async function checkpoint(h: Host, store: TaskStore, actor: string, taskId: string, wt: string): Promise<string | null> {
  const dirty = (await h.run(['git', '-C', wt, 'status', '--porcelain', '-z'])).stdout.split('\0').filter(l => l.length > 3).map(l => l.slice(3))   // untrimmed: ' M a' keeps its column
  if (!dirty.length) return null
  const locks = (await policyOf(h)).locks?.[taskId] ?? []
  if (dirty.some(p => locks.some(l => l === p || l.endsWith(`/${p}`) || p.startsWith(`${l.replace(/\/$/, '')}/`)))) {
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === taskId && !t.flags.includes('locked-dirty') ? { ...t, flags: [...t.flags, 'locked-dirty'] } : t)) }))
    await emit(h, 'flag.raised', { taskId, flag: 'locked-dirty' }, { taskId }); return null
  }
  const cp = await G.op(h, () => G.commitAll(h.run, wt, `wip(${taskId}): checkpoint`))
  if (cp) await store.setMeta(taskId, { 'cadre.checkpoint': cp }, actor)
  return cp ?? null
}

// ---- cost ledger (7): turn.step usage per loop, summed per agent/task; USD by cost.prices, else token-equivalents ----
type U = { in: number; out: number; cr: number; cw: number; model?: string }
const zero = (): U => ({ in: 0, out: 0, cr: 0, cw: 0 })
const add = (a: U, u: any): U => ({ in: a.in + (u.input_tokens ?? 0), out: a.out + (u.output_tokens ?? 0), cr: a.cr + (u.cache_read_input_tokens ?? 0), cw: a.cw + (u.cache_creation_input_tokens ?? 0), model: u.model ?? a.model })
const plus = (a: U, b: U): U => ({ in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw, model: b.model ?? a.model })
export const tokensOf = (u: U) => Math.round(u.in + 1.25 * u.cw + 0.1 * u.cr + 5 * u.out)
export const cacheOf = (u: U) => (u.in + u.cr + u.cw ? Math.round((100 * u.cr) / (u.in + u.cr + u.cw)) : 0)
export function usdOf(u: U, cfg: any): number | undefined {   // cost.prices: {<tier|alias>: {in, out, cacheRead, cacheWrite}} in $ per Mtok
  const p = Object.entries((cfg.cost.prices ?? {}) as Record<string, any>).find(([k]) => u.model?.includes(cfg.models[k] ?? k))?.[1]
  return p && (u.in * p.in + u.out * p.out + u.cr * (p.cacheRead ?? 0) + u.cw * (p.cacheWrite ?? 0)) / 1e6
}
const ck = (id: string) => `cadre:cost:${id}`
export async function* step(h: Host, e: any, next: (e: any) => any): AsyncGenerator<any, any, any> {
  const b = e.agentId && (await h.bind.read())[e.agentId], eff = b && (await safe(h, 'effort', async () => (await cfgOf(h)).roles[b.step === 'tester' ? 'tester' : b.role]?.effort))
  const r = yield* next(eff && eff !== 'default' ? { ...e, effort: eff } : e)   // TM-03: roles.<role>.effort; 'default' keeps the agent file's frontmatter
  if (r?.usage) await safe(h, 'cost', async () => {
    const id = e.agentId ?? 'main'
    await h.store.set(ck(id), add(((await h.store.get(ck(id))) as U) ?? zero(), r.usage)); await h.store.set(ck('all'), add(((await h.store.get(ck('all'))) as U) ?? zero(), r.usage))
    const ctx = (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), now = await h.now()
    if (e.agentId) await h.bind.update(t => (t[e.agentId] ? { ...t, [e.agentId]: { ...t[e.agentId], ctxTokens: ctx, lastAt: now } } : t))
  })
  return r
}
// at an agent's turn.complete: fold its bucket into its task's and overwrite cadre.cost (no comments)
async function ledger(h: Host, store: TaskStore, actor: string, cfg: any, agentId: string, taskId: string) {
  const a = ((await h.store.get(ck(agentId))) as U) ?? zero(), t = plus(((await h.store.get(ck(`task:${taskId}`))) as U) ?? zero(), a)
  await h.store.set(ck(`task:${taskId}`), t); await h.store.del(ck(agentId))
  const usd = usdOf(t, cfg)
  await store.setMeta(taskId, { 'cadre.cost': JSON.stringify({ tokens: tokensOf(t), cachePct: cacheOf(t), ...(usd !== undefined ? { usd: +usd.toFixed(4) } : {}) }) }, actor)
}

// ---- resume card (8.2) from the board (+ decisions from the store) ----
async function cardOf(h: Host, s: Snapshot, store?: TaskStore): Promise<{ text: string; decisions: number }> {
  const dec = store ? await safe(h, 'decisions', async () => (await store.list({})).filter(t => t.type === 'decision').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(t => t.title)) : undefined
  const d = s.drive, drive = d.on ? (d.paused ? `paused (${d.paused})` : `on ${d.turns} turns`) : 'off'
  const text = renderCard({ mission: s.mission, epic: s.plan && { id: s.plan.id, title: s.plan.slug, intent: s.plan.state }, decisions: dec ?? [], questions: s.tasks.filter(t => t.state === 'blocked').map(t => `${t.id}: blocked`),
    inflight: s.tasks.filter(t => t.state === 'active' || t.state === 'review').map(t => ({ id: t.id, step: t.step, owner: t.owner })), drive, next: nextAction(modelView(s)) })
  return { text, decisions: dec?.length ?? 0 }
}

// ---- lazy rehydrate (13.4) after /clear, /resume, a new session: board pointer + bindings from $.store, tasks from beads, then the card ----
const pk = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:board`
async function savePointer(h: Host) {
  const s = await h.board.read()
  if (!isCold(s)) await h.store.set(await pk(h), { mission: s.mission, epic: s.epic, plan: s.plan, drive: s.drive, bind: await h.bind.read(), session: await sessionOf(h) })
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
// cold board, no pointer (a fresh checkout, an eval scaffold): adopt the newest unfinished non-mission epic that has an approved (non-draft) child. Tried once per session.
async function adopt(h: Host, b0: Snapshot) {
  if ((await h.secret.read()).adoptTried) return undefined
  await h.secret.update(x => ({ ...x, adoptTried: true }))
  const store = await storeOf(h), all = await store.list({}), prefix = (await cfgOf(h)).branches.epicPrefix
  const e = all.filter(t => t.type === 'epic' && !t.meta['cadre.kind'] && t.category !== 'done' && t.category !== 'cancelled' && all.some(c => c.parent === t.id && c.category !== 'draft')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  return e && { mission: b0.mission, epic: e.id, plan: { id: e.id, slug: slug(e.title), state: 'approved', epicBranch: epicBranch(prefix, e.id, e.title), approvedAt: await h.now() }, drive: b0.drive, bind: {}, session: undefined }
}
export async function rehydrate(h: Host): Promise<boolean> {
  const b0 = await h.board.read()
  if (!isCold(b0) || b0.epic) return false
  const p = ((await h.store.get(await pk(h))) as any) ?? (await adopt(h, b0))
  if (!p?.epic) return false
  const store = await storeOf(h), now = await h.now(), me = await sessionOf(h)
  await h.board.update(s => ({ ...s, mission: p.mission, epic: p.epic, plan: p.plan, drive: { ...p.drive, on: false, paused: undefined } }))
  await mirror(h, store, await registryOf(h))
  await safe(h, 'ring rebuild', async () => { if (await ring(h, store, p.epic)) await resetDelivery(h) })
  const rec = await casDrive(h, store, r => (r?.on && r.epicId === p.epic && r.lease.session === p.session ? { ...r, lease: { session: me, until: now + LEASE } } : undefined))   // our own lease moves to the new session id
  if (rec?.on && rec.epicId === p.epic) await h.board.update(s => ({ ...s, drive: { ...s.drive, on: true, turns: rec.turns } }))   // drive survives /clear: it continues at the next turn.complete (9)
  let gone = 0
  for (const [a, b] of Object.entries((p.bind ?? {}) as Record<string, Binding>)) {
    if (a.startsWith('~')) continue
    if (leaseLive(await store.get(b.taskId).catch(() => ({}) as any), now)) await h.bind.update(t => ({ ...t, [a]: { ...b, sessionId: me } })); else gone++
  }
  const q = ((await h.store.get(await qk(h))) as Entry[] | undefined) ?? [], ids = new Set(Object.keys(await h.bind.read()))
  await h.store.set(await qk(h), q.map(x => (ids.has(x.agentId) ? { ...x, sessionId: me } : x)))
  await stamp(h, Math.max(1, (await h.events.read()).seq))
  const s = await h.board.read(), c = await cardOf(h, s, store)
  await queueCard(h, c.text)
  if ((await h.board.read()).drive.on) h.toast('cadre: drive continues after the reset · a /goal restored by --resume is invisible to cadre: /goal clear it, or drive and /goal both own the loop (A27)')
  await UI.banner?.(h, { decisions: c.decisions, next: nextAction(modelView(s)), stale: gone })
  return true
}

// ---- #8 session.compact (8.3): main = card + recent, answered without next (S49: toolUses:[]); agents = next with instructions ----
export const compact: Hook = async (h, e, next) => {
  const s = await h.board.read()
  if (e.agentId) {
    const b = (await h.bind.read())[e.agentId], t = b && s.tasks.find(x => x.id === b.taskId)
    return next(t ? { ...e, instructions: [e.instructions, `Keep: task ${t.id} (${t.step}), the spec commit, the last check result, open findings.`].filter(Boolean).join('\n') } : e)
  }
  if (!s.plan) return next(e)
  const card = (await cardOf(h, s, await storeOf(h).catch(() => undefined))).text, keep: any[] = []
  let n = 0
  for (const m of [...(e.messages ?? [])].reverse()) { n += String(m.text ?? '').length; if (keep.length >= 6 || n > 8000) break; keep.unshift(m) }
  while (keep.length && (keep[0].role !== 'user' || keep[0].toolResults?.length)) keep.shift()   // never start on an orphan tool result
  await h.secret.update(x => ({ ...x, ctx: { key: viewHash(s) } }))   // the card counts as the sent context: delivered once
  return { messages: [{ role: 'user', text: card, toolUses: [] }, ...keep] }
}

// ---- drive (9): state on the board + beads (control issue cadre-control, meta cadre.drive with lease {session, until}: A30 read-check-write) ----
const LEASE = 600_000
interface DriveRec { on: boolean; level: 'epic'; epicId: string; turns: number; usd0: number; startedAt: number; lastSeq: number; idle: number; lease: { session: string; until: number } }
// CAS on the control issue: fn sees the current record and returns the next one (undefined = no write); a revision race retries (sync writes the same issue)
async function casDrive(h: Host, store: TaskStore, fn: (r: DriveRec | undefined) => DriveRec | undefined): Promise<DriveRec | undefined> {
  const ctl = await controlOf(h, store)
  for (let i = 0; i < 3; i++) {
    const t = await store.get(ctl), r = t.meta['cadre.drive'] ? (JSON.parse(t.meta['cadre.drive']) as DriveRec) : undefined, n = fn(r)
    if (!n) return r
    try { await store.setMeta(ctl, { 'cadre.drive': JSON.stringify(n) }, 'cadre', t.revision); return n } catch (e) { if (!(e instanceof StoreError && e.code === 'GuardMismatch')) throw e }
  }
  throw new StoreError('Busy', 'drive state kept moving')
}
const held = (r: DriveRec | undefined, me: string, now: number) => !!r && r.lease.session !== me && r.lease.until > now
async function driveEvent(h: Host, state: string, reason?: string) { await emit(h, 'drive.status', { state, ...(reason ? { reason } : {}) }) }
async function pause(h: Host, why: string) {
  if ((await h.board.read()).drive.paused === why) return
  await h.board.update(s => ({ ...s, drive: { ...s.drive, paused: why } })); await driveEvent(h, 'paused', why)
}
const BOUND = /^(max |no progress|cost )/
// the human gate in front of the epic, or null
async function gate(h: Host, s: Snapshot): Promise<string | null> {
  if (s.approval.planId) return `approve ${s.approval.planId}`
  const b = s.tasks.find(t => t.state === 'blocked'); if (b) return `blocked ${b.id}`
  const f = s.tasks.find(t => t.flags.length); if (f) return `resolve ${f.flags[0]}`
  if (s.plan?.flags?.length) return `resolve ${s.plan.flags[0]}`
  const g = Object.keys((await h.git.read()).flags ?? {}).find(k => k.startsWith('git:')); if (g) return `resolve ${g}`
  if ((await h.ui.read()).goal) return 'two loop owners: /goal active'
  return null
}
export async function drive(h: Host, cfg: any, usd: number | undefined) {
  const s = await h.board.read(), d = s.drive
  if (!d.on || !s.epic || !s.plan) return
  if (s.plan.landed || s.plan.state === 'done-on-dev' || s.plan.state === 'released') {   // computed done: integration landed it on dev with its changelog (3.9, plan.landed)
    await h.board.update(x => ({ ...x, drive: { ...x.drive, on: false, paused: undefined } })); await driveEvent(h, 'finished')
    await casDrive(h, await storeOf(h), r => r && { ...r, on: false, lease: { session: '', until: 0 } })
    return void h.toast(`cadre: epic ${s.plan.id} landed; drive finished`)   // the /clear hint is the drain's (7)
  }
  const g = await gate(h, s)
  if (g) return pause(h, g)
  if (d.paused && !BOUND.test(d.paused)) { await h.board.update(x => ({ ...x, drive: { ...x.drive, paused: undefined } })); await driveEvent(h, 'running') }
  else if (d.paused) return
  const store = await storeOf(h), me = await sessionOf(h), now = await h.now(), dc = cfg.drive, nx = nextAction(modelView(s))
  const evs = (await h.events.read()).epics[s.epic] ?? [], seq = evs.filter(x => x.type === 'task.transitioned').reduce((m, x) => Math.max(m, x.seq), 0)
  const o = { rec: undefined as DriveRec | undefined, bound: null as string | null, go: false, cost: d.costUsd }   // what the CAS attempt that stood decided
  const out = await casDrive(h, store, r => {
    o.rec = r; if (!r?.on || r.epicId !== s.epic || held(r, me, now)) return undefined
    const idle = seq > r.lastSeq || !r.turns ? 0 : r.idle + 1
    o.cost = usd === undefined ? d.costUsd : +(usd - r.usd0).toFixed(2)
    o.bound = r.turns >= dc.maxTurns ? `max turns ${dc.maxTurns}` : o.cost >= dc.maxCostUsd ? `cost $${o.cost} ≥ $${dc.maxCostUsd}` : now - r.startedAt > dc.maxWallMinutes * 60_000 ? `max ${dc.maxWallMinutes} min` : idle >= dc.noProgressTurns ? `no progress in ${idle} turns` : null
    o.go = !o.bound && nx !== 'wait'
    return { ...r, turns: r.turns + (o.go ? 1 : 0), lastSeq: seq, idle: o.go ? idle : r.idle, lease: { session: me, until: now + LEASE } }
  })
  const rec = o.rec
  if (!rec?.on || rec.epicId !== s.epic) return void (await h.board.update(x => ({ ...x, drive: { ...x.drive, on: false } })))
  if (held(rec, me, now)) return void (await h.board.update(x => ({ ...x, drive: { ...x.drive, heldBy: rec.lease.session } })))
  await h.board.update(x => ({ ...x, drive: { ...x.drive, turns: out!.turns, costUsd: o.cost, heldBy: undefined } }))
  if (o.bound) return pause(h, o.bound)
  if (dc.maxCostUsd && o.cost >= 0.8 * dc.maxCostUsd && d.costUsd < 0.8 * dc.maxCostUsd) await emit(h, 'cost.updated', { tokens: (await h.board.read()).cost.tokens, threshold: 80 })
  if (o.go) await h.submit!(`cadre drive: ${nx}`)   // plain text, never a slash command; P4: legal only here (#1 after next)
}
// /cadre drive on|off|status (dispatch gates on|off as human). Arming submits nothing: drive starts at the next turn.complete.
ROUTES.drive = async (h, c) => {
  const s = await h.board.read(), sub = c.args[0] ?? 'status'
  if (sub === 'status') return { text: s.drive.on ? `drive on · ${s.drive.turns} turns · $${s.drive.costUsd}${s.drive.paused ? ` · paused: ${s.drive.paused}` : ''}${s.drive.heldBy ? ` · held by ${s.drive.heldBy}` : ''}` : 'drive off' }
  if (!s.epic || !s.plan || s.plan.state === 'draft') return { text: 'refused: drive needs an approved epic' }
  const store = await storeOf(h), me = await sessionOf(h), now = await h.now()
  if (sub === 'off') {
    await casDrive(h, store, r => r && { ...r, on: false, lease: { session: '', until: 0 } })
    await h.board.update(x => ({ ...x, drive: { ...x.drive, on: false, paused: undefined } })); await driveEvent(h, 'off'); return { text: 'Drive off.' }
  }
  if (sub !== 'on') return { text: 'usage: /cadre drive on|off|status' }
  const usd = (await h.usage?.())?.cost?.usd ?? 0, fresh: DriveRec = { on: true, level: 'epic', epicId: s.epic, turns: 0, usd0: usd, startedAt: now, lastSeq: 0, idle: 0, lease: { session: me, until: now + LEASE } }
  const r = await casDrive(h, store, x => (x?.on && held(x, me, now) ? undefined : fresh))
  if (r !== fresh) return { text: `refused: drive: held by ${r!.lease.session}` }
  await h.board.update(x => ({ ...x, drive: { on: true, level: 'epic', epicId: s.epic, turns: 0, costUsd: 0, startedAt: now } }))
  await driveEvent(h, 'armed')
  return { text: `Drive armed for ${s.plan.id}; it starts when this turn ends.` }
}
// /goal observer (9, S48): command.run {command:'goal'} and prompt.submit text '/goal …'. Never rewritten; pauses drive until /goal clear.
export async function goalSeen(h: Host, args: string) {
  const on = !/^\s*(clear|off|stop)?\s*$/.test(args)
  await h.ui.update(u => ({ ...u, goal: on || undefined }))
  const d = (await h.board.read()).drive
  if (on && d.on) await pause(h, 'two loop owners: /goal active')
  if (!on && d.paused?.startsWith('two loop owners')) await h.board.update(s => ({ ...s, drive: { ...s.drive, paused: undefined } }))
}
export const goal: Hook = async (h, e, next) => { const r = await next(e); await safe(h, '/goal observer', () => goalSeen(h, String(e.args ?? ''))); return r }

// ---- #8 prompt.submit (main): lazy rehydrate, /goal sniff, task-notification -> result card (S40) ----
export const submit: Hook = async (h, e, next) => {
  if (e.agentId) return next(e)
  await safe(h, 'rehydrate', () => rehydrate(h))
  const m = /^\/goal\b(.*)/s.exec(String(e.text ?? '').trim())
  if (m) await safe(h, '/goal observer', () => goalSeen(h, m[1]))
  if (e.origin?.kind !== 'task-notification') return next(e)
  const agent = /<task-id>([^<]+)<\/task-id>/.exec(e.text ?? '')?.[1], tu = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(e.text ?? '')?.[1]
  const taskId = agent && ((await h.bind.read())[agent]?.taskId ?? Object.values((await h.events.read()).epics).flat().reverse().find(x => x.type === 'agent.bound' && x.data.agentId === agent)?.taskId)
  const t = taskId && (await h.board.read()).tasks.find(x => x.id === taskId)
  if (!t || !t.card) return next(e)   // no card yet: the notification passes as is; the card rides the next context line
  if (tu) await UI.mapCard?.(h, tu, t.id)
  return next({ ...e, text: `cadre result card (agent ${agent}): ${t.card.replace('\n', ' · ')}` })
}

// ---- #1 turn.complete: after next, send this session's resumes; agents: checkpoint + ledger; main: usage mirror, pointer, compact hint, drive ----
export const drain: Hook = async (h, e, next) => {
  const r = await next(e)
  await safe(h, 'drain', async () => {
    const cfg = await cfgOf(h), store = await storeOf(h).catch(() => undefined)
    await sendMine(h, store, cfg)
    if (e.agentId) {
      const b = (await h.bind.read())[e.agentId]
      if (!b || !store) return
      const d = await resolveDeps(h)
      if (b.role === 'worker' && b.worktree) await safe(h, 'checkpoint', () => checkpoint(h, store, d.actor, b.taskId, b.worktree))
      return void (await safe(h, 'cost ledger', () => ledger(h, store, d.actor, cfg, e.agentId, b.taskId)))
    }
    const u = await h.usage?.(), all = ((await h.store.get(ck('all'))) as U) ?? zero(), pct = u?.context?.percent
    await h.board.update(s => ({ ...s, cost: { tokens: tokensOf(all), cachePct: cacheOf(all), ...(u?.cost ? { usd: u.cost.usd } : {}) } }))
    if (pct !== undefined) await h.ui.update(x => ({ ...x, ctx: pct }))
    await savePointer(h)
    const s = await h.board.read(), ui = await h.ui.read()
    if (s.plan?.landed && ui.clr !== s.plan.id) { await h.ui.update(x => ({ ...x, clr: s.plan!.id })); if ((pct ?? 0) > cfg.cost.clearHintPct) h.toast(`cadre: epic ${s.plan.id} landed · context ${pct}%: /clear for a fresh main (all state is in beads)`) }   // 7: never automatic
    if (pct !== undefined && pct > cfg.cost.compactPct && s.plan?.state === 'approved' && !(await h.ui.read()).cmp) { await h.ui.update(x => ({ ...x, cmp: true })); h.toast(`cadre: context ${pct}%: /compact now (cadre answers it with the resume card)`) }   // S49: compact() is headless-unavailable: hint, not automatic
    await drive(h, cfg, u?.cost?.usd)
  })
  return r
}

// ---- tick (5 s): heartbeat this session's bound tasks (admission.beat); nothing else, never a send (G6) ----
export async function tick(h: Host): Promise<void> {
  if (Object.keys(await h.bind.read()).some(a => !a.startsWith('~'))) await beat(h, await resolveDeps(h))
}

// ---- session.start (and after /cadre config set): $.store `cadre:<repoKey>:policy` for guards/effect (13.1-13.2), cfg.ui mirrored into cadre.ui.cfg ----
export async function start(h: Host): Promise<void> {
  const cfg = await cfgOf(h), root = await h.cwd(), home = await h.home(), repo = (await h.stat(root, { resolve: true }))?.realPath ?? root
  await setPolicy(h, { repo, wtRoot: `${cfg.worktrees.root || `${home}/.cache/cadre/wt`}/${repoKeyOf(root)}`, home, mcpAllow: cfg.mcpAllow,
    protect: [cfg.branches.main || 'main', cfg.branches.dev], effectCheck: cfg.effectCheck })   // locks are kept: core/tdd owns them
  await h.ui.update(u => ({ ...u, cfg: { ...(u.cfg as object | undefined), glyphs: cfg.ui.glyphs, maxTurns: cfg.drive.maxTurns } }))
  await safe(h, 'prune', () => prune(h))
}
// 13.5 $.store hygiene (ST-15): stale-lease resume entries, bindings of closed or expired tasks in the pointer, quarantine entries older than 30 days
export async function prune(h: Host): Promise<void> {
  const store = await storeOf(h), now = await h.now(), live: Record<string, boolean> = {}
  const ok = async (id: string) => (live[id] ??= await store.get(id).then(t => leaseLive(t, now) && t.category !== 'done' && t.category !== 'cancelled', () => false))
  const q = ((await h.store.get(await qk(h))) as Entry[] | undefined) ?? [], keep: Entry[] = []
  for (const x of q) if (await ok(x.taskId)) keep.push(x)
  if (keep.length !== q.length) await h.store.set(await qk(h), keep)
  const p = (await h.store.get(await pk(h))) as any
  if (p?.bind) { const b: Record<string, Binding> = {}; for (const [a, v] of Object.entries(p.bind as Record<string, Binding>)) if (!a.startsWith('~') && (await ok(v.taskId))) b[a] = v; await h.store.set(await pk(h), { ...p, bind: b }) }
  const qu = ((await h.store.get('quarantine')) as { ts: number }[] | undefined) ?? []
  if (qu.some(x => now - x.ts > 30 * 86_400_000)) await h.store.set('quarantine', qu.filter(x => now - x.ts <= 30 * 86_400_000))
}
// /cadre config set <key> <json|text>: written to ~/.claude/cadre.json (user layer), validated by re-resolving first (12). show stays in commands/cadre.
ROUTES.config = async (h, c) => {
  const [sub, key, ...v] = c.args
  if (sub !== 'set' || !key || !v.length) return { text: 'usage: /cadre config show | /cadre config set <key> <value>' }
  const path = `${await h.home()}/.claude/cadre.json`, raw = v.join(' ')
  let cur: any, val: unknown
  try { cur = JSON.parse((await h.readText(path)) ?? '{}') } catch { return { text: `refused: ${path} is not valid JSON` } }
  try { val = JSON.parse(raw) } catch { val = raw }
  const ks = key.split('.'); let o = cur
  for (const k of ks.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
  o[ks[ks.length - 1]] = val
  const bad = resolve([{ name: 'set', trust: 'user', value: (({ repos: _r, ...x }) => x)(cur) }]).diagnostics.filter(d => d.includes(key))
  if (bad.length) return { text: `refused: ${bad.join('; ')}` }
  await h.write(path, `${JSON.stringify(cur, null, 2)}\n`); await start(h)
  return { text: `config ${key} = ${JSON.stringify(val)} (~/.claude/cadre.json)` }
}
