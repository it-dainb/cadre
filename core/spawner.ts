// Mod mode (ADR 0018): cadre starts the task agents itself with $.agent.spawn; main plans, talks to the user and hears one line per landing.
// The re-entry rule: an agent started from a call outside a hook (timer, ui handler) runs with EVERY cadre hook left out (no guard, no report), and one started
// from registration #k leaves #k out for the agent's own events. So the spawn is made only from a frame whose event no agent raises inside its run
// (turn.complete: a subagent's is not nested, probed; command.run). hooks/register.ts gives h.spawnAgent only to those frames; spawnStep refuses any other.
import { gateAt } from './pipeline'
import type { Host } from '../types'
import { DRIVE, cfgOf, storeOf } from './dispatch'
import { headlessMain } from '../config/index'
import { modelView } from './board'
import { spawnable } from './render'
import { IDLE, drive, modOn, ready, stop, tally } from './drive'
import { closeTask } from './close'
import { integrateEpic } from './integrate'
import { modelFor, resolveDeps } from './admission'
import { pkgOf } from './specview'
import * as Q from './queue'
import { sendQueued } from './reuse'
import { life } from './session'
import { emit } from './events'
import { modelText } from './say'
import { isMs } from './milestone'
import { charge, intend, settleIntent } from './lifecycle'
import { specNeeded } from './specifier'
import { sessionOf } from './board'

export const FRAMES = ['turn.complete', 'command.run']
// the session's mode: drive.spawn (CADRE_SPAWN maps onto it: config/index.envLayer); a non-interactive session runs main (config/index.headlessMain)
export async function spawnMode(h: Host): Promise<{ mode: 'mod' | 'main'; why: string }> {
  const c = await cfgOf(h), env = await h.env(), mode = c.drive.spawn === 'mod' ? 'mod' as const : 'main' as const
  if (headlessMain(mode, env, !!(await h.ui.read()).headless)) return { mode: 'main', why: 'a non-interactive session ends when no agent runs' }
  return { mode, why: env.CADRE_SPAWN ? 'CADRE_SPAWN' : 'drive.spawn' }
}
// the board says which mode runs while a run is on (main's context line and admission read it); a change is said once in Activity
export async function syncMode(h: Host): Promise<void> {
  const s = await h.board.read(); if (!s.drive.on) return
  const m = await spawnMode(h), v = m.mode === 'mod' ? 'mod' as const : undefined, pl = v && (await cfgOf(h)).milestone.epicPlanner === 'agent' ? 'agent' as const : undefined   // a planner agent needs cadre to start it (ADR 0021)
  if (s.drive.spawn === v && s.drive.planner === pl) return
  await h.board.update(x => ({ ...x, drive: { ...x.drive, spawn: v, planner: pl } }))
  if (s.drive.spawn !== v) await emit(h, 'drive.status', { state: 'mode', reason: `${m.mode === 'mod' ? 'cadre starts the agents' : 'Claude starts the agents'} (${m.why})` })
  if (isMs(s.plan) && s.drive.planner !== pl) await emit(h, 'drive.status', { state: 'mode', reason: `${pl ? "a planner agent drafts each epic's tasks" : "Claude drafts each epic's tasks"} (milestone.epicPlanner${pl || m.mode === 'mod' ? '' : ', drive.spawn main'})` })
}

DRIVE.sync = syncMode
DRIVE.wanted = async h => (await wanted(h, await cfgOf(h))).go.length   // the idle fallback (core/drive) asks this, never an import: drive and spawner would load each other

