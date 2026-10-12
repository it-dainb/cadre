// Agent-run setup and init (ADR 0010). `/cadre setup|init` hands MAIN one short brief that points at a guide; Claude does the work with visible tool calls under a
// scoped maintenance lease (policy/guards). cadre only CHECKS: at every main turn end while a run is active it re-runs the checks, redraws the checklist decision and,
// when something Claude owns still fails, sends ONE follow-up naming it (at most 3 per run; then the decision shows what is left and Retry).
import { modelText } from '../core/say'
import type { Host, Secret } from '../types'
import { fnv1a64 } from '../core/board'
import { ask, settle } from '../core/decide'
import { initItems, restoreIgnore, scoped, type Item } from './init'
import { setupItems } from './doctor'
import { LIMIT } from '../policy/guards'
import { RUN } from '../core/dispatch'
import { goal as goalBrief, sendBrief } from '../core/lanes'
import { diff as jdiff } from '../policy/settings'

type Kind = 'setup' | 'init'
const G: Record<Item['st'], string> = { ok: '✓', fail: '✗', wait: '…', todo: '·', warn: '!' }
const items = (h: Host, k: Kind, quick = false) => (k === 'setup' ? setupItems(h) : initItems(h, { quick }))
const finished = (its: Item[]) => its.every(i => i.st === 'ok' || i.st === 'warn')
const WHAT = { setup: 'Set up cadre on this machine', init: 'Set up cadre in this project' }

const end = async (h: Host, done = false) => { if (done) { await h.store.del(await scoped(h, 'run')); await h.ui.update(({ halt: _x, ...u }) => u) } await h.secret.update(({ run: _r, ...s }) => s) }   // done: finished or cancelled; a stopped run stays open (halted)
// a run started here and never finished (Claude Code quit or was killed mid-run, or it stopped): kept in $.store, as session memory goes with the session. None while a run is on.
type Halt = { kind: Kind; goal?: { text: string; mode: 'auto' | 'yolo' } }
const mark = async (h: Host, r: Halt) => h.store.set(await scoped(h, 'run'), r)
export const halted = async (h: Host) => ((await h.secret.read()).run ? undefined : ((await h.store.get(await scoped(h, 'run'))) as Halt | undefined))
export const haltText = (r: Halt) => `Setup was interrupted · /cadre ${r.goal ? r.goal.text.slice(0, 80) : r.kind === 'setup' ? 'setup' : '<goal>'} to pick it up`
export async function halt(h: Host): Promise<void> { const r = await halted(h); if (r) await h.ui.update(u => ({ ...u, halt: haltText(r) })) }   // session.start: the band says it (ui/v2/band)
// $.prompt.submit is refused from a command or a press frame, and $.clock.after inherits that frame (live, 0.7.0). So a brief waits in the run (`brief`)
// and goes out from main's turn end or the session's 5 s timer (pump); it starts once the session is idle.
const send = (h: Host, brief: string) => h.secret.update(s => (s.run ? { ...s, run: { ...s.run, brief } } : s))
export async function pump(h: Host): Promise<void> {
  let text: string | undefined; await h.secret.update(s => { text = s.run?.brief; return text ? { ...s, run: { ...s.run!, brief: undefined } } : s })
  if (text) await h.submit?.(modelText('brief', text)).catch((e: Error) => h.log(`could not hand the step to Claude: ${e.message.slice(0, 120)}`))
  await sendBrief(h)   // a `/cadre <goal>` brief (core/lanes)
}

