// Mod mode (ADR 0018): cadre starts the task agents itself with $.agent.spawn; main plans, talks to the user and hears one line per landing.
// The re-entry rule: an agent started from a call outside a hook (timer, ui handler) runs with EVERY cadre hook left out (no guard, no report), and one started
// from registration #k leaves #k out for the agent's own events. So the spawn is made only from a frame whose event no agent raises inside its run
// (turn.complete: a subagent's is not nested, probed; command.run). hooks/register.ts gives h.spawnAgent only to those frames; spawnStep refuses any other.
import type { Host } from '../types'
import { DRIVE, cfgOf, storeOf } from './dispatch'
import { modelView } from './board'
import { spawnable } from './render'
import { modOn, ready, stop, tally } from './drive'
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
  const s = await h.board.read(), cfg = await cfgOf(h)
  let free = cfg.maxParallel > 0 ? cfg.maxParallel - s.tasks.filter(t => t.state === 'active').length : Infinity
  const go = spawnable(modelView(s), await h.bind.read()).filter(x => !inflight.has(x.id) && (x.role !== 'claim' || free-- > 0))
  if (!go.length || !(await tally(h, cfg, (await h.usage?.().catch(() => undefined))?.cost?.usd, go.length))) return
  for (const x of go) await one(h, x.id, x.role)
}
async function one(h: Host, id: string, role: string) {
  inflight.add(id)
  try {
    const r = await h.spawnAgent!({ prompt: modelText('agent-brief', `TASK-${id}`), description: `${role === 'claim' ? 'start' : role} ${id}` })
    if (r?.deny) h.log(`${id} not started: ${r.deny}`)   // a deny is admission's answer (a gate, a lease): the gate or the next turn end deals with it
  } catch (x) {   // admission undid the claim and rethrew: count it; the third failed start stops the run for the human
    const store = await storeOf(h), n = (Number((await store.get(id)).meta['cadre.attempts']) || 0) + 1
    await store.setMeta(id, { 'cadre.attempts': String(n) }, 'cadre')
    h.log(`${id} could not start (${n}/3): ${x}`); if (n >= 3) await stop(h, `${id} could not start ${n} times: ${String(x).slice(0, 120)}`)
  } finally { inflight.delete(id) }
}
