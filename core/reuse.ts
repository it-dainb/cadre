// The one sender (DESIGN 2.2, 4.4, 7, 8): resume queue per sessionId + drain (#1), resume vs fresh, checkpoints, cost ledger (turn.step), compaction answer, prompt.submit.
// Rehydrate/start/prune live in core/session, drive and the /goal observer in core/drive.
import { modelText } from './say'
import { askCard, askOf, shown } from './asks'
import type { Binding, Hook, Host } from '../types'
import type { TaskStore } from '../task-management/store'
import { repoKeyOf, scoped } from '../commands/init'
import { cfgOf, storeOf } from './dispatch'
import { UI, modelView, patchBinding, safe, sessionOf, viewHash } from './board'
import { budgetOf, runOf, step } from './lifecycle'
import { nextAction } from './render'
import { subscribe } from './events'
import { brief, drainDelta } from './briefs'
import { resolveDeps } from './admission'
import { checkpoint } from './effect'
import { type Entry, cardOf, inFlight, qk, savePointer, warm } from './session'
import { drive, goalSeen } from './drive'
import { kick, spentOf } from './lessons'
import { delivered } from './needs'

const counted = (h: Host, q: Entry[], me: string) => h.board.update(s => ({ ...s, resumesQueued: q.filter(x => x.sessionId === me).length }))

// ---- resume queue (4.4): core/lifecycle queues (a run's wake); only drain sends. One entry per agentId and run (task epoch): a later text is appended once, an
// older run's wake is dropped. ----
export async function queueResume(h: Host, r: { agentId: string; taskId: string; text: string; epoch?: number }): Promise<void> {
  const b = (await h.bind.read())[r.agentId]
  if (b && b.taskId !== r.taskId) return void h.log(`resume to ${r.agentId} refused: it works on ${b.taskId}, not ${r.taskId}`)
  const me = await sessionOf(h), k = await qk(h), q = ((await h.store.get(k)) as Entry[] | undefined) ?? [], old = q.find(x => x.agentId === r.agentId)
  if (old && (old.epoch ?? 0) > (r.epoch ?? 0)) return   // a wake for an older run of this agent
  const text = !old || old.epoch !== r.epoch ? r.text : old.text.split('\n\n').includes(r.text) ? old.text : `${old.text}\n\n${r.text}`   // one wake per run: the same text never twice
  const next = [...q.filter(x => x.agentId !== r.agentId), { sessionId: b?.sessionId ?? me, agentId: r.agentId, taskId: r.taskId, text, ...(r.epoch !== undefined ? { epoch: r.epoch } : {}) }]
  await h.store.set(k, next); await counted(h, next, me)
}

// fresh instead of resume (4.4.3): over maxContextPct, or idle past the cache TTL with context > 30 %. Window = 200k unless the model says otherwise.
const ctxPct = (b: Binding) => Math.round((b.ctxTokens / 200_000) * 100)
export const stale = (b: Binding, now: number, cfg: any) => ctxPct(b) > cfg.reuse.maxContextPct || (now - (b.lastAt ?? b.startedAt) > cfg.reuse.cacheTtlMs && ctxPct(b) > 30)
async function retire(h: Host, a: string, b: Binding): Promise<boolean> {   // the agent stays bound but retired: admission rebinds it fresh with a computed handoff; a waiting run is never retired
  if ((await step(h, a, { type: 'retire' }))?.state?.state === 'waiting') return false
  h.toast(`cadre: ${b.taskId} needs a fresh agent · spawn TASK-${b.taskId}`); return true
}
async function sendMine(h: Host, store: TaskStore | undefined, cfg: any) {
  const me = await sessionOf(h), k = await qk(h), q = ((await h.store.get(k)) as Entry[] | undefined) ?? [], mine = q.filter(x => x.sessionId === me)
  if (!mine.length) return
  await h.store.set(k, q.filter(x => x.sessionId !== me)); await counted(h, [], me)   // taken before sending: a re-queue is a new entry, never a loop
  const now = await h.now(), bind = await h.bind.read()
  for (const r of mine) {
    const b = bind[r.agentId]
    const ask = r.taskId.startsWith('ask-') && (await askOf(h, r.agentId))   // a marker-less explorer's nudge (core/asks): no task, no lease
    if (!ask && store && b?.role !== 'planner' && !inFlight(await store.get(r.taskId))) continue   // the task closed or went back to todo: nothing to resume (entries of another session are never this session's to send)
    if (!ask && (!b || b.retired || (r.epoch ?? Infinity) < ((await runOf(h, r.agentId))?.epoch ?? 0))) continue   // unbound, retired, or a wake for an older run
    if (ask) { const res = await h.sendTo!(r.agentId, modelText('nudge', r.text)); if (!res.isDelivered) h.log(`${ask.id} could not be resumed: ${res.reason ?? 'not delivered'}`); continue }
    if (stale(b, now, cfg) && (await retire(h, r.agentId, b))) continue
    const delta = await drainDelta(h, r.agentId)
    await h.ui.update(u => ({ ...u, drainTo: r.agentId }))   // marks cadre's own send so policy/guards.send does not isolate it (reviewer findings quote other ids)
    const res = await h.sendTo!(r.agentId, modelText('nudge', delta ? `${r.text}\n\n${delta}` : r.text)).finally(() => h.ui.update(u => ({ ...u, drainTo: undefined })))
    if (!res.isDelivered) await retire(h, r.agentId, b); else await delivered(h, r.taskId, r.agentId)   // a helper's answer reached its requester: never put in a brief again
  }
}

