// Internal `config` command the Settings tab buttons call (DESIGN 12, ADR 0007): the MOD writes the settings file after the human's press, never Claude.
//   set <key> <value> -> ~/.claude/cadre.json (or the repo's section there, when the key already lives in it) · repo <key> <value> -> .cadre/config.json (O keys only)
//   edit <key> -> a Decision with one field (asked in the dialog) · cancel <key> · sel <+1|-1> · refresh. Every write: .bak of the old bytes, write, re-read.
import { DRIVE, ROUTES, dispatch, isHuman } from '../core/dispatch'
import { ask, settle } from '../core/decide'
import { emit } from '../core/events'
import { prune as pruneLesson, rows as lessonRows } from '../core/lessons'
import { start } from '../core/session'
import { repoKeyOf } from '../commands/init'
import { HEADLESS, REG, check, headlessMain, layersOf, resolve, rows, tighten } from './index'
import { clamped, modelIssues } from '../core/queue'
import { parse } from '../core/discover'
import { UNIT, unitRows } from '../ui/settings'
import { LIMIT } from '../policy/guards'
import { PROTECTED } from '../core/git'
import { RETRIES } from '../core/validate'
import { LEASE } from '../core/drive'
import { ROLES, TTL } from '../agents/index'
import { fixedRules } from '../core/roles'
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
  fx('fixed.driveLease', 'Drive and autonomy', `${LEASE / 60_000} min`, 'a drive whose session is silent this long can be taken over'),
  fx('fixed.cacheTtl', 'Cache and context', ROLES.map(r => `${r} ${TTL[r]}`).join(', '), 'prompt-cache lifetime per agent role (set in the shipped agent files)'),
  ...fixedRules().map(([k, v, d]) => fx(k, 'Safety and containment', v, d))]
export const settingsRows = async (h: any): Promise<Row[]> => {
  const env = await h.env(), hl = !!(await h.ui?.read?.())?.headless, ls = await layersOf(h, await ctx(h))
  const rf = await h.readText(`${(await ctx(h)).root}/.cadre/config.json`).then((t: string | null) => JSON.parse(t ?? '{}').units, () => undefined)   // the units editor edits the repo file's own list: its indexes are that file's
  const r = [...unitRows(Array.isArray(rf) ? rf : []), ...rows(ls, env).map(x => (x.key === 'drive.spawn' && headlessMain(String(x.value), env, hl) ? { ...x, value: 'main', src: 'forced' as const, warn: HEADLESS } : x)), ...FIXED()]
  return r.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat))
}
// doctor's settings section (ADR 0019): refused values, env overrides (one row per variable), then the full effective table, non-default first
export async function doctorRows(h: any): Promise<['ok' | 'warn', string, string?][]> {
  const rs = await settingsRows(h), line = (r: Row): ['ok', string] => ['ok', `setting ${r.key} = ${show(r.value) || '(empty)'} · ${r.src}`]
  const warns = [...new Set(rs.flatMap(r => r.warn?.split('; ') ?? []))].map((w): ['warn', string, string] => (w === HEADLESS ? ['warn', `drive.spawn: ${w}`, 'run Claude Code interactively for cadre to start the agents'] : [`warn`, `${w}: overrides ${rs.filter(r => r.warn?.includes(w)).length} model/effort settings`, 'unset the variable to use the Settings values']))
  const res = resolve(await layersOf(h, await ctx(h)))
  return [...res.diagnostics.map((d): ['warn', string, string] => ['warn', `setting refused: ${d}`, 'fix it in Settings (9) or in that file']), ...warns, ...clamped(res.config).map((l): ['ok', string] => ['ok', l]),
    ...rs.filter(r => r.src !== 'default' && r.src !== 'fixed').map(line), ...rs.filter(r => r.src === 'default' || r.src === 'fixed').map(line)]
}
// the pane cannot read files: its rows ride in the ui atom (like the doctor rows)
export const refreshLessons = async (h: any): Promise<void> => { const r = await lessonRows(h).catch(() => []); await h.ui.update((u: any) => ({ ...u, 'lessons.rows': r })) }
export const refreshSettings = async (h: any): Promise<void> => { const r = await settingsRows(h); await h.ui.update((u: any) => ({ ...u, 'settings.rows': r })) }

