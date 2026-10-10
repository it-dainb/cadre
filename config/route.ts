// /cadre config set <key> <json|text> (DESIGN 12): registers ROUTES.config at load (register.ts imports this module).
import { ROUTES } from '../core/dispatch'
import { start } from '../core/session'
import { resolve } from './index'

ROUTES.config = async (h, c) => {
  const [sub, key, ...v] = c.args
  if (sub !== 'set' || !key || !v.length) return { text: 'usage: /cadre config show | /cadre config set <key> <value>' }
  const path = `${await h.home()}/.claude/cadre.json`, raw = v.join(' ')
  let cur: any, val: unknown
  try { cur = JSON.parse((await h.readText(path)) ?? '{}') } catch { return { text: `refused: ${path} is not valid JSON` } }
  try { val = JSON.parse(raw) } catch { val = raw }
  const ks = key.split('.'); let o = cur
  for (const k of ks.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
  o[ks[ks.length - 1]] = val
  const bad = resolve([{ name: 'set', trust: 'user', value: (({ repos: _r, ...x }) => x)(cur) }]).diagnostics.filter(d => d.includes(key))
  if (bad.length) return { text: `refused: ${bad.join('; ')}` }
  await h.write(path, `${JSON.stringify(cur, null, 2)}\n`); await start(h)
  return { text: `config ${key} = ${JSON.stringify(val)} (~/.claude/cadre.json)` }
}