// the spawner (ADR 0018) closes after this session's drain already ran: a rework it queued goes out from its own frame, else nothing would send it (found live: a merge conflict's worker waited for good)
export const sendQueued = async (h: Host) => sendMine(h, await storeOf(h).catch(() => undefined), await cfgOf(h))

// roles.tdd.author:same (3.5): the agent that wrote the tests stays bound; after red✓ (red -> worker) it is resumed with the worker brief.
subscribe(async (h, ev) => {
  if (ev.type !== 'task.phase_changed' || ev.data.from !== 'red' || ev.data.to !== 'worker') return
  const id = String(ev.data.taskId), bind = await h.bind.read(), a = Object.keys(bind).find(k => bind[k].taskId === id && bind[k].role === 'worker' && bind[k].step === 'tester')
  if (!a) return
  const t = await (await storeOf(h)).get(id)
  await step(h, a, { type: 'resume', step: 'worker', text: brief('worker', { id, title: t.title, type: t.type, description: t.description, scenarios: t.acceptance, contract: t.design,
    locked: t.meta['cadre.locked'] ? JSON.parse(t.meta['cadre.locked']) : undefined, redCard: t.meta['cadre.red'] }) })
})

// ---- cost ledger (7): turn.step usage per loop, summed per agent/task; USD by cost.prices, else token-equivalents ----
type U = { in: number; out: number; cr: number; cw: number; model?: string }
const zero = (): U => ({ in: 0, out: 0, cr: 0, cw: 0 })
const add = (a: U, u: any): U => ({ in: a.in + (u.input_tokens ?? 0), out: a.out + (u.output_tokens ?? 0), cr: a.cr + (u.cache_read_input_tokens ?? 0), cw: a.cw + (u.cache_creation_input_tokens ?? 0), model: u.model ?? a.model })
const plus = (a: U, b: U): U => ({ ...a, in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw, model: b.model ?? a.model })
export const tokensOf = (u: U) => Math.round(u.in + 1.25 * u.cw + 0.1 * u.cr + 5 * u.out)
export const cacheOf = (u: U) => (u.in + u.cr + u.cw ? Math.round((100 * u.cr) / (u.in + u.cr + u.cw)) : 0)
export function usdOf(u: U, cfg: any): number | undefined {   // cost.prices: {<model alias>: {in, out, cacheRead, cacheWrite}} in $ per Mtok
  const p = Object.entries((cfg.cost.prices ?? {}) as Record<string, any>).find(([k]) => u.model?.includes(k))?.[1]
  return p && (u.in * p.in + u.out * p.out + u.cr * (p.cacheRead ?? 0) + u.cw * (p.cacheWrite ?? 0)) / 1e6
}
const ck = (id: string) => `cadre:cost:${id}`, taskKey = (h: Host, id: string) => scoped(h, `cost:task:${id}`)   // a task's total is per repo: task ids repeat across repos
const ran = new Map<string, { task: string; effort?: string }>()   // agentId -> the task and effort its binding carried: both outlive the binding
export async function* meter(h: Host, e: any, next: (e: any) => any): AsyncGenerator<any, any, any> {
  // the routed effort outlives the binding: an agent's last step after its accepted report comes after cadre ended the binding, and ran on Claude Code's default (live: a reviewer's
  // trailing request on medium where the settings say high)
  const b = e.agentId && (await h.bind.read())[e.agentId], old = e.agentId ? ran.get(e.agentId) : undefined, eff = b?.effort ?? old?.effort
  if (b && e.agentId) { if (!old && ran.size >= 500) ran.delete(ran.keys().next().value!); ran.set(e.agentId, { task: b.taskId, effort: b.effort ?? old?.effort }) }   // FIFO: the oldest goes first
  const r = yield* next(eff && eff !== 'default' ? { ...e, effort: eff } : e)   // TM-03: the effort admission routed for this run (core/risk.route: roles.<role>.byRisk.<risk>, recorded on the binding); none = the agent file's
  if (r?.usage) await safe(h, 'cost', async () => {
    const tid = b?.taskId ?? old?.task, key = tid ? await taskKey(h, tid) : ck(e.agentId ?? 'main'), now = await h.now()   // a bound agent's usage goes to its task's total at once, and so does its last step after the binding ended: the ledger folds a per-agent key only while a binding exists (H12)
    const prev = (await h.store.get(key)) as (U & { t0?: number }) | undefined; await h.store.set(key, { ...add(prev ?? zero(), r.usage), ...(tid ? { t0: prev?.t0 ?? now } : {}) }); const ak = await scoped(h, 'cost:all'); await h.store.set(ak, add(((await h.store.get(ak)) as U) ?? zero(), r.usage))
    const ctx = (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0)
    if (e.agentId) await patchBinding(h, e.agentId, { ctxTokens: ctx, lastAt: now })
    if (b) { const pct = ctxPct({ ...b, ctxTokens: ctx }); await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === b.taskId && t.ctx !== pct ? { ...t, ctx: pct } : t)) })) }   // SnapTask.ctx: the owner's context fill
  })
  return r
}
// H12: a landed task's record, written by closeTask before cleanup prunes its Budget (a cancelled task writes none). Start = its first metered usage (run records carry no time); human.retry zeroes rework (docs/limitations.md). FIFO at 500
export async function landed(h: Host, cfg: any, id: string): Promise<void> {
  const t = ((await h.store.get(await taskKey(h, id))) as (U & { t0?: number }) | undefined) ?? zero(), end = await h.now(), rework = (await budgetOf(h, id)).rework, repo = repoKeyOf(await h.cwd()), usd = usdOf(t, cfg)
  const rs = await metricsOf(h); await h.store.set(await scoped(h, 'metrics'), [...rs, { repo, task: id, tokens: tokensOf(t), ...(usd !== undefined ? { usd: +usd.toFixed(4) } : {}), rework, firstTry: !rework, start: (t as { t0?: number }).t0 ?? end, end }].slice(-500))
}
type Landed = { tokens: number; usd?: number; rework: number; firstTry: boolean; start: number; end: number }
export const metricsOf = async (h: Host) => ((await h.store.get(await scoped(h, 'metrics'))) as Landed[] | undefined) ?? []
export function metricsText(rs: Landed[]): string {
  const n = rs.length, avg = (f: (x: Landed) => number) => rs.reduce((a, x) => a + f(x), 0) / n
  return !n ? 'metrics: no landed tasks yet' : [`${n} landed`, rs.every(x => x.usd !== undefined) ? `$${avg(x => x.usd!).toFixed(2)}/task` : `${Math.round(avg(x => x.tokens))} tokens/task`, `first-try ${Math.round(100 * avg(x => +x.firstTry))}%`, `rework ${avg(x => x.rework).toFixed(1)}/task`, `${Math.round(avg(x => x.end - x.start) / 60000)} min/task`].join(' · ')
}
// at an agent's turn.complete: fold its bucket into its task's and overwrite cadre.cost (no comments)
export async function ledger(h: Host, store: TaskStore, actor: string, cfg: any, agentId: string, taskId: string) {
  const a = ((await h.store.get(ck(agentId))) as U) ?? zero(), k = await taskKey(h, taskId), t = plus(((await h.store.get(k)) as U) ?? zero(), a)
  await h.store.set(k, t); await h.store.del(ck(agentId))
  const usd = usdOf(t, cfg)
  await store.setMeta(taskId, { 'cadre.cost': JSON.stringify({ tokens: tokensOf(t), cachePct: cacheOf(t), ...(usd !== undefined ? { usd: +usd.toFixed(4) } : {}) }) }, actor)
}

