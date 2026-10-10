// /cadre <sub> (DESIGN 5.3): parse text into a dispatcher command (core/dispatch is the only entry). Queue/state-by-CAS only: never submits or spawns (P4, G6).
import type { Hook, Host } from '../types'
import type { Command, Out } from '../core/dispatch'
import { ROUTES, cfgOf, dispatch, gateDraw, gateOf, redraw, registryOf, resolveEpic, restore, storeOf } from '../core/dispatch'
import { modelView } from '../core/board'
import { warm } from '../core/session'
import { contextLine, subject } from '../core/render'
import { openPane } from '../ui/index'
import { run as initRun } from './init'
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
  switch (c.cmd) {
    case 'status': return status(h)
    case 'open': await openPane(h, a ?? 'epic'); return { text: `Opened the cadre pane (${a ?? 'epic'}).` }
    case 'approve': {   // no token: the sheet opens in the pane's Plan tab; the one-line text is all the model sees
      const id = (a ?? '').split('@')[0], s = await h.board.read(), gate = s.plan?.id === id ? null : await gateOf(await storeOf(h), id)
      if (gate) { await gateDraw(h, gate); await openPane(h, 'plan'); return { text: `Approval for gate ${id} opened in the cadre pane.` } }
      if (!s.plan || s.plan.id !== id) return { text: `refused: no draft plan ${id || '(give a plan id)'}` }
      if ((await h.secret.read()).approval?.planId !== id) await redraw(h, await storeOf(h), await registryOf(h))
      await openPane(h, 'plan'); return { text: `Approval sheet for ${id} opened in the cadre pane.` }
    }
    case 'resolve': if (a && a === (await h.board.read()).plan?.id) return resolveEpic(h, a, c.args[1] ?? ''); break
    case 'restore': return restore(h, a)
    case 'init': return { text: await initRun(h, c.args) }
    case 'config': if (!a || a === 'show') return { text: configText(await cfgOf(h), c.args[1]) }
  }
  const r = ROUTES[c.cmd]
  return r ? r(h, c) : { text: `unknown /cadre subcommand "${c.cmd}". Try: status, open, approve <id>, reject, resolve, release, restore, init, sync, adapter token, config, drive` }
}

// command.run {command:'cadre'}
// /cadre config show [prefix]: `key = value` lines (no JSON dump); without a prefix only what differs from the defaults
const flat = (o: unknown, p = ''): [string, string][] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, JSON.stringify(o)]])
export const configText = (cfg: unknown, prefix?: string): string => {
  const def = new Map(flat(defaults())), rows = flat(cfg).filter(([k, v]) => (prefix ? k.startsWith(prefix) : def.get(k) !== v))
  return (rows.length ? `config${prefix ? ` ${prefix}` : ' (differs from the defaults; /cadre config show <prefix> lists a section)'}:\n${rows.map(([k, v]) => `${k} = ${v}`).join('\n')}` : prefix ? `no config keys under ${prefix}` : 'config: all defaults').slice(0, 2000)
}
export const run: Hook = async (h, e) => {
  const [cmd = 'status', ...args] = String(e.args ?? '').trim().split(/\s+/).filter(Boolean)
  try { return await dispatch(h, { schemaVersion: 1, cmd, args, origin: { kind: e.origin?.kind ?? 'unclassified', name: e.origin?.name } }, route) } catch (x) { return { text: `cadre: ${(x as Error).message}` } }
}
