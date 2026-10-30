// Session lifecycle (DESIGN 8.2, 13.4, 13.5): lazy rehydrate after /clear, /resume or a new session, the board pointer, the resume card, session.start policy, store hygiene.
import { verdictAt } from './pipeline'
import type { Binding, Host, Snapshot } from '../types'
import type { TaskStore } from '../task-management/store'
import { StoreError } from '../task-management/store'
import { resetDelivery } from '../task-management/sync-engine/loop'
import { repoKeyOf, scoped } from '../commands/init'
import { cfgOf, ctlGet, ctlSet, gateDraw, mirror, missionOf, redraw, storeOf } from './dispatch'
import { ask } from './decide'
import { flagDecision, holds } from './flags'
import { specAsk } from './tdd'
import { propose } from './integrate'
import { UI, agentsOf, idleOf, isCold, leaseLive, modelView, safe, sessionOf, stamp } from './board'
import { intentsOf, pruneRuns, restore, settleIntent, step } from './lifecycle'
import { ring } from './events'
import { RUNS, nextAction } from './render'
import { queueCard, renderCard } from './briefs'
import { IDLE, LEASE, arm, canSpawn, casDrive, hardStop, idle, modOn, stop } from './drive'
import { DRIVE, ROUTES } from './dispatch'
import { queueBrief } from './lanes'
import { modelText } from './say'
import { realRoot, setPolicy } from '../policy/guards'
import { epicBranch, slug, slug32, wtRootOf } from './branches'
import { exists } from './git'
import { contain } from '../policy/containment'
import { asciiOf } from '../config/index'