function coerce(row: Row, raw: string): unknown | Error {
  if (row.kind === 'bool') return raw === 'true' ? true : raw === 'false' ? false : new Error('expected true or false')
  if (row.kind === 'number') { const n = raw.trim() === '' ? NaN : Number(raw.trim()), bad = check(row.key, n); return bad ? new Error(bad) : n }
  if (row.kind === 'list') { try { const j = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map(x => x.trim()).filter(Boolean); return Array.isArray(j) && j.every(x => typeof x === 'string') ? j : new Error('expected a comma-separated list') } catch { return new Error('expected a comma-separated list') } }
  if (row.kind === 'json') { try { return JSON.parse(raw) } catch { return new Error('expected JSON') } }
  const bad = check(row.key, raw); return bad ? new Error(bad) : raw
}

// the decision of one key: a field prefilled with the value; the same id is asked again with the refusal as `error` (the dialog re-asks it)
// a key's value from every layer below the repo file (defaults, user): what a repo value may only tighten (ADR 0019)
const below = async (h: any) => { const ls = await layersOf(h, await ctx(h)); return resolve(ls.slice(0, ls.findIndex(l => l.trust === 'repo'))).config }
const toRepo = (row: Row) => row.cls === 'O' || (row.cls === 'S' && !!REG[row.key]?.tighten)
async function editCard(h: any, row: Row, error?: string): Promise<void> {
  const b = at(await below(h), row.key.split('.')), st = row.opts?.slice(row.opts.indexOf(String(b)) + 1)
  const note = row.cls === 'S' ? `safety key: the repo file may only make it stricter than ${show(b) || '(empty)'}${REG[row.key]?.tighten === 'enum' ? ` (${st?.length ? st.join(', ') : 'nothing stricter'})` : ''}` : row.cls === 'U' ? 'user-level only: never read from the repo file' : 'a repo value is shared with the team',
    hint = row.kind === 'list' ? 'a comma-separated list' : row.kind === 'number' ? 'a number' : row.kind === 'json' ? 'JSON' : 'text'
  await ask(h, { id: ID(row.key), key: `config.${row.key}`, kind: 'config', title: `edit ${row.key}`, lines: [row.desc, `now ${show(row.value) || '(empty)'} [${row.src}] · default ${show(row.def) || '(empty)'}`, `${note} · ${hint}`, ...(row.warn ? [row.warn] : [])], hash: `${row.key}|${show(row.value)}|${error ?? ''}`, tab: 'settings',
    fields: [{ key: 'value', label: row.key, value: show(row.value) }], ...(error ? { error } : {}),
    options: [...(UNIT.test(row.key) ? [] : [{ key: 'a', label: 'Save for me', verb: 'approve', run: `config set ${row.key} {fields}` }]), ...(toRepo(row) ? [{ key: 'r', label: 'Save to repo', verb: 'approve', run: `config repo ${row.key} {fields}` }] : []), { key: 'x', label: 'Cancel', verb: 'reject', run: `config cancel ${row.key}` }] })
}
const back = (h: any, key: string) => settle(h, ID(key))

// a unit's scalar field (ui/settings): the unit is re-parsed, the model gate re-run, then .cadre/config.json is written once with its .bak
async function saveUnit(h: any, key: string, raw: string, no: (why: string) => Promise<{ text: string }>): Promise<{ text: string }> {
  const [, i, f] = key.match(UNIT)!, { root } = await ctx(h), path = `${root}/.cadre/config.json`, v = raw.trim()
  let cur: any; try { cur = JSON.parse((await h.readText(path)) ?? '{}') } catch { return no('.cadre/config.json is not valid JSON') }
  const u = cur?.units?.[Number(i)]; if (!u) return no('there is no such unit in .cadre/config.json')
  let val: unknown = v; try { if (f === 'setup') val = JSON.parse(v); else if (f === 'concurrency') val = v === '' || v === '0' ? undefined : Number(v) } catch { return no('expected a JSON argument list, e.g. ["npm","ci"]') }
  const { [f]: _o, ...rest } = u, next = val === undefined ? rest : { ...rest, [f]: val }, bad = parse([next]); if (typeof bad === 'string') return no(bad.replace(/^units\[0\]\./, ''))
  cur.units = cur.units.map((x: any, j: number) => (j === Number(i) ? next : x))
  const gate = modelIssues({ ...resolve(await layersOf(h, await ctx(h))).config, units: cur.units }); if (gate.length) return no(gate[0])
  const text = `${JSON.stringify(cur, null, 2)}\n`, old = await h.readText(path)
  if (old !== null && old !== text) await h.write(`${path}.bak`, old)
  if (DRIVE.humanWrite) await DRIVE.humanWrite(h, () => h.write(path, text)); else await h.write(path, text)
  if ((await h.readText(path)) !== text) return no('the file could not be written')
  await start(h); await refreshSettings(h)
  if (((await h.board.read()).decisions ?? []).some((d: any) => d.id === ID(key))) await back(h, key)
  return { text: `${u.root} ${f} = ${JSON.stringify(val ?? null)} · saved to the repo` }
}

