// Internal `config` command the Settings tab buttons call (DESIGN 12, ADR 0007): the MOD writes the settings file after the human's press, never Claude.
//   set <key> <value> -> ~/.claude/cadre.json (or the repo's section there, when the key already lives in it) · repo <key> <value> -> .cadre/config.json (O keys only)
//   edit <key> -> a Decision with one field (asked in the dialog) · cancel <key> · sel <+1|-1> · refresh. Every write: .bak of the old bytes, write, re-read.
import { DRIVE, ROUTES, dispatch, isHuman } from '../core/dispatch'
import { ask, settle } from '../core/decide'
import { start } from '../core/session'
import { repoKeyOf } from '../commands/init'
import { check, layersOf, resolve, rows } from './index'
import { LIMIT } from '../policy/guards'
import { PROTECTED } from '../core/git'
import { RETRIES } from '../core/validate'
import { LEASE } from '../core/drive'
import { CATS } from './index'
import type { Row } from './index'

const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const at = (o: unknown, ks: string[]) => ks.reduce((a: any, k) => a?.[k], o)
export const show = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v))
const ID = (key: string) => `cfg:${key}`

const ctx = async (h: any) => { const root = await h.cwd(), home = await h.home(); return { root, home, rk: repoKeyOf(root) } }
// fixed invariants (ADR 0019): shown with their value, never settable
const fx = (key: string, cat: Row['cat'], value: unknown, desc: string): Row => ({ key, cat, cls: 'S', desc, safety: true, value, def: value, src: 'fixed', kind: 'text' })
const FIXED = (): Row[] => [fx('fixed.setupLease', 'Safety and containment', `${LIMIT.turns} turns / ${LIMIT.ms / 60_000} min`, 'Claude may edit setup files only within a setup run this long'),
  fx('fixed.protected', 'Safety and containment', PROTECTED, 'paths no task agent may change'), fx('fixed.draftRetries', 'Planning', RETRIES, 'refused plan drafts before cadre asks you'),
  fx('fixed.driveLease', 'Drive and autonomy', `${LEASE / 60_000} min`, 'a drive whose session is silent this long can be taken over')]
export const settingsRows = async (h: any): Promise<Row[]> => { const r = [...rows(await layersOf(h, await ctx(h)), await h.env()), ...FIXED()]; return r.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat)) }
// doctor's settings section (ADR 0019): refused values, env overrides (one row per variable), then the full effective table, non-default first
export async function doctorRows(h: any): Promise<['ok' | 'warn', string, string?][]> {
  const rs = await settingsRows(h), line = (r: Row): ['ok', string] => ['ok', `setting ${r.key} = ${show(r.value) || '(empty)'} · ${r.src}`]
  const warns = [...new Set(rs.flatMap(r => r.warn?.split('; ') ?? []))].map((w): ['warn', string, string] => [`warn`, `${w}: overrides ${rs.filter(r => r.warn?.includes(w)).length} model/effort settings`, 'unset the variable to use the Settings values'])
  return [...resolve(await layersOf(h, await ctx(h))).diagnostics.map((d): ['warn', string, string] => ['warn', `setting refused: ${d}`, 'fix it in Settings (9) or in that file']), ...warns,
    ...rs.filter(r => r.src !== 'default' && r.src !== 'fixed').map(line), ...rs.filter(r => r.src === 'default' || r.src === 'fixed').map(line)]
}
// the pane cannot read files: its rows ride in the ui atom (like the doctor rows)
export const refreshSettings = async (h: any): Promise<void> => { const r = await settingsRows(h); await h.ui.update((u: any) => ({ ...u, 'settings.rows': r })) }

function coerce(row: Row, raw: string): unknown | Error {
  if (row.kind === 'bool') return raw === 'true' ? true : raw === 'false' ? false : new Error('expected true or false')
  if (row.kind === 'number') { const n = raw.trim() === '' ? NaN : Number(raw.trim()), bad = check(row.key, n); return bad ? new Error(bad) : n }
  if (row.kind === 'list') { try { const j = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map(x => x.trim()).filter(Boolean); return Array.isArray(j) && j.every(x => typeof x === 'string') ? j : new Error('expected a comma-separated list') } catch { return new Error('expected a comma-separated list') } }
  if (row.kind === 'json') { try { return JSON.parse(raw) } catch { return new Error('expected JSON') } }
  const bad = check(row.key, raw); return bad ? new Error(bad) : raw
}