export const qk = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:resumes`
export interface Entry { sessionId: string; agentId: string; taskId: string; text: string; epoch?: number }

// ---- resume card (8.2) from the board (+ decisions from the store) ----
export async function cardOf(h: Host, s: Snapshot, store?: TaskStore): Promise<{ text: string; decisions: number }> {
  const dec = store ? await safe(h, 'decisions', async () => (await store.list({})).filter(t => t.type === 'decision').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(t => t.title)) : undefined
  const d = s.drive, drive = d.on ? (d.stopped ? `stopped (${d.stopped})` : d.paused ? `paused (${d.paused})` : `on ${d.turns} turns`) : 'off'
  const text = renderCard({ mission: s.mission, epic: s.plan && { id: s.plan.id, title: s.plan.slug, intent: s.plan.state }, decisions: dec ?? [], questions: s.tasks.filter(t => t.state === 'blocked').map(t => `${t.id}: blocked`),
    inflight: s.tasks.filter(t => t.state === 'active' || t.state === 'review').map(t => ({ id: t.id, step: t.step, owner: t.owner })), drive, next: nextAction(modelView(s), await idleOf(h, s)) })
  return { text, decisions: dec?.length ?? 0 }
}

// ---- lazy rehydrate (13.4) after /clear, /resume, a new session: the board pointer + bindings (control doc key `board`) and tasks from the store, then the card ----
export async function savePointer(h: Host) {
  const s = await h.board.read()
  if (!isCold(s)) await ctlSet(h, { board: { mission: s.mission, epic: s.epic, plan: s.plan, drive: s.drive, bind: await h.bind.read(), session: await sessionOf(h), proc: procOf(h) } })
}

// ---- who is still there (continue after exit). A /clear resets $.state and the session id, not the process: its agents keep running. A quit ends the process and its agents. ----
// ponytail: a module variable is the process id; it also resets on a plugin hot reload (dev only), which then reads as a new process. continueRun still never takes over from a session that stamped in the last 30 s.
export const proc: { id: string; pid?: string } = { id: '' }
const procOf = (h: Host) => (proc.id ||= h.rand(6))
// `<host> <pid>` of the Claude Code process: a child's parent is that process (mods run inside it). '' where there is no sh: the 30 s window alone then
const pidOf = async (h: Host) => (proc.pid ??= await h.run(['sh', '-c', 'echo "$(uname -n) $PPID"']).then(r => (r.exitCode ? '' : r.stdout.trim()), () => ''))
type Alive = Record<string, { p: string; at: number; pid?: string }>
const ALIVE = 30_000
// each active session stamps {process, at} at most every 10 s from the 5 s tick. ponytail: read-modify-write on one key; two sessions writing at once may drop one stamp for one interval (the 30 s window absorbs it).
export async function stampAlive(h: Host): Promise<void> {
  if (life.ending) return   // a quit cleared this process's stamp: a tick that runs before the process is gone must not write it again (live 0.17: the stamp, and a pid still in the table, held the plan 30 s)
  const k = await scoped(h, 'alive'), now = await h.now(), me = await sessionOf(h), a = ((await h.store.get(k)) as Alive | undefined) ?? {}
  if (a[me]?.p === procOf(h) && now - a[me].at < 10_000) return
  await h.store.set(k, { ...Object.fromEntries(Object.entries(a).filter(([, v]) => now - v.at < 86_400_000)), [me]: { p: procOf(h), at: now, pid: await pidOf(h) } })
}
// session `s` from here: 'here' (this process: this session or one before a /clear), 'other' (another process that stamped in the last 30 s; also an unknown owner), 'gone'
export async function held(h: Host, s?: string): Promise<'here' | 'other' | 'gone'> {
  if (!s) return 'other'
  const a = (((await h.store.get(await scoped(h, 'alive'))) as Alive | undefined) ?? {})[s]
  if (s === (await sessionOf(h)) || a?.p === procOf(h)) return 'here'
  if (!a || (await h.now()) - a.at >= ALIVE) return 'gone'
  const [host, pid] = (a.pid ?? '').split(' ')   // a crash leaves its stamp: on this machine, a process that is gone frees it at once. ponytail: a reused pid reads as alive, so the window decides then
  return pid && host === (await pidOf(h)).split(' ')[0] && (await h.run(['sh', '-c', 'kill -0 "$1"', 'sh', pid]).catch(() => ({ exitCode: 0 }))).exitCode ? 'gone' : 'other'
}
// session.end on a quit (not /clear or /resume: the process and its agents go on): this process's stamps go, so a session started right after can continue at once
export const life = { ending: false }   // a quit has begun: the spawner starts nothing more (core/spawner)
export async function quit(h: Host): Promise<void> {
  life.ending = true
  const k = await scoped(h, 'alive'), a = ((await h.store.get(k)) as Alive | undefined) ?? {}
  await h.store.set(k, Object.fromEntries(Object.entries(a).filter(([, v]) => v.p !== procOf(h))))
}
// the session that spawned a task's current agent (admission.launch) or last renewed its claim (admission.beat); a bare number is a record from before owners were kept
// a task an agent may still be working on. Not the claim lease: the store drops it when a task moves to review (a reviewer at work has none), live
export const inFlight = (t: { category?: string }) => ['active', 'review', 'blocked'].includes(t.category ?? '')
export const ownerOf = async (h: Host, taskId: string): Promise<string | undefined> => (await ctlGet<{ s?: string }>(h, `hb:${taskId}`))?.s

// cold board, no pointer (a fresh checkout, an eval scaffold): adopt the newest unfinished non-mission epic that has an approved (non-draft) child. Tried once per session.
async function adopt(h: Host, b0: Snapshot) {
  if ((await h.secret.read()).adoptTried) return undefined
  await h.secret.update(x => ({ ...x, adoptTried: true }))
  const store = await storeOf(h), all = await store.list({}).catch(() => undefined), prefix = (await cfgOf(h)).branches.epicPrefix
  if (!all) return undefined   // no store yet (before init stage 2): nothing to adopt, and not an error to show
  const e = all.filter(t => t.type === 'epic' && !t.parent && !t.meta['cadre.kind'] && t.category !== 'done' && t.category !== 'cancelled' && all.some(c => c.parent === t.id && c.category !== 'draft')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  const mission = b0.mission ?? (await missionOf(store))
  if (!e && mission) await h.board.update(b => ({ ...b, mission }))
  return e && { mission, epic: e.id, plan: { id: e.id, slug: slug(e.title), state: 'approved', epicBranch: await epicName(h, e.meta['cadre.lane'] === 'milestone' ? 'milestone/' : prefix, e), approvedAt: await h.now(), ...(e.meta['cadre.lane'] === 'milestone' ? { lane: 'milestone' as const } : {}) }, drive: b0.drive, bind: {}, session: undefined }
}
// an epic cut before 0.9.1 keeps its longer name
async function epicName(h: Host, prefix: string, e: { id: string; title: string }) {
  const now = epicBranch(prefix, e.id, e.title), old = `${prefix}${e.id}-${slug32(e.title)}`
  return old !== now && !(await exists(h.run, await h.cwd(), now)) && (await exists(h.run, await h.cwd(), old)) ? old : now
}
// Decisions live on the board, which a /clear empties: ask again what durable state says is still owed. A pending init/setup/sync proposal is dropped (its code and diff are per session): run the command again.
async function reask(h: Host, store: TaskStore, plan: Snapshot['plan'] & {}) {
  const kids = await store.list({ parent: plan.id }).catch(() => []), gate = kids.find(t => t.type === 'gate' && !['done', 'cancelled'].includes(t.category))
  if (gate) await gateDraw(h, gate)   // a gate and a plan share the one approval slot: the gate blocks the work, so it goes first
  else if (plan.state === 'draft' || kids.some(t => t.category === 'draft' && t.type !== 'gate')) await redraw(h, store)
  const r = await casDrive(h, store, () => undefined).catch(() => undefined), y = !!r?.on && r.epicId === plan.id && !r.stopped && r.mode === 'yolo'   // yolo: main decides spec changes, release is the human's later
  for (const t of kids) {   // a blocked task gets its flag back (the mirror rebuilds tasks without flags: drive would wait on it for good); yolo asks only what drive holds on
    const f = t.meta['cadre.blocked'] === 'spec_change' ? 'spec_change' : t.category === 'blocked' ? t.meta['cadre.blocked'] || (t.meta['cadre.question'] ? 'blocked' : '') : ''
    if (!f) continue
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(x => (x.id === t.id && !x.flags.includes(f) ? { ...x, flags: [...x.flags, f] } : x)) }))
    if (f === 'spec_change') { if (!y) await specAsk(h, t.id, t.meta['cadre.specChange'] ?? '') } else if (!y || holds(f)) { const d = flagDecision(t.id, f, t.title); if (d) await ask(h, d) }
  }
  for (const f of plan.flags ?? []) { const d = flagDecision(plan.id, f); if (d) await ask(h, d) }
  for (const f of Object.keys((await h.git.read()).flags ?? {})) { const d = flagDecision('', f); if (d) await ask(h, d) }
  if (plan.state === 'done-on-dev' && !y) await propose(h, await h.cwd(), (await cfgOf(h)).branches.dev)
}
// 'gone': the store answers and has no such epic · 'down': no answer (setup writes the config before it makes the store, live): resume later, never onto a board the store cannot back
const recordOf = async (h: Host, id: string) => { try { await (await storeOf(h)).get(id); return 'ok' } catch (x) { return x instanceof StoreError && x.code === 'NotFound' ? 'gone' : 'down' } }
// one at a time: a rehydrate takes seconds of store calls, and a hook arriving meanwhile (a reviewer's report right after a /clear, live) must see the finished board, not a half-built one.
// Joining another dispatch's flight (the 5 s tick's) is not enough: every $.state get of one dispatch reads the moment of its first get, and only a write of its own moves that
// moment on (a compare-and-set miss included). So the joiner writes once (unchanged) to read the board the flight built. Without it a /cadre continue typed while the tick
// rehydrated read the cold board and answered "nothing to continue" over the band's unfinished plan (harness continue-after-quit).
let flight: Promise<boolean> | undefined
export async function rehydrate(h: Host): Promise<boolean> {
  if (!flight) return (flight = hydrate(h).finally(() => { flight = undefined }))
  const r = await flight; await h.board.update(b => b); return r
}
async function hydrate(h: Host): Promise<boolean> {
  const b0 = await h.board.read()
  if (!isCold(b0) || b0.epic) return false
  const p = (await ctlGet<any>(h, 'board').catch(() => undefined)) ?? (await adopt(h, b0))   // no answer yet (setup writes the config before the store): adopt finds nothing either
  if (!p?.epic) return false
  const there = await recordOf(h, p.epic); if (there === 'gone') await ctlSet(h, { board: undefined }); if (there !== 'ok') return false   // a pointer to an epic the store does not have (another store, a deleted draft): a phantom draft on the board blocked every new plan with no dialog to answer, live 0.9.1
  const store = await storeOf(h), now = await h.now(), me = await sessionOf(h), same = !!p.proc && p.proc === procOf(h)   // this process's pointer (a /clear): its agents and drive go on. Another process's: they stopped with it; /cadre continue picks them up
  await h.board.update(s => ({ ...s, mission: p.mission, epic: p.epic, plan: p.plan, drive: { ...p.drive, on: false, paused: undefined, ...(same ? {} : { stopped: undefined }) } }))
  await mirror(h, store)
  await safe(h, 'decisions', () => reask(h, store, p.plan))
  await safe(h, 'ring rebuild', async () => { if (await ring(h, store, p.epic)) await resetDelivery(h) })
  const rec = same ? await casDrive(h, store, r => (r?.on && r.epicId === p.epic && r.lease.session === p.session ? { ...r, lease: { session: me, until: now + LEASE } } : undefined)) : undefined   // our own lease moves to the new session id
  if (rec?.on && rec.epicId === p.epic) await h.board.update(s => ({ ...s, drive: { ...s.drive, on: true, turns: rec.turns, mode: rec.mode, stopped: rec.stopped } }))   // drive survives /clear: it continues at the next turn.complete (9)
  let gone = 0   // this process's agents survive a /clear: kept while their task is in flight
  for (const [a, b] of Object.entries((p.bind ?? {}) as Record<string, Binding>)) {
    if (a.startsWith('~')) continue
    if (!(same && inFlight(await store.get(b.taskId).catch(() => ({}))) && (await restore(h, a, { ...b, sessionId: me })))) gone++
  }
  const q = ((await h.store.get(await qk(h))) as Entry[] | undefined) ?? [], ids = new Set(Object.keys(await h.bind.read()))
  await h.store.set(await qk(h), q.map(x => (ids.has(x.agentId) ? { ...x, sessionId: me } : x)))
  await stamp(h, Math.max(1, (await h.events.read()).seq))
  const s = await h.board.read(), c = await cardOf(h, s, store)
  await queueCard(h, c.text)
  const b = await h.board.read()
  if (b.drive.on) h.toast('cadre: drive continues · /goal clear if one was restored')
  else if (b.plan?.state === 'approved' && !b.plan.landed) await h.ui.update(u => ({ ...u, cont: b.plan!.id }))   // the band offers 0: continue (ui/v2/facts.driveOf); never restarted by itself
  await UI.banner?.(h, { decisions: c.decisions, next: nextAction(modelView(s)), stale: gone })
  return true
}

// 13.4: any hook entry (agent tool.call/turn.complete, spawn, tick) warms a cold board, not only main's prompt.submit; cheap when warm
export const warm = (h: Host) => safe(h, 'rehydrate', () => rehydrate(h))

// ---- `/cadre continue` (typed, or the band's 0): pick up the open plan an earlier session left. Re-adopt it, take over the drive and every in-flight task whose session is
// gone (at once: no waiting for the 5-minute claim to lapse; never one another live session holds), and have main respawn their agents: admission's rebind gives each the
// computed handoff (checkpoint, diff, failing check, decisions), so nothing is redone. Pending decisions come back with the rehydrate (reask). Returns one line.
export const NOTHING = 'nothing to continue · /cadre <goal> to start'
// the one test for "an earlier session left this plan" (the status line, the band, continue agree): approved, not landed, nothing drives it, no agent of this session at work
export async function unfinished(h: Host): Promise<{ id: string; slug: string; done: number; total: number } | null> {
  const b = await h.board.read(), p = b.plan
  if (!p || p.slug === 'mission' || p.state === 'draft' || p.landed || p.state === 'done-on-dev' || p.state === 'released' || b.drive.on) return null
  if (Object.keys(await h.bind.read()).some(a => !a.startsWith('~'))) return null
  return { id: p.id, slug: p.slug, done: b.tasks.filter(t => t.state === 'done').length, total: b.tasks.length }
}
export async function continueRun(h: Host): Promise<string> {
  await rehydrate(h)
  const s = await h.board.read(), p = s.plan, needs = (s.decisions ?? []).length, more = needs ? ` · ${needs} needs you · press 1 to answer` : ''
  if (!p || p.slug === 'mission' || p.landed || p.state === 'done-on-dev' || p.state === 'released') return needs ? `${needs} needs you · press 1 to answer` : NOTHING
  if (p.state === 'draft') return `${p.id} ${p.slug} waits for your approval${more || ' · press 1 to answer'}`
  const store = await storeOf(h), me = await sessionOf(h), now = await h.now(), rec = await casDrive(h, store, () => undefined).catch(() => undefined)
  if (rec?.on && rec.epicId === p.id && rec.lease.until > now && (await held(h, rec.lease.session)) === 'other') return `${p.id} is running in another session · continue it there, or quit that one, then /cadre continue here (a session that crashed frees it within 30 s)`
  const bind = await h.bind.read(), go: string[] = [], took: string[] = [], other: string[] = []
  for (const t of s.tasks.filter(t => t.state === 'active' || (t.state === 'review' && verdictAt(t.step)))) {
    const mine = agentsOf(bind, t.id).filter(a => !a.startsWith('~'))
    if (mine.some(a => !bind[a].retired)) continue   // its agent works in this session
    const o = await ownerOf(h, t.id), task = await store.get(t.id).catch(() => null)
    if (!task || ((await held(h, o)) === 'other' && (o || leaseLive(task, now)))) { if (task) other.push(t.id); continue }   // a live session's task (or an unknown owner's live claim) is never taken
    for (const a of mine) await step(h, a, { type: 'end', cause: 'released', reason: 'continue' })
    await ctlSet(h, { [`hb:${t.id}`]: { s: me, at: 0 } })   // this session owns it now: admission's rebind no longer waits for the old claim
    if (t.state === 'review') await h.board.update(x => ({ ...x, tasks: x.tasks.map(y => (y.id === t.id ? { ...y, owner: undefined } : y)) }))   // the reviewer is gone: "spawn the reviewer" again
    go.push(t.state === 'review' ? `spawn TASK-${t.id} (reviewer)` : `spawn TASK-${t.id} (it starts from its last checkpoint)`); took.push(`${t.id} ${t.step}`)
  }
  let drv: string
  if (rec?.on && rec.epicId === p.id) {   // the run goes on in its mode, budget and baseline; a hard stop that happened meanwhile still stops it
    const r = (await casDrive(h, store, x => (x?.on && x.epicId === p.id && x.lease.session === rec.lease.session ? { ...x, lease: { session: me, until: now + LEASE } } : undefined)))!, dc = (await cfgOf(h)).drive
    await h.board.update(x => ({ ...x, drive: { on: true, level: 'epic', epicId: p.id, mode: r.mode, turns: r.turns, costUsd: r.cost ?? 0, startedAt: r.startedAt, stopped: r.stopped, maxTurns: dc.maxTurns, maxUsd: dc.maxCostUsd, maxMinutes: dc.maxWallMinutes } }))
    await DRIVE.sync?.(h)   // which mode starts the agents (core/spawner)
    const why = r.stopped ? null : await hardStop(h, r); if (why) await stop(h, why)
    const d = (await h.board.read()).drive
    drv = d.stopped ? `drive stopped: ${d.stopped} · 0: resume` : `drive ${d.mode ?? 'auto'}`
  } else drv = await arm(h, p.mode ?? 'auto')
  await h.ui.update(u => ({ ...u, cont: undefined }))
  const b2 = await h.board.read(), self = modOn(b2), nx = nextAction(modelView(b2), [], self), steps = [...new Set([...(self ? [] : go), ...(nx === RUNS ? [] : nx.split('; ').filter(x => x !== 'wait'))])]   // mod mode: the spawner starts them (ADR 0018)
  if (steps.length) await queueBrief(h, `Continue plan ${p.id}: ${steps.join('; ')}.`); else if (!canSpawn(h) && (await idle(h))) await queueBrief(h, IDLE)   // a typed /cadre is a frame that starts them itself; a press is not
  await savePointer(h)
  const n = `${s.tasks.filter(t => t.state === 'done').length}/${s.tasks.length} done`
  return [took.length ? `Picking up ${took.join(', ')}` : 'Nothing was in flight', drv, `${p.id} ${p.slug} ${n}`, ...(other.length ? [`${other.join(', ')} stay with another session`] : [])].join(' · ') + more   // the action first: the band press shows it as a short toast
}
ROUTES.continue = async h => ({ text: modelText('context', await continueRun(h)) })

// ---- session.start (and after /cadre config set): $.store `cadre:<repoKey>:policy` for guards/effect (13.1-13.2), cfg.ui mirrored into cadre.ui.cfg ----
export async function start(h: Host): Promise<void> {
  const cfg = await cfgOf(h), root = await h.cwd(), home = await h.home(), repo = (await h.stat(root, { resolve: true }))?.realPath ?? root
  await setPolicy(h, { repo, wtRoot: `${await realRoot(h, await wtRootOf(h, cfg))}/${repoKeyOf(root)}`, home, mcpAllow: cfg.mcpAllow,
    protect: [cfg.branches.main || 'main', cfg.branches.dev], effectCheck: cfg.effectCheck, epicPrefix: cfg.branches.epicPrefix, changelog: cfg.changelog.path })   // locks are kept: core/tdd owns them
  const ascii = asciiOf(cfg.ui.glyphs, await h.env()), theme = (await h.theme?.().catch(() => 'unknown')) ?? 'unknown'
  await h.ui.update(u => ({ ...u, cfg: { ...(u.cfg as object | undefined), glyphs: cfg.ui.glyphs, flash: cfg.ui.flash, density: cfg.ui.density, notify: cfg.ui.notify, escalateAfterMs: cfg.ui.escalateAfterMs, ascii, theme, maxTurns: cfg.drive.maxTurns } }))   // the render hooks cannot read env: resolve it here
  await safe(h, 'prune', () => prune(h))
}
// 13.5 $.store hygiene (ST-15): resume entries and pointer bindings of tasks no longer in flight, quarantine entries older than 30 days. Runs again after a /clear (wake): a
// lease test here dropped the binding of a reviewer still at work (its task in review has no lease), live
export async function prune(h: Host): Promise<void> {
  const store = await storeOf(h), now = await h.now(), live: Record<string, boolean> = {}
  const ok = async (id: string) => (live[id] ??= await store.get(id).then(inFlight, () => false))
  const q = ((await h.store.get(await qk(h))) as Entry[] | undefined) ?? [], keep: Entry[] = []
  for (const x of q) if (await ok(x.taskId)) keep.push(x)
  if (keep.length !== q.length) await h.store.set(await qk(h), keep)
  const p = await ctlGet<any>(h, 'board')
  await pruneRuns(h, id => store.get(id).then(t => t.category !== 'done' && t.category !== 'cancelled', () => false))   // not inFlight: an epic its planner drafts is todo
  for (const [n, it] of Object.entries(await intentsOf(h))) {   // a start a session left mid-claim (it died between the claim's writes): the half-made claim goes back
    if ((await held(h, it.session)) === 'other') continue   // a live session's start in flight
    const t = await store.get(it.taskId).catch(() => null), actor = String((await h.store.get(await scoped(h, 'actor'))) ?? '')
    if (it.role === 'claim' && t?.category === 'active' && t.assignee === actor && !Object.values(await h.bind.read()).some(b => b.taskId === it.taskId)) await store.release(it.taskId, actor, 'interrupted start').catch(() => {})
    await settleIntent(h, n)
  }
  if (p?.bind) { const b: Record<string, Binding> = {}; for (const [a, v] of Object.entries(p.bind as Record<string, Binding>)) if (!a.startsWith('~') && (await ok(v.taskId))) b[a] = v; await ctlSet(h, { board: { ...p, bind: b } }) }
  const quk = await scoped(h, 'quarantine'), qu = ((await h.store.get(quk)) as { ts: number }[] | undefined) ?? []
  if (qu.some(x => now - x.ts > 30 * 86_400_000)) await h.store.set(quk, qu.filter(x => now - x.ts <= 30 * 86_400_000))
}

// Per-repo opt-in: cadre acts only where `<repo>/.cadre/config.json` exists (init stage 1 writes it). Active is cached in the session secret; dormant re-checks (one read), so `/cadre init` takes effect without a restart.
// read-only: is the repo already on? ui.render may only read (a state write there is denied), so it asks this and never wake()
export const awake = async (h: Host): Promise<boolean> => { const sec = await h.secret.read(); return !!sec.active && !sec.old && !sec.storeOff && !sec.platform && !sec.profileBad }
export async function wake(h: Host): Promise<boolean> {
  const sec = await h.secret.read(); if (sec.old || sec.storeOff || sec.platform || sec.profileBad) return false   // Claude Code older than cadre needs (hooks/register.ts session.start): off, never half on; a repo profile that is refused (core/profile): dormant for this repo, no fallback
  if (sec.active) return true
  if (!(await h.readText(`${await h.cwd()}/.cadre/config.json`)) || (await cfgOf(h)).disable) return false   // `disable`: dormant from the next session (active is cached)
  await h.secret.update(s => ({ ...s, active: true }))
  await start(h).catch(() => {}); await contain(h).catch(() => {})   // policy + containment band, once, when the repo turns on
  return true
}
