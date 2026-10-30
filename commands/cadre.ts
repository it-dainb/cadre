// /cadre <sub> (DESIGN 5.3): parse text into a dispatcher command (core/dispatch is the only entry). Queue/state-by-CAS only: never submits or spawns (P4, G6).
import type { Hook, Host } from '../types'
import type { Command, Out } from '../core/dispatch'
import { ROUTES, answer, cfgOf, dispatch, isHuman, restore, storeOf } from '../core/dispatch'
import { changeLane, dropGoal, goal } from '../core/lanes'
import { unfinished, wake, warm } from '../core/session'
import { describe } from '../core/profile'
import { ask } from '../core/decide'
import { fnv1a64 } from '../core/board'
import { modelText } from '../core/say'
import { autoAsk, openPane } from '../ui/index'
import { needsOf, stepName } from '../ui/v2/facts'
import { read } from '../ui/model'
import { confirm as initConfirm } from './init'
import { confirmUnset, confirmUser, doctor, keepUser } from './doctor'
import { halted, haltText, pump, queue, recheck, resnap, settingsAnswer, start } from './agentrun'
import { confirmPrefs } from './prefs'
import { defaults } from '../config/index'
import { metricsOf, metricsText } from '../core/reuse'
import { deepLine } from '../core/clarify'

