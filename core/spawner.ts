// Mod mode (ADR 0018): cadre starts the task agents itself with $.agent.spawn; main plans, talks to the user and hears one line per landing.
// The re-entry rule: an agent started from a call outside a hook (timer, ui handler) runs with EVERY cadre hook left out (no guard, no report), and one started
// from registration #k leaves #k out for the agent's own events. So the spawn is made only from a frame whose event no agent raises inside its run
// (turn.complete: a subagent's is not nested, probed; command.run). hooks/register.ts gives h.spawnAgent only to those frames; spawnStep refuses any other.
import type { Host } from '../types'
import { DRIVE, cfgOf, storeOf } from './dispatch'
import { modelView } from './board'
import { spawnable } from './render'
import { IDLE, drive, modOn, ready, stop, tally } from './drive'
import { closeTask } from './close'
import { integrateEpic } from './integrate'
import { resolveDeps } from './admission'
import { emit } from './events'
import { modelText } from './say'

export const FRAMES = ['turn.complete', 'command.run']
// the session's mode: CADRE_SPAWN beats all (a bench or a cell); a one-shot `-p` run exits once no agent runs, before an agent's turn end could start the next one, so it is main's; else drive.spawn
export async function spawnMode(h: Host): Promise<{ mode: 'mod' | 'main'; why: string }> {
  const env = (await h.env()).CADRE_SPAWN
  if (env === 'mod' || env === 'main') return { mode: env, why: 'CADRE_SPAWN' }
  if ((await h.ui.read()).headless) return { mode: 'main', why: 'a non-interactive session ends when no agent runs' }
  return { mode: (await cfgOf(h)).drive.spawn === 'mod' ? 'mod' : 'main', why: 'drive.spawn' }
}
// the board says which mode runs while a run is on (main's context line and admission read it); a change is said once in Activity
export async function syncMode(h: Host): Promise<void> {
  const s = await h.board.read(); if (!s.drive.on) return
  const m = await spawnMode(h), v = m.mode === 'mod' ? 'mod' as const : undefined
  if (s.drive.spawn === v) return
  await h.board.update(x => ({ ...x, drive: { ...x.drive, spawn: v } })); await emit(h, 'drive.status', { state: 'mode', reason: `${m.mode === 'mod' ? 'cadre starts the agents' : 'Claude starts the agents'} (${m.why})` })
}

DRIVE.sync = syncMode

const inflight = new Set<string>()   // a per-task in-flight key: two turn ends at once never start one task twice (admission's CAS holds across sessions)
// the spawner's step at a turn end or /cadre: start every agent the board wants, within maxParallel, counted against the drive bounds
export async function spawnStep(h: Host, event: string): Promise<void> {
  if (!FRAMES.includes(event) || !h.spawnAgent) throw new Error(`spawn refused: ${event} is not a frame an agent's events stay under`)
  await syncMode(h)
  if (!modOn(await h.board.read()) || !(await ready(h))) return
  const t = await h.now(); await h.ui.update(u => ({ ...u, idleAt: t }))   // a sign of life: the watchdog's window starts over
  if (await land(h) && !(await ready(h))) return   // what landed may finish the run
  const s = await h.board.read(), cfg = await cfgOf(h), usd = (await h.usage?.().catch(() => undefined))?.cost?.usd
  let free = cfg.maxParallel > 0 ? cfg.maxParallel - s.tasks.filter(t => t.state === 'active').length : Infinity
  const go = spawnable(modelView(s), await h.bind.read()).filter(x => !inflight.has(x.id) && (x.role !== 'claim' || free-- > 0))
  if (go.length && (await tally(h, cfg, usd, go.length))) for (const x of go) await one(h, x.id, x.role)
  if (go.length && (await h.ui.read()).goal === IDLE) await h.ui.update(u => ({ ...u, goal: undefined }))   // the idle fallback is not needed: agents run
  if (event === 'turn.complete') await drive(h, cfg, usd, true)   // what is main's own, if anything: one turn (a command frame may not submit)
}
// close every task whose review passed (squash into its epic, actor mod), then complete what is done: an epic of a milestone, the milestone, or the plan.
// A close that fails (conflict, red on the plan tip) goes the usual way: its worker reworks it, past the cap it waits for the user. True when anything landed.
let landing = false   // one close at a time per session: two turn ends at once never squash one task twice (the other frame just spawns)
async function land(h: Host): Promise<boolean> {
  if (landing) return false
  landing = true
  try { return await landAll(h) } finally { landing = false }
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

async function one(h: Host, id: string, role: string) {
  inflight.add(id)
  try {
    const r = await h.spawnAgent!({ prompt: modelText('agent-brief', `TASK-${id}`), description: `${role === 'claim' ? 'start' : role} ${id}` })
    if (r?.agentId) await h.ui.update(u => ({ ...u, own: [...((u.own as string[]) ?? []), r.agentId!].slice(-100) }))   // its task-notification never reaches main (core/reuse.submit)
    if (r?.deny) h.log(`${id} not started: ${r.deny}`)   // a deny is admission's answer (a gate, a lease): the gate or the next turn end deals with it
  } catch (x) {   // admission undid the claim and rethrew: count it; the third failed start stops the run for the human
    const store = await storeOf(h), n = (Number((await store.get(id)).meta['cadre.attempts']) || 0) + 1
    await store.setMeta(id, { 'cadre.attempts': String(n) }, 'cadre')
    h.log(`${id} could not start (${n}/3): ${x}`); if (n >= 3) await stop(h, `${id} could not start ${n} times: ${String(x).slice(0, 120)}`)
  } finally { inflight.delete(id) }
}
