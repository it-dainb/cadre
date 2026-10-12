// Agent-run setup and init (ADR 0010). `/cadre setup|init` hands MAIN one short brief that points at a guide; Claude does the work with visible tool calls under a
// scoped maintenance lease (policy/guards). cadre only CHECKS: at every main turn end while a run is active it re-runs the checks, redraws the checklist decision and,
// when something Claude owns still fails, sends ONE follow-up naming it (at most 3 per run; then the decision shows what is left and Retry).
import type { Host, Secret } from '../types'
import { fnv1a64 } from '../core/board'
import { ask, settle } from '../core/decide'
import { initItems, type Item } from './init'
import { setupItems } from './doctor'
import { LIMIT } from '../policy/guards'
import { RUN } from '../core/dispatch'
import { sendBrief } from '../core/lanes'
import { diff as jdiff } from '../policy/settings'

type Kind = 'setup' | 'init'
const G: Record<Item['st'], string> = { ok: '✓', fail: '✗', wait: '…', todo: '·', warn: '!' }
const items = (h: Host, k: Kind) => (k === 'setup' ? setupItems(h) : initItems(h))
const finished = (its: Item[]) => its.every(i => i.st === 'ok' || i.st === 'warn')
const WHAT = { setup: 'Set up cadre on this machine', init: 'Set up cadre in this project' }

const end = (h: Host) => h.secret.update(({ run: _r, ...s }) => s)
// $.prompt.submit is refused from a command or a press frame, and $.clock.after inherits that frame (live, 0.7.0). So a brief waits in the run (`brief`)
// and goes out from main's turn end or the session's 5 s timer (pump); it starts once the session is idle.
const send = (h: Host, brief: string) => h.secret.update(s => (s.run ? { ...s, run: { ...s.run, brief } } : s))
export async function pump(h: Host): Promise<void> {
  let text: string | undefined; await h.secret.update(s => { text = s.run?.brief; return text ? { ...s, run: { ...s.run!, brief: undefined } } : s })
  if (text) await h.submit?.(text).catch((e: Error) => h.log(`cadre: could not hand the step to Claude: ${e.message.slice(0, 120)}`))
  await sendBrief(h)   // a `/cadre <goal>` brief (core/lanes)
}