// what the spawner would start right now, before anything is held: the board's wants, the specifier's turn before a claim, each want's unit and model, then the
// same grant (task, unit, model and provider caps). spawnStep starts these; the idle fallback asks the same question, so the two can never disagree about "work to start"
export async function wanted(h: Host, cfg: Awaited<ReturnType<typeof cfgOf>>): Promise<{ go: Q.Want[]; cands: Q.Want[] }> {
  const s = await h.board.read()
  let cands = spawnable(modelView(s), await h.bind.read()).filter(x => !Q.has(x.id, x.role) && !(x.role !== 'claim' && Q.has(x.id, 'claim'))).map((x): Q.Want => ({ ...x, head: x.role !== 'claim' }))
  if (cfg.roles.specifier.enabled) {   // the specifier's turn before a claim: no task slot, and the task waits while it works (core/specifier)
    const sd = await resolveDeps(h)
    cands = (await Promise.all(cands.map(async x => { if (x.role !== 'claim') return x; const n = await specNeeded(h, sd, x.id).catch(() => 'claim' as const); return n === 'wait' ? null : n === 'specify' ? { ...x, role: 'specify', head: false } : x }))).filter((x): x is Q.Want => !!x)
  }
  const keyed = Object.keys(cfg.concurrency.models).length + Object.keys(cfg.concurrency.providers).length > 0, capped = ((cfg.units ?? []) as { concurrency?: number }[]).some(u => u.concurrency)
  const d = keyed || capped ? await resolveDeps(h) : undefined, units: Record<string, string> = {}   // routing and units are read only when a limit asks for them
  const unitOf = async (id: string) => pkgOf(d!, await d!.store.get(id))?.root ?? '.'
  if (d) {
    if (capped) for (const t of s.tasks.filter(Q.inSlot)) units[t.id] = await unitOf(t.id).catch(() => '.')
    for (const w of cands) { if (capped && w.role === 'claim') w.unit = await unitOf(w.id).catch(() => '.'); if (keyed) w.model = await modelFor(h, d, w.id, w.role).catch(() => undefined) }
  }
  const go = Q.grant(cfg, Q.providerOf(await h.env()), s, d ? await Q.running(h) : [], cands, units)
  return { go, cands }
}
// the picks in flight are core/queue's `held`: two turn ends at once never start one task's step twice (admission's CAS holds across sessions)
let gate: Promise<unknown> = Promise.resolve()
const picking = <T>(f: () => Promise<T>): Promise<T> => { const r = gate.then(f, f); gate = r.catch(() => {}); return r }   // ponytail: one process-wide queue; across sessions the drive CAS still decides
// the spawner's step at a turn end or /cadre: start every agent the board wants, within the slots (core/queue), counted against the drive bounds
export async function spawnStep(h: Host, event: string): Promise<void> {
  if (!FRAMES.includes(event) || !h.spawnAgent) throw new Error(`spawn refused: ${event} is not a frame an agent's events stay under`)
  await explores(h).catch((e: Error) => h.log(`explorers: ${e.message}`))   // never the tick's task spawns
  await syncMode(h)
  if (!modOn(await h.board.read()) || !(await ready(h))) return
  const t = await h.now(); await h.ui.update(u => ({ ...u, idleAt: t }))   // a sign of life: the watchdog's window starts over
  if (await land(h) && !(await ready(h))) return   // what landed may finish the run
  await sendQueued(h)   // a rework a close queued (a conflict on the plan tip): its worker is resumed now
  const cfg = await cfgOf(h), usd = (await h.usage?.().catch(() => undefined))?.cost?.usd
  const go = await picking(async () => {   // one frame of this process at a time: read the board, pick within the slots, count them on the drive (a CAS three frames would contend on)
    const { go, cands } = await wanted(h, cfg)
    await h.ui.update(u => (u.queued === cands.length - go.length ? u : { ...u, queued: cands.length - go.length }))   // the band's "queued n"
    for (const x of go) Q.hold(x)
    let ok = false; try { ok = go.length > 0 && (await tally(h, cfg, usd, go.length, go.some(x => x.role !== 'specify'))) } finally { if (!ok) for (const x of go) Q.drop(x.id, x.role) }   // refused or thrown: the picks go back
    return ok ? go : []
  })
  for (const [i, x] of go.entries()) {   // one pick's throw never leaks the picks after it
    await one(h, x.id, x.role).catch((e: Error) => h.log(`${x.id} not started: ${e.message}`))
    if ((await h.board.read()).drive.stopped) { for (const y of go.slice(i + 1)) Q.drop(y.id, y.role); break }   // a stopped drive starts nothing more
  }
  if (go.length && (await h.ui.read()).goal === IDLE) await h.ui.update(u => ({ ...u, goal: undefined }))   // the idle fallback is not needed: agents run
  if (event === 'turn.complete') await drive(h, cfg, usd, true)   // what is main's own, if anything: one turn (a command frame may not submit)
}
// close every task whose review passed (squash into its epic, actor mod), then complete what is done: an epic of a milestone, the milestone, or the plan.
// A close that fails (conflict, red on the plan tip) goes the usual way: its worker reworks it, past the cap it waits for the user. True when anything landed.
let landing = false, again = false   // one close at a time per session: two turn ends at once never squash one task twice (the other frame just spawns)
async function land(h: Host): Promise<boolean> {
  if (landing) { again = true; return false }   // a pass that came in while another frame lands: that frame looks once more (live: it read the board before the pass, nothing landed it after)
  landing = true
  try { let n = false; do { again = false; n = (await landAll(h)) || n } while (again); return n } finally { landing = false }
}
async function landAll(h: Host): Promise<boolean> {
  const d = await resolveDeps(h), closed = (st: string) => st === 'done' || st === 'cancelled'
  let n = 0
  for (const t of (await h.board.read()).tasks.filter(t => t.state === 'review' && gateAt(t.step) === 'integrate')) {
    if (!(await d.store.get(t.id)).meta['cadre.review']?.startsWith('pass@')) continue   // the verdict is mid-write (another turn end): its reviewer's own turn end lands it
    const e = await closeTask(h, d, t.id, 'mod').catch((x: Error) => x.message); if (e) h.log(`${t.id} not landed: ${e}`); else { n++; await told(h, `${t.id} "${t.title}" landed`) }
  }
  const s = await h.board.read(), es = s.plan?.epics ?? [], done = (ep?: string) => s.tasks.length > 0 && s.tasks.every(t => (ep && t.epic !== ep) || closed(t.state))
  const go = es.length ? [...es.filter(e => e.state === 'running' && s.tasks.some(t => t.epic === e.id) && done(e.id)).map(e => e.id), ...(es.every(e => e.state === 'landed') ? [s.plan!.id] : [])] : done() ? [s.plan!.id] : []
  for (const id of go) { const e = await integrateEpic(h, id); if (e) h.log(`${id} not completed: ${e}`); else { n++; await told(h, `${id === s.plan!.id ? `${es.length ? 'milestone' : 'plan'} ${id}` : `epic ${id}`} completed`) } }
  return n > 0
}
// main's digest (ADR 0018): one line per landing, handed over as context on main's next turn (core/briefs.context), never a turn of its own
export const told = (h: Host, line: string) => h.ui.update(u => ({ ...u, digest: [...((u.digest as string[]) ?? []), line].slice(-20) }))