async function draw(h: Host, k: Kind, its: Item[], state: 'on' | 'stopped' | 'done', note?: string): Promise<void> {
  const n = its.filter(i => i.st === 'ok' || i.st === 'warn').length, human = !its.some(i => i.st === 'fail') && its.some(i => i.st === 'wait')
  const title = state === 'done' ? `${k} · all done` : state === 'stopped' ? `${k} · Claude stopped · ${its.length - n} left` : `${k} · ${n}/${its.length} done · ${human ? 'needs you' : 'Claude is on it'}`
  const lines = [...(note ? note.split('\n') : []), ...its.map(i => `${G[i.st]} ${i.name}${i.why ? `: ${i.why}` : ''}`)]
  await ask(h, { id: `run:${k}`, kind: 'init', title, short: title, lines, hash: fnv1a64(title + lines.join('\n')), tab: 'epic', ...(state === 'done' || (state === 'on' && (!human || (await h.secret.read()).run?.goal)) ? { quiet: true as const } : {}),   // done: shown in the pane, never a "needs you"   // a goal run: the human's cards (safety, then mission + plan) pop themselves; the checklist never does
    options: state === 'stopped' ? [{ key: 'r', label: 'Let Claude try again', verb: 'change', run: `${k} retry` }, { key: 'x', label: `Stop ${k === 'init' ? 'setup' : k}`, verb: 'reject', run: `${k} cancel` }]
      : [{ key: 'x', label: state === 'done' ? 'Close' : 'Cancel', verb: 'reject', run: `${k} cancel` }] })
}
// where in the guide each check is done (guides/init.md phases)
const PHASE: Record<string, string> = { repository: 'phase 1', 'task store': 'phase 2', mission: 'phase 3', 'build and test commands': 'phase 4', 'commands pass on a clean checkout': 'phase 4', workflow: 'phase 4', changelog: 'phase 5' }
const redList = (fails: Item[]) => fails.map((i, n) => `${n + 1}. ${i.name}${i.why ? `: ${i.why}` : ''}${PHASE[i.name] ? ` (${PHASE[i.name]})` : ''}`)
const followUp = async (h: Host, k: Kind, fails: Item[], guide: string) => [
  'Setup is not done: these checks still fail.', ...redList(fails),
  `Fix them now, following ${guide}. If you cannot fix one, say which one and why, then stop.`,
].join('\n').replaceAll(`${await h.home()}/`, '~/')
// Claude stopped with checks still red and cannot go on (refused 3 times, or it stopped without trying again): ONE dialog for the human, never a silent "running"
async function stuck(h: Host, r: NonNullable<Secret['run']>, its: Item[], why: string): Promise<string> {
  await end(h); await h.ui.update(u => ({ ...u, retry: { kind: r.kind, goal: r.goal } }))   // "Let Claude try again" starts the same run, the goal still queued
  const said = (r.said ?? '').replace(/\s+/g, ' ').trim()
  await draw(h, r.kind, its, 'stopped', [why, ...(said ? [`Claude: "${said.slice(0, 200)}${said.length > 200 ? '…' : ''}"`] : [])].join('\n'))
  return `${r.kind}: stopped · press 1`
}

// `/cadre setup` | `/cadre init` (human origin only: core/dispatch). Nothing open: done at once. Else the lease starts and main gets the brief.
// `goal` (the onboarding dialog's Set up, commands/cadre): init skips the mission question (drafted with the plan) and the goal flow follows once every check passes (ADR 0014)
export async function start(h: Host, k: Kind, goal?: { text: string; mode: 'auto' | 'yolo' }): Promise<string> {
  if (goal) await settle(h, 'init:goal')
  const at = await h.now(); await h.secret.update(s => ({ ...s, run: { kind: k, at, turns: 0, follow: 0, guide: '', snap: {}, ...(goal ? { goal } : {}) } }))   // before the checks: mission waits for the plan in a goal run
  const its = await items(h, k)
  if (finished(its)) { await end(h, true); await settle(h, `run:${k}`); if (goal) { await goalBrief(h, goal.text, goal.mode); return `${k}: all done · ${goal.mode === 'yolo' ? 'yolo · ' : ''}Claude plans your goal` } return `${k}: all done` }
  const guide = `${(await h.root?.()) ?? '.'}/guides/${k}.md`; await mark(h, { kind: k, ...(goal ? { goal } : {}) })
  const gi = k === 'init' && its.find(i => i.name === 'task store')?.st !== 'ok' ? await h.readText(`${await h.cwd()}/.gitignore`) : undefined   // this run will init the task store: keep the .gitignore bytes (init.restoreIgnore)
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, guide, ...(gi !== undefined ? { gi: { had: gi !== null, text: gi ?? '' } } : {}) } } : s)); await resnap(h)
  await draw(h, k, its, 'on')
  await send(h, goal ? `${WHAT[k]}, then plan the user's goal (it comes next). Follow ${guide} step by step. Skip the mission question: you draft the mission together with the plan.` : `${WHAT[k]}. Follow ${guide} step by step.`)
  return `${k}: Claude is on it · progress in the cadre pane${goal ? ' · then your goal' : ''}`
}
// re-check now (a main turn ended, or the human answered a gate in the dialog): done ends the run; a failure Claude owns gets a follow-up; the limits stop it
export async function recheck(h: Host, turn = false, ended = turn): Promise<string> {   // ended: Claude stopped (its turn end, or the watchdog); a human answer only re-checks
  const r = (await h.secret.read()).run; if (!r) return ''
  if (await moved(h, r)) return `${r.kind}: stopped · a settings file changed · press 1`
  const k = r.kind, its = await items(h, k), fails = its.filter(i => i.st === 'fail'), turns = r.turns + (turn ? 1 : 0)
  if (finished(its)) await restoreIgnore(h)
  if (finished(its) && r.goal) { await end(h, true); await settle(h, `run:${k}`); await goalBrief(h, r.goal.text, r.goal.mode); h.toast('init done · Claude plans your goal'); return `${k}: all done · Claude plans your goal` }   // no "all done" dialog: the plan's dialog is next
  if (finished(its)) { await end(h, true); await draw(h, k, its, 'done'); h.toast(`cadre: ${k} done`); return `${k}: all done` }
  const out = turns >= LIMIT.turns || (await h.now()) - r.at >= LIMIT.ms
  if (out) return stuck(h, r, its, 'the time or turn limit was reached')
  if (fails.length && ended && (r.follow >= LIMIT.follow || r.stopSeen)) return stuck(h, r, its, r.follow >= LIMIT.follow ? 'Claude stopped 3 times with checks still failing' : 'Claude stopped with checks still failing')   // stopSeen: the stop check let it stop (it said it cannot go on)
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, turns, follow: s.run.follow + (fails.length && ended ? 1 : 0) } } : s))
  await draw(h, k, its, 'on')
  if (fails.length && ended) await send(h, await followUp(h, k, fails, r.guide))   // Claude is still at work otherwise: its stop is checked when it comes
  if (turn) await pump(h)
  return `${k}: ${fails.length ? 'Claude is on it' : 'waiting for you · press 1'}`
}
// main's turn.complete (register.ts): works in dormant repos too
export async function turnEnd(h: Host, e: { agentId?: string; answer?: string }): Promise<void> {
  if (e.agentId || !(await h.secret.read()).run) return
  const now = await h.now(); await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, busy: false, seen: now, ...(e.answer ? { said: e.answer } : {}) } } : s))
  await recheck(h, true)
}
// main's turn.start / tool.call (register.ts): the watchdog's clock, and the tool count the stop check reads
export async function seen(h: Host, o: { start?: boolean; tool?: boolean } = {}): Promise<void> {
  if (!(await h.secret.read()).run) return
  const now = await h.now(); await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, seen: now, ...(o.start ? { busy: true } : {}), ...(o.tool ? { tools: (s.run.tools ?? 0) + 1 } : {}) } } : s))
}