async function draw(h: Host, k: Kind, its: Item[], state: 'on' | 'stopped' | 'done', note?: string): Promise<void> {
  const n = its.filter(i => i.st === 'ok' || i.st === 'warn').length, human = !its.some(i => i.st === 'fail') && its.some(i => i.st === 'wait')
  const title = state === 'done' ? `${k} · all done` : state === 'stopped' ? `${k} · stopped · ${its.length - n} left` : `${k} · ${n}/${its.length} done · ${human ? 'needs you' : 'Claude is on it'}`
  const lines = [...(note ? [note] : []), ...its.map(i => `${G[i.st]} ${i.name}${i.why ? `: ${i.why}` : ''}`)]
  await ask(h, { id: `run:${k}`, kind: 'init', title, short: title, lines, hash: fnv1a64(title + lines.join('\n')), tab: 'epic', ...(state === 'on' && !human ? { quiet: true as const } : {}),
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
  const at = await h.now(); await h.secret.update(s => ({ ...s, run: { kind: k, at, turns: 0, follow: 0, guide, snap: {} } })); await resnap(h)
  await draw(h, k, its, 'on')
  await send(h, `${WHAT[k]}. Follow ${guide} step by step.`)
  return `${k}: Claude is on it · progress in the cadre pane`
}
// re-check now (a main turn ended, or the human answered a gate in the dialog): done ends the run; a failure Claude owns gets a follow-up; the limits stop it
export async function recheck(h: Host, turn = false): Promise<string> {
  const r = (await h.secret.read()).run; if (!r) return ''
  if (await moved(h, r)) return `${r.kind}: stopped · a settings file changed · press 1`
  const k = r.kind, its = await items(h, k), fails = its.filter(i => i.st === 'fail'), turns = r.turns + (turn ? 1 : 0)
  if (finished(its)) { await end(h); await draw(h, k, its, 'done'); h.toast(`cadre: ${k} done`); return `${k}: all done` }
  const out = turns >= LIMIT.turns || (await h.now()) - r.at >= LIMIT.ms
  if (out || (fails.length && r.follow >= LIMIT.follow)) { await end(h); await draw(h, k, its, 'stopped', out ? 'the time or turn limit was reached' : 'Claude stopped with steps still open'); return `${k}: stopped · press 1` }
  await h.secret.update(s => ({ ...s, run: { ...r, turns, follow: r.follow + (fails.length ? 1 : 0) } }))
  await draw(h, k, its, 'on')
  if (fails.length) await send(h, await followUp(h, k, fails, r.guide))
  if (turn) await pump(h)
  return `${k}: ${fails.length ? 'Claude is on it' : 'waiting for you · press 1'}`
}
// main's turn.complete (register.ts): works in dormant repos too
export async function turnEnd(h: Host, e: { agentId?: string }): Promise<void> { if (!e.agentId && (await h.secret.read()).run) await recheck(h, true) }
// `/cadre setup|init cancel` (core/dispatch): the lease ends and the decision goes
export async function cancel(h: Host, k: string): Promise<void> { if ((await h.secret.read()).run?.kind === k) await end(h); await settle(h, `run:${k}`) }

// ---- settings watch (ADR 0010): Bash under the lease could still write a settings file. Their bytes are kept when the run starts and after each of cadre's
// own confirmed writes (resnap); any other change stops the run with a CRIT decision: Restore the kept bytes (the changed file is kept as .cadre-changed) or [k] Keep.
const watched = async (h: Host) => [`${await h.home()}/.claude/settings.json`, `${await h.cwd()}/.claude/settings.local.json`]
export async function resnap(h: Host): Promise<void> {
  const snap: Record<string, string | null> = {}; for (const p of await watched(h)) snap[p] = await h.readText(p)
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, snap } } : s))
}
const parse = (t: string | null) => { try { return t ? JSON.parse(t) : {} } catch { return { '(not valid JSON)': true } } }
async function moved(h: Host, r: NonNullable<Secret['run']>): Promise<boolean> {
  const changed: [string, string | null, string | null][] = []
  for (const [p, was] of Object.entries(r.snap ?? {})) { const now = await h.readText(p); if (now !== was) changed.push([p, was, now]) }
  if (!changed.length) return false
  const home = await h.home(), cwd = await h.cwd(), rel = (p: string) => p.replace(`${home}/`, '~/').replace(`${cwd}/`, '')
  await end(h); await h.secret.update(s => ({ ...s, hold: { kind: r.kind, files: Object.fromEntries(changed.map(([p, was]) => [p, was])) } }))
  const lines = ['A settings file changed outside cadre during the run. The run stopped.', ...changed.flatMap(([p, was, now]) => [`${rel(p)}:`, ...jdiff(parse(was), parse(now)).slice(0, 10).map(l => `  ${l}`)]), 'Restore puts back the bytes from before (the changed file is kept as .cadre-changed).']
  await settle(h, `run:${r.kind}`); h.log(`cadre: settings-changed: ${changed.map(c => rel(c[0])).join(', ')}`)
  await ask(h, { id: 'run:settings', kind: 'flag', title: `settings-changed · ${r.kind} stopped`, short: 'settings changed', lines, hash: fnv1a64(lines.join('\n')), tab: 'epic', crit: true,
    options: [{ key: 'r', label: 'Restore', verb: 'restore', run: `${r.kind} restore` }, { key: 'k', label: 'Keep', verb: 'keep', run: `${r.kind} keep` }] })
  return true
}
// `/cadre setup|init restore|keep` (human only: core/dispatch)
export async function settingsAnswer(h: Host, how: 'restore' | 'keep'): Promise<string> {
  const hold = (await h.secret.read()).hold; if (!hold) return 'nothing to restore'
  if (how === 'restore') for (const [p, was] of Object.entries(hold.files)) { const now = await h.readText(p); if (now !== null) await h.write(`${p}.cadre-changed`, now); await h.write(p, was ?? '{}\n') }
  await h.secret.update(({ hold: _h, ...s }) => s); await settle(h, 'run:settings')
  return `${hold.kind}: settings ${how === 'restore' ? 'restored' : 'kept'} · run /cadre ${hold.kind} to go on`
}
RUN.recheck = h => recheck(h); RUN.cancel = cancel