export async function route(h: Host, c: Command): Promise<Out> {   // every dispatcher command (dialog answers, Settings presses; tests)
  const [a] = c.args
  if ((c.cmd === 'goal' || c.cmd === 'yolo') && c.origin.kind === 'composer' && (await settingUp(h))) return later(h, a ?? '', c.cmd === 'yolo')
  if ((c.cmd === 'goal' || c.cmd === 'yolo') && c.origin.kind === 'composer' && (await halted(h))?.kind === 'init') return { text: await start(h, 'init', { text: a ?? '', mode: c.cmd === 'yolo' || (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto' }) }   // an interrupted project setup picks up, then this goal
  if (!['setup', 'doctor', 'init', 'open', 'profile'].includes(c.cmd) && !(await wake(h))) return (c.cmd === 'goal' || c.cmd === 'yolo') && c.origin.kind === 'composer' ? onboard(h, a ?? '', c.cmd === 'yolo') : { text: await status(h) }   // per-repo opt-in: typing a goal here is the opt-in (ADR 0014)
  switch (c.cmd) {
    case 'open': await openPane(h, a ?? 'epic'); return { text: `Opened the cadre pane (${a ?? 'epic'}).` }
    case 'restore': return restore(h, a)
    case 'init': case 'setup': {   // Claude does the work (ADR 0010); the checklist and the containment confirm are decisions (ADR 0012)
      const conf = a === 'prefs' && c.args[1] === 'confirm' ? confirmPrefs : a === 'confirm' ? (c.cmd === 'init' ? initConfirm : confirmUser) : undefined
      const rt = a === 'retry' ? (await h.ui.read()).retry as { goal?: { text: string; mode: 'auto' | 'yolo' }; follow?: number } | undefined : undefined
      const text = a === 'restore' || a === 'keep' ? await settingsAnswer(h, a)
        : a === 'mine' ? await keepUser(h) : a === 'unset' || a === 'keepunset' ? await confirmUnset(h, a === 'keepunset')   // Doctor's settings cards (commands/doctor)
        : a === 'retry' ? await start(h, c.cmd, rt?.goal, rt?.follow ?? 0).then(async t => (await pump(h, true), t))   // "Let Claude try again": the same run, the goal still queued, its stop refusals spent; the step goes from the human's answer (agentrun.pump)
        : conf ? [await conf(h), await resnap(h).then(() => recheck(h))].filter(Boolean).join(' · ')   // cadre's own confirmed write is not a change from outside
        : await start(h, c.cmd, c.cmd === 'init' && a === 'goal' ? ((await h.ui.read()).onboard as { text: string; mode: 'auto' | 'yolo' } | undefined) : undefined)   // `init goal`: the "Set up" answer of the onboarding dialog
      await autoAsk(h).catch(() => {})   // a new decision pops once
      return { text }
    }
    case 'doctor': return { text: await doctor(h) }
    case 'profile': return { text: await describe(h) }   // read-only: no editing UI in 2.0; it works in a repo whose profile is refused
    case 'timeline': {   // H12: the per-repo metrics as text, the records exported under the project (never a host path in the reply)
      const p = '.cadre/tmp/timeline.json'; if (!['composer', 'press', 'dialog'].includes(c.origin.kind)) return { text: `refused: origin ${c.origin.kind} cannot export the timeline; type /cadre timeline in the prompt` }   // the human's own command, like init/setup
      const rs = await metricsOf(h); await h.write(`${await h.cwd()}/${p}`, JSON.stringify(rs, null, 1)); return { text: modelText('context', `${metricsText(rs)} · exported to ${p}`) }
    }
    case 'deep': return { text: c.origin.kind === 'composer' ? await goal(h, a ?? '', (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto', true) : `refused: origin ${c.origin.kind} cannot start a goal; type it in the prompt` }   // ADR 0020: questions before the plan, even when drive.mode is yolo (the mode applies after approval)
    case 'goal': case 'yolo': return { text: c.cmd === 'goal' && a === 'drop' && !isHuman(c.origin) ? await dropGoal(h) : c.origin.kind === 'composer' ? await goal(h, a ?? '', c.cmd === 'yolo' || (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto') : `refused: origin ${c.origin.kind} cannot start or drop a goal; type it in the prompt` }   // the human's own words only; `goal drop`: the held goal's dialog (core/lanes.sendBrief), a press only
    case 'lane': { const why = isHuman(c.origin); return { text: why ? `refused: ${why}` : await changeLane(h, await storeOf(h), a ?? '') } }
    case 'config': if (!a || a === 'show') return { text: configText(await cfgOf(h), c.args[1]) }
  }
  const r = ROUTES[c.cmd]
  if (!r && c.cmd === 'continue') return { text: modelText('context', 'nothing to continue · /cadre <goal> to start') }   // ROUTES.continue (core/session) owns it
  return r ? r(h, c) : { text: `unknown /cadre subcommand "${c.cmd}". Try: status, open, approve <id>, reject, resolve, release, restore, init, setup, doctor, sync, config, drive (decisions are answered in the dialog: press 1)` }
}

// ---- the one message state machine (ADR 0014): bare `/cadre`, and every typed command that does not apply here. The band shows only the last two states (ui/v2/band). ----
export const WELCOME = 'Welcome to cadre · run /cadre setup once on this machine'
export const READY = 'Ready when you are · /cadre <goal> to start · /cadre deep <goal> to talk it through first · /cadre yolo <goal> to run it without questions'
export const NO_PLAN = 'No plan yet · /cadre <goal> to start'
const setUp = async (h: Host) => !!(await h.store.get('cadre:setup'))   // commands/doctor stamps it when setup finds nothing critical
export async function status(h: Host): Promise<string> {
  const ds = (await h.board.read()).decisions ?? [], mine = ds.filter(d => !d.quiet && /^(run|init):/.test(d.id))   // setup/init waiting on the human: said even before the repo is on
  const hr = await halted(h)
  if (!(await wake(h))) return modelText('context', mine.length ? `setup · ${mine.length} needs you · press 1` : hr ? haltText(hr) : (await setUp(h)) ? READY : WELCOME)   // a set-up repo implies a set-up machine: no welcome there
  await warm(h)
  const b = await h.board.read(), p = b.plan, needs = needsOf(await read(h)).filter(n => n.d).length, ts = b.tasks, n = `${ts.filter(t => t.state === 'done').length}/${ts.length}`
  const left = await unfinished(h), dl = deepLine((await h.secret.read()).goalRun, (await cfgOf(h)).planning)
  const text = needs ? `${p?.id ?? (mine.length ? 'setup' : 'cadre')} · ${needs} needs you · press 1 to answer`
    : hr ? haltText(hr)
    : dl ? dl
    : !p || p.slug === 'mission' || p.state === 'done-on-dev' || p.state === 'released' ? NO_PLAN
    : left ? `Unfinished plan ${left.id} ${left.slug} (${left.done}/${left.total}) · /cadre continue to pick it up`   // core/session.unfinished: the same test as continue and the band
    : [p.id + ' ' + p.slug, `${n} done`, ...ts.filter(t => t.state === 'active' || t.state === 'review').slice(0, 1).map(t => `running ${t.id} ${stepName(t.step)}`), '/cadre to open'].join(' · ')
  return modelText('context', text)
}
// A goal typed while this project is being set up (the onboarding dialog is up, or the init run is on) waits for it, once: the newest text replaces the queued one.
// Without this a second goal started its own plan mid-init, live 0.9.1.
export const SETTING_UP = 'setting up · answer the dialog (press 1)'
const settingUp = async (h: Host) => (await h.secret.read()).run?.kind === 'init' || ((await h.board.read()).decisions ?? []).some(d => d.id === 'init:goal')
async function later(h: Host, text: string, yolo: boolean): Promise<Out> {
  if (!(await h.secret.read()).run) { await onboard(h, text, yolo); return { text: modelText('context', SETTING_UP) } }   // the dialog shows the new text
  await queue(h, { text, mode: yolo || (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto' })
  return { text: modelText('context', SETTING_UP) }
}
// `/cadre <goal>` · `/cadre yolo <goal>` in a repo cadre is not set up in: ONE dialog, Set up (init run, then this goal) or Not now (nothing changes)
async function onboard(h: Host, text: string, yolo: boolean): Promise<Out> {
  if (!(await setUp(h))) return { text: modelText('context', WELCOME) }
  const mode = yolo || (await cfgOf(h)).drive.mode === 'yolo' ? 'yolo' : 'auto'
  await h.ui.update(u => ({ ...u, onboard: { text, mode } }))
  await ask(h, { id: 'init:goal', kind: 'init', title: "cadre isn't set up here. Set it up and plan this goal?", short: 'set up cadre here', hash: fnv1a64(`${mode}\n${text}`), tab: 'epic',
    lines: [text.slice(0, 160), 'Claude sets up the project (you see every step), then drafts the plan with its mission for you to approve.'],
    options: [{ key: 's', label: 'Set up', verb: 'approve', run: 'init goal' }, { key: 'x', label: 'Not now', verb: 'reject', run: 'init cancel' }] })
  await autoAsk(h).catch(() => {})
  return { text: modelText('context', 'cadre is not set up here yet · answer the dialog (press 1)') }
}

// command.run {command:'cadre'}
// /cadre config show [prefix]: `key = value` lines (no JSON dump); without a prefix only what differs from the defaults
const flat = (o: unknown, p = ''): [string, string][] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, JSON.stringify(o)]])
export const configText = (cfg: unknown, prefix?: string): string => {
  const def = new Map(flat(defaults())), rows = flat(cfg).filter(([k, v]) => (prefix ? k.startsWith(prefix) : def.get(k) !== v))
  return (rows.length ? `config${prefix ? ` ${prefix}` : ' (differs from the defaults; /cadre config show <prefix> lists a section)'}:\n${rows.map(([k, v]) => `${k} = ${v}`).join('\n')}` : prefix ? `no config keys under ${prefix}` : 'config: all defaults').slice(0, 2000)
}
// words; `k="a b"` is one argv element `k=a b` (a field value with spaces, ADR 0009). argv only: nothing reaches a shell
export const argsOf = (t: string): string[] => (t.match(/\w+="[^"]*"|\S+/g) ?? []).map(a => a.replace(/^(\w+)="([^"]*)"$/, '$1=$2'))
// The typed surface (ADR 0011, 0013, 0014, 0020): `/cadre` (status + the pane) · `/cadre setup|init|doctor|continue|timeline` · `/cadre <goal>` · `/cadre yolo <goal>` · `/cadre deep <goal>`. An old subcommand word gets a one-line hint, so a typo never starts a plan;
// the other dispatcher commands are reached only by the dialog's answers (and the Settings tab's presses).
export const OLD = ['approve', 'reject', 'resolve', 'restore', 'release', 'drive', 'config', 'sync', 'adapter', 'status', 'open', 'confirm', 'cancel', 'resume', 'lane', 'goal', 'setup', 'init', 'doctor', 'revert']
export const HINT = "that's answered in the dialog now: press 1 on the band or run /cadre"
export function parse(text: string): { cmd: string; args: string[] } | { hint: string } {
  const t = text.trim(), [w = '', ...rest] = argsOf(t)
  if (!t) return { cmd: 'pane', args: [] }
  if (['setup', 'init', 'doctor', 'continue', 'timeline'].includes(w) && !rest.length) return { cmd: w, args: [] }
  if (w === 'revert' && rest.length === 1) return { cmd: 'revert', args: rest }   // H9: typing it opens the card (a dialog); the confirms are the dialogs' answers
  if (w === 'deep') return rest.length ? { cmd: 'deep', args: [t.slice(4).trim()] } : { hint: 'usage: /cadre deep <goal> · Claude explores, then asks one question at a time until the goal is clear, then plans it' }   // ADR 0020
  if (w === 'yolo') return rest.length ? { cmd: 'yolo', args: [t.slice(4).trim()] } : { hint: 'usage: /cadre yolo <goal> · after you approve the plan, nothing is asked until it lands on dev' }   // ADR 0013
  return OLD.includes(w) ? { hint: HINT } : { cmd: 'goal', args: [t] }
}
export const run: Hook = async (h, e) => {
  const p = parse(String(e.args ?? '')); if ('hint' in p) return { text: p.hint }
  const kind = e.origin?.kind === 'press' ? 'unclassified' : e.origin?.kind ?? 'unclassified'   // 'press' is ours alone
  try {
    if (p.cmd === 'pane') { await openPane(h, 'epic').catch(() => {}); return { text: await status(h) } }   // the one-line status; Needs you is on top of the epic tab
    return await dispatch(h, { schemaVersion: 1, ...p, origin: { kind, name: e.origin?.name } }, route)
  } catch (x) { return { text: `cadre: ${(x as Error).message}` } }
}
// the dialog's answer on decision `id`, option `key`, asked with `hash` (+ field values) (ADR 0012): core/dispatch.answer
export const decide = (h: Host, id: string, key: string, hash: string, vals?: Record<string, string>): Promise<Out> => answer(h, id, key, hash, route, vals)
