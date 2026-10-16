// Mod mode (ADR 0018): cadre starts the task agents itself with $.agent.spawn; main plans, talks to the user and hears one line per landing.
// The re-entry rule: an agent started from a call outside a hook (timer, ui handler) runs with EVERY cadre hook left out (no guard, no report), and one started
// from registration #k leaves #k out for the agent's own events. So the spawn is made only from a frame whose event no agent raises inside its run
// (turn.complete: a subagent's is not nested, probed; command.run). hooks/register.ts gives h.spawnAgent only to those frames; spawnStep refuses any other.
import type { Host } from '../types'
import { DRIVE, cfgOf, storeOf } from './dispatch'
import { headlessMain } from '../config/index'
import { modelView } from './board'
import { spawnable } from './render'
import { IDLE, drive, modOn, ready, stop, tally } from './drive'
import { closeTask } from './close'
import { integrateEpic } from './integrate'
import { resolveDeps } from './admission'
import { sendQueued } from './reuse'
import { life } from './session'
import { emit } from './events'
import { modelText } from './say'
import { isMs } from './milestone'
import { charge, intend, settleIntent } from './lifecycle'
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

const inflight = new Set<string>()
let gate: Promise<unknown> = Promise.resolve()
const picking = <T>(f: () => Promise<T>): Promise<T> => { const r = gate.then(f, f); gate = r.catch(() => {}); return r }   // ponytail: one process-wide queue; across sessions the drive CAS still decides   // `task:role` in flight: two turn ends at once never start one task's step twice (admission's CAS holds across sessions)
// the spawner's step at a turn end or /cadre: start every agent the board wants, within maxParallel, counted against the drive bounds
export async function spawnStep(h: Host, event: string): Promise<void> {
  if (!FRAMES.includes(event) || !h.spawnAgent) throw new Error(`spawn refused: ${event} is not a frame an agent's events stay under`)
  await explores(h)
  await syncMode(h)
  if (!modOn(await h.board.read()) || !(await ready(h))) return
  const t = await h.now(); await h.ui.update(u => ({ ...u, idleAt: t }))   // a sign of life: the watchdog's window starts over
  if (await land(h) && !(await ready(h))) return   // what landed may finish the run
  await sendQueued(h)   // a rework a close queued (a conflict on the plan tip): its worker is resumed now
  const cfg = await cfgOf(h), usd = (await h.usage?.().catch(() => undefined))?.cost?.usd
  const go = await picking(async () => {   // one frame of this process at a time: read the board, pick within maxParallel, count them on the drive (a CAS three frames would contend on)
    const s = await h.board.read()
    let free = cfg.maxParallel > 0 ? cfg.maxParallel - s.tasks.filter(t => t.state === 'active').length - [...inflight].filter(k => k.endsWith(':claim')).length : Infinity   // claims still starting count too
    const go = spawnable(modelView(s), await h.bind.read()).filter(x => !inflight.has(`${x.id}:${x.role}`) && (x.role !== 'claim' || free-- > 0))
    for (const x of go) inflight.add(`${x.id}:${x.role}`)
    let ok = false; try { ok = go.length > 0 && (await tally(h, cfg, usd, go.length)) } finally { if (!ok) for (const x of go) inflight.delete(`${x.id}:${x.role}`) }   // refused or thrown: the picks go back
    return ok ? go : []
  })
  for (const x of go) await one(h, x.id, x.role)
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
  for (const t of (await h.board.read()).tasks.filter(t => t.state === 'review' && t.step === 'merge')) {
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
  for (const x of q) {
    const n = await intend(h, x, 'explore', await sessionOf(h))
    try { const r = await h.spawnAgent!({ prompt: modelText('agent-brief', n), description: 'explore' }); if (r?.deny) h.log(`explorer not started: ${r.deny}`) } catch (e) { h.log(`explorer not started: ${e}`) } finally { await settleIntent(h, n) }
  }
}
async function one(h: Host, id: string, role: string) {
  if (life.ending) return void inflight.delete(`${id}:${role}`)   // the session is quitting: an agent started now would die with it, its claim left behind
  const k = `${id}:${role}`, n = await intend(h, id, role, await sessionOf(h)); inflight.add(k)
  try {
    const r = await h.spawnAgent!({ prompt: modelText('agent-brief', n), description: `${role === 'claim' ? 'start' : role} ${id}` })   // PLAN-<epic>: admission starts its planner
    if (r?.agentId) await h.ui.update(u => ({ ...u, own: [...((u.own as string[]) ?? []), r.agentId!].slice(-100) }))   // its task-notification never reaches main (core/reuse.submit)
    if (r?.deny) h.log(`${id} not started: ${r.deny}`)   // a deny is admission's answer (a gate, a lease): the gate or the next turn end deals with it
  } catch (x) {   // admission undid the claim and rethrew: the task budget's startFails; at limits.startFails the run stops for the human
    const n = await charge(h, id, 'startFails'), max = (await cfgOf(h)).limits.startFails
    h.log(`${id} could not start (${n}/${max}): ${x}`); if (n >= max) await stop(h, `${id} could not start ${n} times: ${String(x).slice(0, 120)}`)
  } finally { inflight.delete(k); await settleIntent(h, n) }
}