// ---- #8 session.compact (8.3): main = card + recent, answered without next (S49: toolUses:[]); agents = next with instructions ----
export const compact: Hook = async (h, e, next) => {
  const s = await h.board.read()
  if (e.agentId) {
    const b = (await h.bind.read())[e.agentId], t = b && s.tasks.find(x => x.id === b.taskId)
    return next(t ? { ...e, instructions: [e.instructions, modelText('context', `Keep: task ${t.id} (${t.step}), the spec commit, the last check result, open findings.`)].filter(Boolean).join('\n') } : e)
  }
  if (!s.plan) return next(e)
  const card = (await cardOf(h, s, await storeOf(h).catch(() => undefined))).text, keep: any[] = []
  let n = 0
  for (const m of [...(e.messages ?? [])].reverse()) { n += String(m.text ?? '').length; if (keep.length >= 6 || n > 8000) break; keep.unshift(m) }
  while (keep.length && (keep[0].role !== 'user' || keep[0].toolResults?.length)) keep.shift()   // never start on an orphan tool result
  await h.secret.update(x => ({ ...x, ctx: { key: viewHash(s) } }))   // the card counts as the sent context: delivered once
  return { messages: [{ role: 'user', text: modelText('context', card), toolUses: [] }, ...keep] }
}

// ---- #8 prompt.submit (main): lazy rehydrate, /goal sniff, task-notification -> result card (S40) ----
export const submit: Hook = async (h, e, next) => {
  if (e.agentId) return next(e)
  await warm(h)
  const m = /^\/goal\b(.*)/s.exec(String(e.text ?? '').trim())
  if (m) await safe(h, '/goal observer', () => goalSeen(h, m[1]))
  if (e.origin?.kind !== 'task-notification') return next(e)
  const agent = /<task-id>([^<]+)<\/task-id>/.exec(e.text ?? '')?.[1], tu = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(e.text ?? '')?.[1]
  if (agent && ((await h.ui.read()).own as string[] | undefined)?.includes(agent)) return { drop: 'cadre handled this agent' }   // started by the spawner (ADR 0018): main hears its landing in the digest, never a turn of its own
  const ask = await askOf(h, agent)   // a marker-less explorer: its card (once with the answer), never its text
  if (ask) { await shown(h, agent!, ask); return next({ ...e, text: modelText('card', ask.told ? `Agent ${ask.id} finished; its answer was already given (explore {id:"${ask.id}"}).` : `Result of ${ask.id}: ${askCard(ask).replaceAll('\n', ' · ')}`) }) }
  const taskId = agent && ((await h.bind.read())[agent]?.taskId ?? Object.values((await h.events.read()).epics).flat().reverse().find(x => x.type === 'agent.bound' && x.data.agentId === agent)?.taskId)
  const t = taskId && (await h.board.read()).tasks.find(x => x.id === taskId)
  if (!t || !t.card) return next(e)   // no card yet: the notification passes as is; the card rides the next context line
  if (tu) await UI.mapCard?.(h, tu, t.id)
  return next({ ...e, text: modelText('card', `Result of agent ${agent}: ${t.card.replace('\n', ' · ')}`) })
}

