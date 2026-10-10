// Drive (DESIGN 9): state on the board + beads (control issue cadre-control, meta cadre.drive with lease {session, until}: A30 read-check-write), the /goal observer.
import type { Hook, Host, Snapshot } from '../types'
import { StoreError, type TaskStore } from '../task-management/store'
import { controlOf } from '../task-management/sync-engine/loop'
import { ROUTES, storeOf } from './dispatch'
import { modelView, safe, sessionOf } from './board'
import { emit } from './events'
import { nextAction } from './render'

export const LEASE = 600_000
interface DriveRec { on: boolean; level: 'epic'; epicId: string; turns: number; usd0: number; startedAt: number; lastSeq: number; idle: number; lease: { session: string; until: number } }
// CAS on the control issue: fn sees the current record and returns the next one (undefined = no write); a revision race retries (sync writes the same issue)
export async function casDrive(h: Host, store: TaskStore, fn: (r: DriveRec | undefined) => DriveRec | undefined): Promise<DriveRec | undefined> {
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
  if (o.go) await h.submit!(`Continue: ${nx}`)   // plain text, never a slash command; P4: legal only here (#1 after next)
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