// ---- Claude's stop during a run (classic Stop): while a check Claude owns is red, the stop is refused with the list (at most 3 per run). A second stop with no tool
// call since the last refusal is Claude saying it cannot go on: it may stop, and its turn end shows the human the dialog. Where classic hooks are off (managed
// machines) this never runs and the turn end sends the same list as a follow-up instead. ----
export async function stopCheck(h: Host, e: { last_assistant_message?: string }): Promise<string | null> {
  const r = (await h.secret.read()).run; if (!r) return null
  const fails = (await items(h, r.kind)).filter(i => i.st === 'fail')
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, stopSeen: true, ...(e.last_assistant_message ? { said: e.last_assistant_message } : {}) } } : s))
  if (!fails.length || r.follow >= LIMIT.follow || (r.follow > 0 && !r.tools)) return null
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, follow: s.run.follow + 1, tools: 0 } } : s))
  return followUp(h, r.kind, fails, r.guide)
}
// ---- after each of main's tool calls in a run: one line naming what is still red (no clean-checkout run, no proposal) ----
export async function redNote(h: Host): Promise<string | null> {
  const r = (await h.secret.read()).run; if (!r) return null
  const fails = (await items(h, r.kind, true)).filter(i => i.st === 'fail')
  return fails.length ? `setup still open: ${fails.map(i => `${i.name}${i.why ? ` (${i.why})` : ''}`).join('; ')}`.replaceAll(`${await h.home()}/`, '~/') : null
}
// ---- the watchdog (the 5 s tick): a run whose main has been quiet for a while is checked as if Claude had stopped. A missed turn end (live: a run sat in "running"
// with nothing working) still ends in a follow-up or the dialog. Quiet = no turn on for 60 s, or a turn on with no step or tool call for 10 minutes. ----
export const QUIET = { idle: 60_000, busy: 600_000 }
export async function watch(h: Host): Promise<void> {
  const r = (await h.secret.read()).run; if (!r || r.brief) return   // a brief waiting goes out first (pump)
  const since = (await h.now()) - (r.seen ?? r.at)
  if (since < (r.busy ? QUIET.busy : QUIET.idle)) return
  if (((await h.board.read()).decisions ?? []).some(d => !d.quiet)) return   // the human has something to answer: that is not a stall
  await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, busy: false } } : s)); await seen(h)
  await recheck(h, false, true)
}
// `/cadre setup|init cancel` (core/dispatch): the lease ends and the decision goes
export async function cancel(h: Host, k: string): Promise<void> { if ((await h.secret.read()).run?.kind === k || (await halted(h))?.kind === k) await end(h, true); await settle(h, `run:${k}`) }

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
  await settle(h, `run:${r.kind}`); h.log(`settings-changed: ${changed.map(c => rel(c[0])).join(', ')}`)
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
export const queue = async (h: Host, goal: NonNullable<Halt['goal']>) => { const r = (await h.secret.read()).run; if (r) { await h.secret.update(s => (s.run ? { ...s, run: { ...s.run, goal } } : s)); await mark(h, { kind: r.kind, goal }) } }   // a goal typed while the run is on: after it (commands/cadre.later)