// main's explore tool (core/plantools) queued questions: each starts one read-only explorer from this frame, in either mode; admission reads the question off the intent
async function explores(h: Host) {
  const q = ((await h.ui.read()).explore as string[] | undefined) ?? []; if (!q.length || life.ending) return
  await h.ui.update(u => ({ ...u, explore: undefined }))
  for (const [i, x] of q.entries()) {
    let n: string
    try { n = await intend(h, x, 'explore', await sessionOf(h)) } catch (e) { h.log(`explorer not started: ${e}`); return void await h.ui.update(u => ({ ...u, explore: [...q.slice(i), ...((u.explore as string[] | undefined) ?? [])] })) }   // not started: it and the rest wait for the next tick
    try { const r = await h.spawnAgent!({ prompt: modelText('agent-brief', n), description: 'explore' }); if (r?.deny) h.log(`explorer not started: ${r.deny}`) } catch (e) { h.log(`explorer not started: ${e}`) } finally { await settleIntent(h, n) }
  }
}
async function one(h: Host, id: string, role: string) {
  if (life.ending) return void Q.drop(id, role)   // the session is quitting: an agent started now would die with it, its claim left behind
  const n = await Promise.resolve().then(async () => intend(h, id, role, await sessionOf(h))).catch((e: Error) => { Q.drop(id, role); throw e })   // before the try: a throw here (sessionOf too) gives the pick back
  try {
    const r = await h.spawnAgent!({ prompt: modelText('agent-brief', n), description: `${role === 'claim' ? 'start' : role} ${id}` })   // PLAN-<epic>: admission starts its planner
    if (r?.agentId) await h.ui.update(u => ({ ...u, own: [...((u.own as string[]) ?? []), r.agentId!].slice(-100) }))   // its task-notification never reaches main (core/reuse.submit)
    if (r?.deny) h.log(`${id} not started: ${r.deny}`)   // a deny is admission's answer (a gate, a lease): the gate or the next turn end deals with it
  } catch (x) {   // admission undid the claim and rethrew: a refused model stops the run at once; else the task budget's startFails, at limits.startFails the run stops for the human
    if (x instanceof Q.ModelRefused) return void (await stop(h, x.message))
    const n = await charge(h, id, 'startFails'), max = (await cfgOf(h)).limits.startFails
    h.log(`${id} could not start (${n}/${max}): ${x}`); if (n >= max) await stop(h, `${id} could not start ${n} times: ${String(x).slice(0, 120)}`)
  } finally { Q.drop(id, role); await settleIntent(h, n) }
}