async function save(h: any, scope: 'user' | 'repo', key: string, raw: string): Promise<{ text: string }> {
  const row = (await settingsRows(h)).find(r => r.key === key)
  const no = async (why: string) => { if (row && ((await h.board.read()).decisions ?? []).some((d: any) => d.id === ID(key))) await editCard(h, row, why); return { text: `refused: ${why}` } }
  if (!row || row.src === 'fixed') return { text: `refused: ${key} is not a setting` }
  if (UNIT.test(key)) return saveUnit(h, key, raw, no)
  if (scope === 'repo' && !toRepo(row)) return no(`${key} is a user-level key: save it for you, not in the repo file`)
  if (key === 'strictness' && (await h.board.read()).tasks.some((t: any) => t.state === 'active' || t.state === 'review')) return no('strictness cannot change while tasks are running; retry when they finish')
  const val = coerce(row, raw); if (val instanceof Error) return no(val.message)
  if (scope === 'repo' && REG[key]?.tighten) { const b = at(await below(h), key.split('.')); if (JSON.stringify(tighten(key, b, val)) !== JSON.stringify(val)) return no(`${key}: the repo file may only make it stricter than ${show(b) || '(empty)'}`) }
  const { root, home, rk } = await ctx(h), path = scope === 'repo' ? `${root}/.cadre/config.json` : `${home}/.claude/cadre.json`, ks = key.split('.')
  let cur: any; try { cur = JSON.parse((await h.readText(path)) ?? '{}') } catch { return no(`${scope === 'repo' ? '.cadre/config.json' : '~/.claude/cadre.json'} is not valid JSON`) }
  if (!plain(cur)) return no('the settings file is not an object')
  const sec = scope === 'user' && plain(cur.repos?.[rk]) && at(cur.repos[rk], ks) !== undefined ? cur.repos[rk] : cur   // a key already set in this repo's section stays there, or it would be shadowed
  let o = sec; for (const k of ks.slice(0, -1)) o = o[k] = plain(o[k]) ? o[k] : {}
  o[ks[ks.length - 1]] = val
  const bad = resolve([{ name: 'set', trust: scope === 'repo' ? 'repo' : 'user', value: (({ repos: _r, ...x }) => x)(sec) }]).diagnostics.filter(d => d.includes(key) && !(scope === 'repo' && d.endsWith('may only tighten this key')))   // tightening is judged against the user's value just above
  if (bad.length) return no(bad.join('; '))
  const text = `${JSON.stringify(cur, null, 2)}\n`, old = await h.readText(path)
  if (old !== null && old !== text) await h.write(`${path}.bak`, old)
  if (DRIVE.humanWrite) await DRIVE.humanWrite(h, () => h.write(path, text)); else await h.write(path, text)   // the human's own change: a running drive takes it as its new baseline
  if ((await h.readText(path)) !== text) return no('the file could not be written')
  await emit(h, 'config.changed', { key, from: row.value, to: val }); await start(h); await refreshSettings(h)
  if (((await h.board.read()).decisions ?? []).some((d: any) => d.id === ID(key))) await back(h, key)
  return { text: `${key} = ${JSON.stringify(val)} · saved ${scope === 'repo' ? 'to the repo' : 'for you'}` }
}

ROUTES.config = async (h, c) => {
  const [sub, key, ...v] = c.args
  if (sub === 'lessons' || sub === 'lprune' || sub === 'lsel') {   // the Lessons tab (ui/views/lessons): refresh, x prunes the row named, n/p move
    const why = sub === 'lessons' ? null : isHuman(c.origin); if (why) return { text: `refused: ${why}` }
    const t = sub === 'lprune' ? await pruneLesson(h, key ?? '') : ''
    if (sub === 'lsel') await h.ui.update((u: any) => ({ ...u, lsel: Math.max(0, Number(u.lsel ?? 0) + Number(key)) }))
    await refreshLessons(h); return { text: t }
  }
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
