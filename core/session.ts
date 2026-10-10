// Session lifecycle (DESIGN 8.2, 13.4, 13.5): lazy rehydrate after /clear, /resume or a new session, the board pointer, the resume card, session.start policy, store hygiene.
import type { Binding, Host, Snapshot } from '../types'
import type { TaskStore } from '../task-management/store'
import { resetDelivery } from '../task-management/sync-engine/loop'
import { repoKeyOf, scoped } from '../commands/init'
import { cfgOf, mirror, missionOf, registryOf, storeOf } from './dispatch'
import { UI, isCold, leaseLive, modelView, safe, sessionOf, stamp } from './board'
import { ring } from './events'
import { nextAction } from './render'
import { queueCard, renderCard } from './briefs'
import { LEASE, casDrive } from './drive'
import { realRoot, setPolicy } from '../policy/guards'
import { epicBranch, slug, wtRootOf } from './branches'

export const qk = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:resumes`
export interface Entry { sessionId: string; agentId: string; taskId: string; text: string }

// ---- resume card (8.2) from the board (+ decisions from the store) ----
export async function cardOf(h: Host, s: Snapshot, store?: TaskStore): Promise<{ text: string; decisions: number }> {
  const dec = store ? await safe(h, 'decisions', async () => (await store.list({})).filter(t => t.type === 'decision').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(t => t.title)) : undefined
  const d = s.drive, drive = d.on ? (d.paused ? `paused (${d.paused})` : `on ${d.turns} turns`) : 'off'
  const text = renderCard({ mission: s.mission, epic: s.plan && { id: s.plan.id, title: s.plan.slug, intent: s.plan.state }, decisions: dec ?? [], questions: s.tasks.filter(t => t.state === 'blocked').map(t => `${t.id}: blocked`),
    inflight: s.tasks.filter(t => t.state === 'active' || t.state === 'review').map(t => ({ id: t.id, step: t.step, owner: t.owner })), drive, next: nextAction(modelView(s)) })
  return { text, decisions: dec?.length ?? 0 }
}

// ---- lazy rehydrate (13.4) after /clear, /resume, a new session: board pointer + bindings from $.store, tasks from beads, then the card ----
const pk = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:board`
export async function savePointer(h: Host) {
  const s = await h.board.read()
  if (!isCold(s)) await h.store.set(await pk(h), { mission: s.mission, epic: s.epic, plan: s.plan, drive: s.drive, bind: await h.bind.read(), session: await sessionOf(h) })
}

// cold board, no pointer (a fresh checkout, an eval scaffold): adopt the newest unfinished non-mission epic that has an approved (non-draft) child. Tried once per session.
async function adopt(h: Host, b0: Snapshot) {
  if ((await h.secret.read()).adoptTried) return undefined
  await h.secret.update(x => ({ ...x, adoptTried: true }))
  const store = await storeOf(h), all = await store.list({}).catch(() => undefined), prefix = (await cfgOf(h)).branches.epicPrefix
  if (!all) return undefined   // no store yet (before init stage 2): nothing to adopt, and not an error to show
  const e = all.filter(t => t.type === 'epic' && !t.meta['cadre.kind'] && t.category !== 'done' && t.category !== 'cancelled' && all.some(c => c.parent === t.id && c.category !== 'draft')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  const mission = b0.mission ?? (await missionOf(store))
  if (!e && mission) await h.board.update(b => ({ ...b, mission }))
  return e && { mission, epic: e.id, plan: { id: e.id, slug: slug(e.title), state: 'approved', epicBranch: epicBranch(prefix, e.id, e.title), approvedAt: await h.now() }, drive: b0.drive, bind: {}, session: undefined }
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

// 13.4: any hook entry (agent tool.call/turn.complete, spawn, tick) warms a cold board, not only main's prompt.submit; cheap when warm
export const warm = (h: Host) => safe(h, 'rehydrate', () => rehydrate(h))

// ---- session.start (and after /cadre config set): $.store `cadre:<repoKey>:policy` for guards/effect (13.1-13.2), cfg.ui mirrored into cadre.ui.cfg ----
export async function start(h: Host): Promise<void> {
  const cfg = await cfgOf(h), root = await h.cwd(), home = await h.home(), repo = (await h.stat(root, { resolve: true }))?.realPath ?? root
  await setPolicy(h, { repo, wtRoot: `${await realRoot(h, await wtRootOf(h, cfg))}/${repoKeyOf(root)}`, home, mcpAllow: cfg.mcpAllow,
    protect: [cfg.branches.main || 'main', cfg.branches.dev], effectCheck: cfg.effectCheck, epicPrefix: cfg.branches.epicPrefix, changelog: cfg.changelog.path })   // locks are kept: core/tdd owns them
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
  const quk = await scoped(h, 'quarantine'), qu = ((await h.store.get(quk)) as { ts: number }[] | undefined) ?? []
  if (qu.some(x => now - x.ts > 30 * 86_400_000)) await h.store.set(quk, qu.filter(x => now - x.ts <= 30 * 86_400_000))
}