// the decision of one key: a field prefilled with the value; the same id is asked again with the refusal as `error` (the dialog re-asks it)
async function editCard(h: any, row: Row, error?: string): Promise<void> {
  const note = row.cls === 'S' ? 'security key: the repo file may only tighten it' : row.cls === 'U' ? 'user-level only: never read from the repo file' : 'a repo value is shared with the team',
    hint = row.kind === 'list' ? 'a comma-separated list' : row.kind === 'number' ? 'a number' : row.kind === 'json' ? 'JSON' : 'text'
  await ask(h, { id: ID(row.key), kind: 'config', title: `edit ${row.key}`, lines: [row.desc, `now ${show(row.value) || '(empty)'} [${row.src}] · default ${show(row.def) || '(empty)'}`, `${note} · ${hint}`, ...(row.warn ? [row.warn] : [])], hash: `${row.key}|${show(row.value)}|${error ?? ''}`, tab: 'settings',
    fields: [{ key: 'value', label: row.key, value: show(row.value) }], ...(error ? { error } : {}),
    options: [{ key: 'a', label: 'Save for me', verb: 'approve', run: `config set ${row.key} {fields}` }, ...(row.cls === 'O' ? [{ key: 'r', label: 'Save to repo', verb: 'approve', run: `config repo ${row.key} {fields}` }] : []), { key: 'x', label: 'Cancel', verb: 'reject', run: `config cancel ${row.key}` }] })
}
const back = (h: any, key: string) => settle(h, ID(key))

async function save(h: any, scope: 'user' | 'repo', key: string, raw: string): Promise<{ text: string }> {
  const row = (await settingsRows(h)).find(r => r.key === key)
  const no = async (why: string) => { if (row && ((await h.board.read()).decisions ?? []).some((d: any) => d.id === ID(key))) await editCard(h, row, why); return { text: `refused: ${why}` } }
  if (!row || row.src === 'fixed') return { text: `refused: ${key} is not a setting` }
  if (scope === 'repo' && row.cls !== 'O') return no(`${key} is ${row.cls === 'S' ? 'a security' : 'a user-level'} key: save it for you, not in the repo file`)
  if (key === 'strictness' && (await h.board.read()).tasks.some((t: any) => t.state === 'active' || t.state === 'review')) return no('strictness cannot change while tasks are running; retry when they finish')
  const val = coerce(row, raw); if (val instanceof Error) return no(val.message)
  const { root, home, rk } = await ctx(h), path = scope === 'repo' ? `${root}/.cadre/config.json` : `${home}/.claude/cadre.json`, ks = key.split('.')
  let cur: any; try { cur = JSON.parse((await h.readText(path)) ?? '{}') } catch { return no(`${scope === 'repo' ? '.cadre/config.json' : '~/.claude/cadre.json'} is not valid JSON`) }
  if (!plain(cur)) return no('the settings file is not an object')
  const sec = scope === 'user' && plain(cur.repos?.[rk]) && at(cur.repos[rk], ks) !== undefined ? cur.repos[rk] : cur   // a key already set in this repo's section stays there, or it would be shadowed
  let o = sec; for (const k of ks.slice(0, -1)) o = o[k] = plain(o[k]) ? o[k] : {}
  o[ks[ks.length - 1]] = val
  const bad = resolve([{ name: 'set', trust: scope === 'repo' ? 'repo' : 'user', value: (({ repos: _r, ...x }) => x)(sec) }]).diagnostics.filter(d => d.includes(key))
  if (bad.length) return no(bad.join('; '))
  const text = `${JSON.stringify(cur, null, 2)}\n`, old = await h.readText(path)
  if (old !== null && old !== text) await h.write(`${path}.bak`, old)
  if (DRIVE.humanWrite) await DRIVE.humanWrite(h, () => h.write(path, text)); else await h.write(path, text)   // the human's own change: a running drive takes it as its new baseline
  if ((await h.readText(path)) !== text) return no('the file could not be written')
  await start(h); await refreshSettings(h)
  if (((await h.board.read()).decisions ?? []).some((d: any) => d.id === ID(key))) await back(h, key)
  return { text: `${key} = ${JSON.stringify(val)} · saved ${scope === 'repo' ? 'to the repo' : 'for you'}` }
}

ROUTES.config = async (h, c) => {
  const [sub, key, ...v] = c.args
  if (sub === 'refresh') { await refreshSettings(h); return { text: 'settings refreshed' } }
  if (!['set', 'repo', 'edit', 'cancel', 'sel'].includes(sub ?? '') || !key) return { text: 'usage: press 9 in the pane (Settings)' }
  const why = isHuman(c.origin); if (why) return { text: `refused: ${why}` }
  if (sub === 'sel') { await h.ui.update((u: any) => ({ ...u, ssel: Math.max(0, Number(u.ssel ?? 0) + Number(key)) })); return { text: '' } }
  if (sub === 'cancel') { await back(h, key); return { text: `${key}: unchanged` } }
  if (sub === 'edit') { const row = (await settingsRows(h)).find(r => r.key === key); if (!row || row.src === 'fixed') return { text: `refused: ${key} is not a setting` }; await editCard(h, row); return { text: `edit ${key}` } }
  return save(h, sub as 'set' | 'repo', key, v.join(' ').replace(/^value=/, ''))
}

// what a pane button runs (acts.run): the line after `config`, as the human's press
export const configPress = (h: any, line: string) => dispatch(h, { schemaVersion: 1, cmd: 'config', args: line.split(/\s+/).filter(Boolean), origin: { kind: 'press' } }, ROUTES.config)
