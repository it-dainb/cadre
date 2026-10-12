// Agent-run setup and init (ADR 0010). `/cadre setup|init` hands MAIN one short brief that points at a guide; Claude does the work with visible tool calls under a
// scoped maintenance lease (policy/guards). cadre only CHECKS: at every main turn end while a run is active it re-runs the checks, redraws the checklist card and,
// when something Claude owns still fails, sends ONE follow-up naming it (at most 3 per run; then the card shows what is left and [r] Retry).
import type { Host } from '../types'
import { fnv1a64 } from '../core/board'
import { ask, settle } from '../core/decide'
import { initItems, type Item } from './init'
import { setupItems } from './doctor'
import { LIMIT } from '../policy/guards'
import { RUN } from '../core/dispatch'

type Kind = 'setup' | 'init'
const G: Record<Item['st'], string> = { ok: '✓', fail: '✗', wait: '…', todo: '·', warn: '!' }
const items = (h: Host, k: Kind) => (k === 'setup' ? setupItems(h) : initItems(h))
const finished = (its: Item[]) => its.every(i => i.st === 'ok' || i.st === 'warn')
const WHAT = { setup: 'Set up cadre on this machine', init: 'Set up cadre in this project' }

const end = (h: Host) => h.secret.update(({ run: _r, ...s }) => s)
// $.prompt.submit is refused while a command holds the turn (PC-05): a timer has no hook frame, so the brief goes from there; it starts once the session is idle
const send = (h: Host, text: string) => { const go = () => h.submit?.(text); if (h.ops) h.ops.after(1, go); else void Promise.resolve().then(go).catch(() => {}) }

async function draw(h: Host, k: Kind, its: Item[], state: 'on' | 'stopped' | 'done', note?: string): Promise<void> {
  const n = its.filter(i => i.st === 'ok' || i.st === 'warn').length, human = !its.some(i => i.st === 'fail') && its.some(i => i.st === 'wait')
  const title = state === 'done' ? `${k} · all done` : state === 'stopped' ? `${k} · stopped · ${its.length - n} left` : `${k} · ${n}/${its.length} done · ${human ? 'needs you' : 'Claude is on it'}`
  const lines = [...(note ? [note] : []), ...its.map(i => `${G[i.st]} ${i.name}${i.why ? `: ${i.why}` : ''}`)]
  await ask(h, { id: `run:${k}`, kind: 'init', title, short: title, lines, hash: fnv1a64(title + lines.join('\n')), tab: 'epic', fallback: `/cadre ${k}`,
    options: [...(state === 'stopped' ? [{ key: 'r', label: 'Retry', verb: 'change', run: k }] : []), { key: 'x', label: state === 'done' ? 'Close' : 'Cancel', verb: 'reject', run: `${k} cancel` }] })
}
const followUp = async (h: Host, k: Kind, fails: Item[], guide: string) => [
  'Some steps are still open. Each item below must pass:', ...fails.map((i, n) => `${n + 1}. ${i.name}${i.why ? `: ${i.why}` : ''}`),
  `Keep following ${guide}. When you are done, stop; the checks run again on their own.`,
].join('\n').replaceAll(`${await h.home()}/`, '~/')

// `/cadre setup` | `/cadre init` (human origin only: core/dispatch). Nothing open: done at once. Else the lease starts and main gets the brief.
export async function start(h: Host, k: Kind): Promise<string> {
  const its = await items(h, k)
  if (finished(its)) { await end(h); await settle(h, `run:${k}`); return `${k}: all done` }
  const guide = `${(await h.root?.()) ?? '.'}/guides/${k}.md`
  const at = await h.now(); await h.secret.update(s => ({ ...s, run: { kind: k, at, turns: 0, follow: 0, guide } }))
  await draw(h, k, its, 'on')
  send(h, `${WHAT[k]}. Follow ${guide} step by step.`)
  return `${k}: Claude is on it · progress on the cadre card`
}
// re-check now (a main turn ended, or the human answered a gate on its card): done ends the run; a failure Claude owns gets a follow-up; the limits stop it
export async function recheck(h: Host, turn = false): Promise<string> {
  const r = (await h.secret.read()).run; if (!r) return ''
  const k = r.kind, its = await items(h, k), fails = its.filter(i => i.st === 'fail'), turns = r.turns + (turn ? 1 : 0)
  if (finished(its)) { await end(h); await draw(h, k, its, 'done'); h.toast(`cadre: ${k} done`); return `${k}: all done` }
  const out = turns >= LIMIT.turns || (await h.now()) - r.at >= LIMIT.ms
  if (out || (fails.length && r.follow >= LIMIT.follow)) { await end(h); await draw(h, k, its, 'stopped', out ? 'the time or turn limit was reached' : 'Claude stopped with steps still open'); return `${k}: stopped · see the card` }
  await h.secret.update(s => ({ ...s, run: { ...r, turns, follow: r.follow + (fails.length ? 1 : 0) } }))
  await draw(h, k, its, 'on')
  if (fails.length) send(h, await followUp(h, k, fails, r.guide))
  return `${k}: ${fails.length ? 'Claude is on it' : 'waiting for you on the card'}`
}
// main's turn.complete (register.ts): works in dormant repos too
export async function turnEnd(h: Host, e: { agentId?: string }): Promise<void> { if (!e.agentId && (await h.secret.read()).run) await recheck(h, true) }
// `/cadre setup|init cancel` (core/dispatch): the lease ends and the card goes
export async function cancel(h: Host, k: string): Promise<void> { if ((await h.secret.read()).run?.kind === k) await end(h); await settle(h, `run:${k}`) }
RUN.recheck = h => recheck(h); RUN.cancel = cancel
