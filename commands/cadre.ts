// /cadre <sub> (DESIGN 5.3): parse text into a dispatcher command (core/dispatch is the only entry). Queue/state-by-CAS only: never submits or spawns (P4, G6).
import type { Hook, Host } from '../types'
import type { Command, Out } from '../core/dispatch'
import { ROUTES, answer, cfgOf, dispatch, resolveEpic, restore } from '../core/dispatch'
import { modelView } from '../core/board'
import { wake, warm } from '../core/session'
import { contextLine, subject } from '../core/render'
import { defaultTab, openPane } from '../ui/index'
import { read } from '../ui/model'
import { confirm as initConfirm } from './init'
import { confirmUser, doctor } from './doctor'
import { recheck, resnap, settingsAnswer, start } from './agentrun'
import { defaults } from '../config/index'

// text board from the model view + the cost ledger (the human view's cost, since this is a typed command's own output)
async function status(h: Host): Promise<Out> {
  await warm(h)   // a first-line /cadre status in a new session reads the rehydrated board
  const s = await h.board.read(), v = modelView(s)
  const rows = v.tasks.map(t => `${t.id} ${subject(t)}${t.owner ? ` (${t.owner})` : ''}`)
  const c = s.cost
  return { text: [contextLine(v) || 'no plan', ...rows, `cost: ${c.tokens} tokens${c.usd !== undefined ? ` $${c.usd.toFixed(2)}` : ''}${c.cachePct !== undefined ? ` cache ${c.cachePct}%` : ''} · containment ${s.containment.state}${s.drive.on ? ` · drive on ${s.drive.turns} turns` : ''}`].join('\n') }
}

async function route(h: Host, c: Command): Promise<Out> {
  const [a] = c.args
  if (!['setup', 'doctor', 'init', 'open'].includes(c.cmd) && !(await wake(h))) return { text: 'cadre is off in this repo · run /cadre init' }   // per-repo opt-in (ADR 0007)
  switch (c.cmd) {
    case 'status': return status(h)
    case 'open': await openPane(h, a ?? defaultTab(await read(h))); return { text: `Opened the cadre pane (${a ?? 'epic'}).` }
    case 'resolve': if (a && a === (await h.board.read()).plan?.id) return resolveEpic(h, a, c.args[1] ?? ''); break
    case 'restore': return restore(h, a)
    case 'init': case 'setup': {   // Claude does the work (ADR 0010); the checklist and the containment confirm show as decision cards (ADR 0008)
      const text = a === 'restore' || a === 'keep' ? await settingsAnswer(h, a)
        : a === 'confirm' ? [await (c.cmd === 'init' ? initConfirm : confirmUser)(h), await resnap(h).then(() => recheck(h))].filter(Boolean).join(' · ')   // cadre's own confirmed write is not a change from outside
        : await start(h, c.cmd)
      if ((await h.board.read()).decisions?.length) await openPane(h, 'card').catch(() => {})
      return { text }
    }
    case 'doctor': return { text: await doctor(h) }
    case 'config': if (!a || a === 'show') return { text: configText(await cfgOf(h), c.args[1]) }
  }
  const r = ROUTES[c.cmd]
  return r ? r(h, c) : { text: `unknown /cadre subcommand "${c.cmd}". Try: status, open, approve <id>, reject, resolve, release, restore, init, setup, doctor, sync, config, drive (decisions are buttons on the card)` }
}

// command.run {command:'cadre'}
// /cadre config show [prefix]: `key = value` lines (no JSON dump); without a prefix only what differs from the defaults
const flat = (o: unknown, p = ''): [string, string][] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, JSON.stringify(o)]])
export const configText = (cfg: unknown, prefix?: string): string => {
  const def = new Map(flat(defaults())), rows = flat(cfg).filter(([k, v]) => (prefix ? k.startsWith(prefix) : def.get(k) !== v))
  return (rows.length ? `config${prefix ? ` ${prefix}` : ' (differs from the defaults; /cadre config show <prefix> lists a section)'}:\n${rows.map(([k, v]) => `${k} = ${v}`).join('\n')}` : prefix ? `no config keys under ${prefix}` : 'config: all defaults').slice(0, 2000)
}
// words; `k="a b"` is one argv element `k=a b` (card fields typed by hand, ADR 0009). argv only: nothing reaches a shell
export const argsOf = (t: string): string[] => (t.match(/\w+="[^"]*"|\S+/g) ?? []).map(a => a.replace(/^(\w+)="([^"]*)"$/, '$1=$2'))
export const run: Hook = async (h, e) => {
  const [cmd = 'status', ...args] = argsOf(String(e.args ?? ''))
  const kind = e.origin?.kind === 'press' ? 'unclassified' : e.origin?.kind ?? 'unclassified'   // 'press' is ours alone
  try { return await dispatch(h, { schemaVersion: 1, cmd, args, origin: { kind, name: e.origin?.name } }, route) } catch (x) { return { text: `cadre: ${(x as Error).message}` } }
}
// a Button press / ask-dialog answer on decision `id`, option `key`, drawn with `hash` (ADR 0008, 0012): core/dispatch.answer
export const press = (h: Host, id: string, key: string, hash: string, origin: 'press' | 'dialog' = 'press'): Promise<Out> => answer(h, id, key, hash, origin, route)