// ---- #1 turn.complete: after next, send this session's resumes; agents: checkpoint + ledger; main: usage mirror, pointer, compact hint, drive ----
export const drain: Hook = async (h, e, next) => {
  await warm(h)
  const r = await next(e)
  await safe(h, 'drain', async () => {
    const cfg = await cfgOf(h), store = await storeOf(h).catch(() => undefined)
    await sendMine(h, store, cfg)
    if (e.agentId) {
      const b = (await h.bind.read())[e.agentId]
      if (!b || !store) return
      const d = await resolveDeps(h)
      const tk = (await h.board.read()).tasks.find(x => x.id === b.taskId)   // L3: only while the task works; writes after report{done} must not move the tip past sourceCommit
      if (b.role === 'worker' && b.worktree && tk?.state === 'active' && tk.step === 'worker') await safe(h, 'checkpoint', () => checkpoint(h, store, d.actor, b.taskId, b.worktree))
      return void (await safe(h, 'cost ledger', () => ledger(h, store, d.actor, cfg, e.agentId, b.taskId)))
    }
    const u = await h.usage?.(), all = ((await h.store.get(await scoped(h, 'cost:all'))) as U) ?? zero(), pct = u?.context?.percent
    const side = await spentOf(h)   // the lessons pass's dollars (the engine's usage does not hold them)
    await h.board.update(s => ({ ...s, cost: { tokens: tokensOf(all), cachePct: cacheOf(all), ...(u?.cost ? { usd: u.cost.usd + side } : {}) } }))
    if (pct !== undefined) await h.ui.update(x => ({ ...x, ctx: pct }))
    await savePointer(h)
    const s = await h.board.read(), ui = await h.ui.read()
    if (s.plan?.landed && ui.clr !== s.plan.id) { await h.ui.update(x => ({ ...x, clr: s.plan!.id })); if ((pct ?? 0) > cfg.cost.clearHintPct) h.toast(`cadre: epic ${s.plan.id} landed · /clear for a fresh main`) }   // 7: never automatic
    if (pct !== undefined && pct > cfg.cost.compactPct && s.plan?.state === 'approved' && !(await h.ui.read()).cmp) { await h.ui.update(x => ({ ...x, cmp: true })); h.toast(`cadre: context ${pct}% · /compact now`) }   // S49: compact() is headless-unavailable: hint, not automatic
    await drive(h, cfg, u?.cost?.usd)
    kick(h, !s.tasks.some(t => t.state === 'active' || t.state === 'review'))   // lessons: a side-model pass after a landed plan, or when nothing runs (core/lessons)
  })
  return r
}
