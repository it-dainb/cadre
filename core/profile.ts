// The profile loader (plan 2.1, 2.1a): built-in -> user (`profile` in ~/.claude/cadre.json, a built-in name or an inline profile) -> repo (.cadre/profile.json, as is, the repo wins).
// Every layer goes through one closed schema and the cross-checks below; a refusal is one line with an example. An invalid repo profile makes cadre dormant for that repo (no fallback).
// The refusal lines name profile keys the model-text lint bans (hooks, sandbox): they are for the person (load, Doctor, /cadre profile), not for an agent.
import { unionAttrs } from './git'
import type { Host } from '../types'
import type { Profile, ProfileLayer } from '../types/profile'
import { cfgOf } from '../config/index'
import { profile as DEFAULT } from '../profiles/default'
import { profile as DOCS } from '../profiles/docs'
import { profile as ANALYSIS } from '../profiles/analysis'
import { customIssue } from './roles'
import { setProfile } from './pipeline'

export const BUILTIN: Record<string, ProfileLayer> = { default: DEFAULT, docs: DOCS, analysis: ANALYSIS }
const GATES = ['integrate', 'report'], EVENTS = ['task.closed', 'epic.landed', 'release'], NAMES = ['MODULES', 'TMPDIR', 'UID', 'WT', 'PATH', 'id', 'title', 'version']
const COUNTERS = ['rebase', 'shapeRefusals', 'silentRuns', 'nudges', 'red', 'rework', 'startFails']
const PARAMS: Record<string, string[]> = { clear: ['kinds', 'how'], retry: ['counter', 'more'], reset: ['counter'], unblock: ['note'], rewind: ['to'], spec: ['how'], rework: ['kind'] }
const DO = ['wait', 'clear', 'retry', 'reset', 'unblock', 'rewind', 'amend', 'resume', 'cancel', 'adopt', 'spec', 'restore', 'recut', 'dropNeed', 'endAgent', 'rework']
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'
// a key that becomes a step, type, role, check or flag name: plain characters, never an object-prototype name
export const nameOk = (k: string): boolean => k.length > 0 && k.length <= 40 && k[0] !== '-' && ![...k].some(c => !CHARS.includes(c)) && !['__proto__', 'constructor', 'prototype'].includes(k)

// ---- the closed schema: a string is a type ('s' text, 'i' whole number, 'b' bool, 'a' anything) or `=a|b` (one of), [x] a list, {k: x} a closed object ('k?' optional, '*' any name), a function its own check ----
type Sh = string | Sh[] | { [k: string]: Sh } | ((v: unknown, at: string) => string | null)
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const dot = (at: string, k: string) => (at ? `${at}.${k}` : k)
function walk(v: unknown, sh: Sh, at: string): string | null {
  if (typeof sh === 'function') return sh(v, at)
  if (typeof sh === 'string') {
    if (sh[0] === '=') return sh.slice(1).split('|').includes(String(v)) ? null : `${at}: expected ${sh.slice(1).split('|').join(' or ')}`
    return sh === 'a' || (sh === 's' && typeof v === 'string') || (sh === 'b' && typeof v === 'boolean') || (sh === 'i' && Number.isInteger(v) && (v as number) >= 0) ? null : `${at}: expected ${sh === 's' ? 'text' : sh === 'i' ? 'a whole number' : 'true or false'}`
  }
  if (Array.isArray(sh)) { if (!Array.isArray(v)) return `${at}: expected a list`; for (const [i, x] of v.entries()) { const e = walk(x, sh[0], `${at}[${i}]`); if (e) return e } return null }
  if (!obj(v)) return `${at || 'the profile'}: expected an object`
  for (const k of Object.keys(v)) {
    if ('*' in sh) { if (!nameOk(k)) return `${dot(at, k)}: not a plain name (letters, digits, - and _)` } else if (!(k in sh) && !(`${k}?` in sh)) return `${dot(at, k)}: unknown key`
    const e = walk(v[k], '*' in sh ? sh['*'] : sh[k] ?? sh[`${k}?`], dot(at, k)); if (e) return e
  }
  const miss = Object.keys(sh).find(k => k !== '*' && !k.endsWith('?') && !(k in v)); return miss ? `${dot(at, miss)}: missing` : null
}
const OF: Sh = { retry: 'i', then: (v, at) => (v === 'human' || v === 'cancel' ? null : obj(v) ? walk(v, { back: 's' }, at) : `${at}: expected "human", "cancel" or {"back": "<step>"}`) }
const SECTIONS = '=description|acceptance|contract|locked|diff|deps|handoff|notes|findings|decisions|question'
const STEP: Sh = (v, at) => (!obj(v) ? `${at}: expected an object` : 'role' in v ? walk(v, { role: 's', workspace: '=none|worktree|view', brief: [SECTIONS], 'locks?': { 'acquire?': '=out', 'enforce?': '=in' }, 'onFail?': OF }, at)
  : walk(v, { gate: 's', expect: '=pass|fail', on: 's', 'onFail?': OF }, at))
const HOOK: Sh = (v, at) => (obj(v) && 'role' in v ? walk(v, { role: 's' }, at) : walk(v, { run: ['s'], 'commit?': 's', 'envPass?': ['s'] }, at))
const HOOKS: Sh = (v, at) => (!obj(v) ? `${at}: expected an object` : Object.keys(v).find(k => !EVENTS.includes(k)) ? `${at}.${Object.keys(v).find(k => !EVENTS.includes(k))}: unknown event (${EVENTS.join(', ')})` : walk(v, Object.fromEntries(EVENTS.map(e => [`${e}?`, [HOOK]])), at))
const CELL: Sh = { model: 's', 'effort?': 's' }
const ROLE: Sh = { description: 's', 'prompt': 's', tools: ['s'], 'disallowedTools?': ['s'], network: '=on|off', write: ['s'], 'mcpAllow?': 'b', 'model?': 's', 'effort?': 's', 'maxTurns?': 'i', ttl: '=5m|1h', onSilent: '=nudge|block|retry', 'nudge?': 's',
  report: { outcomes: ['=done|blocked|spec_change|pass|fail'], fields: { '*': 'a' }, required: ['s'], 'requiredWith?': { '*': ['s'] }, 'ask?': { '*': 's' } }, 'verdict?': { pass: 's', fail: 's', 'findings?': '=files|text|none' }, 'rubric?': 's', 'routing?': { '*': CELL } }
const OPTION: Sh = { key: 's', label: 's', effect: [{ do: '=' + DO.join('|'), 'to?': 's', 'counter?': 's', 'more?': 'a', 'kinds?': ['s'], 'kind?': 's', 'note?': 's', 'how?': '=accept|reject|keep|restore' }], 'needs?': '=ids|keys' }
const FIELD: Sh = { name: 's', store: '=meta|brief', required: (v, at) => (typeof v === 'boolean' || (Array.isArray(v) && v.every(x => typeof x === 'string')) ? null : `${at}: expected true, false or a list of type names`), 'want?': 's', 'kind?': 'a' }
const CONTRACT: Sh = (v, at) => (v === 'required' || v === 'none' ? null : walk(v, { schema: '=text|json' }, at))
const SCHEMA: Record<string, Sh> = {
  schema: '=2', roles: { '*': ROLE }, steps: { '*': STEP }, hooks: HOOKS, protected: ['s'], fields: [FIELD], sandbox: { env: { '*': 's' } },
  types: { '*': { pipeline: ['s'], 'lite?': ['s'], acceptance: { format: 's', cover: '=results|report|none' }, contract: CONTRACT, 'rubric?': 's', 'branch?': 's', 'commit?': 's' } },
  checks: { '*': { 'network?': 'b', 'failExit?': ['i'], 'timeoutS?': 'i' } },
  flags: { '*': { why: 's', options: [OPTION], holds: 'b', 'blocks?': 'b', yolo: '=main|human', 'tab?': '=epic', 'target?': '=task|plan|epic|ref' } },
  landing: { provider: 's', onEpicDone: '=propose|auto|off', 'prepare?': 's', 'suites?': ['s'], baseline: '=tolerate|strict', 'args?': { '*': 'a' }, 'envPass?': ['s'], 'union?': ['s'] },
  limits: Object.fromEntries(['reportRetries', 'shapeRetries', 'nudges', 'stagnantNudges', 'silentRuns', 'startFails', 'limitWaitMinutes', 'rebaseRounds', 'specAccepts'].map(k => [`${k}?`, 'i'])),
}
// one line of the shape each section expects, appended to a refusal of that section
const EX: Record<string, string> = {
  schema: '"schema": 2', types: '"types": {"note": {"pipeline": ["write", "land"], "acceptance": {"format": "what must be true", "cover": "none"}, "contract": "none"}}',
  steps: '"steps": {"write": {"role": "writer", "workspace": "worktree", "brief": ["description"]}, "land": {"gate": "integrate", "expect": "pass", "on": "write"}}',
  roles: '"roles": {"writer": {"description": "...", "prompt": "...", "tools": ["Read", "mcp__cadre__report"], "network": "off", "write": [], "ttl": "5m", "onSilent": "nudge", "report": {"outcomes": ["done"], "fields": {"summary": "text"}, "required": ["summary"]}}}',
  checks: '"checks": {"test": {"failExit": [1], "network": false}}', hooks: '"hooks": {"task.closed": [{"run": ["node", "${MODULES}/note.mjs"], "commit": "docs: ${id}"}]}',
  flags: '"flags": {"blocked": {"why": "...", "holds": false, "yolo": "human", "options": [{"key": "k", "label": "Keep", "effect": [{"do": "clear"}]}]}}',
  landing: '"landing": {"provider": "direct", "onEpicDone": "propose", "baseline": "tolerate", "union": ["CHANGELOG.md"]}', protected: '"protected": ["docs/generated/**"]', sandbox: '"sandbox": {"env": {"PATH": "${WT}/bin:${PATH}"}}',
  fields: '"fields": [{"name": "scope", "store": "meta", "required": false}]', limits: '"limits": {"rebaseRounds": 2}',
}
const alnum = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
const envName = (s: string) => !!s && !(s[0] >= '0' && s[0] <= '9') && [...s].every(c => alnum(c) || c === '_')
const plainPath = (s: string) => !!s && !s.startsWith('/') && !s.split('/').includes('..') && ![...s].some(c => ' *?[]#!\\\t'.includes(c))
const unknownNames = (s: string): string | null => { for (const [i, x] of s.split('${').entries()) { if (!i) continue; const e = x.indexOf('}'); if (e < 0 || !NAMES.includes(x.slice(0, e))) return x.slice(0, e < 0 ? 12 : e) } return null }
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : obj(v) ? Object.values(v).flatMap(strings) : [])

// the structural rules no single key shows (plan 2.1): every reference resolves, every pipeline is legal, every effect and `${NAME}` is in its closed set. null = fine
export function cross(p: Profile, own?: ProfileLayer): string | null {
  const S = p.steps, T = p.types
  for (const [id, s] of Object.entries(S)) {
    if ('role' in s ? !p.roles[s.role] : !(s.gate in p.checks) && !GATES.includes(s.gate)) return `steps.${id}.${'role' in s ? 'role' : 'gate'}: no ${'role' in s ? `role "${s.role}"` : `check "${s.gate}"`} in ${'role' in s ? 'roles' : 'checks'}`
    if (!('role' in s) && !Object.hasOwn(S, s.on)) return `steps.${id}.on: no step "${s.on}"`
    const b = s.onFail?.then; if (obj(b) && !Object.hasOwn(S, b.back as string)) return `steps.${id}.onFail.then.back: no step "${b.back}"`
  }
  const g = GATES.find(k => k in p.checks); if (g) return `checks.${g}: "${g}" is a built-in gate, not a check name`
  for (const [t, sp] of Object.entries(T)) for (const list of [sp.pipeline, ...(sp.lite ? [sp.lite] : [])]) {
    const at = `types.${t}`, bad = list.find(s => !Object.hasOwn(S, s)); if (!list.length) return `${at}: the pipeline is empty`; if (bad) return `${at}: no step "${bad}"`
    const dup = list.find((s, i) => list.indexOf(s) !== i); if (dup) return `${at}: step "${dup}" appears twice`
    for (const [i, s] of list.entries()) { const st = S[s]; if ('gate' in st && !(list.indexOf(st.on) >= 0 && list.indexOf(st.on) < i)) return `${at}: gate "${s}" must come after its step "${st.on}"` }
    for (const [i, s] of list.entries()) { const st = S[s], nx = S[list[i + 1]]; if ('role' in st && st.workspace === 'none' && !p.roles[st.role]?.verdict && nx && 'gate' in nx && nx.gate !== 'report') return `${at}: gate "${list[i + 1]}" follows the read-only step "${s}", which leaves no tree to check; only a role step or the report gate may follow it` }   // explorerDone closes at the report gate; no engine path runs a check there
    const land = list.findIndex(s => { const st = S[s]; return 'gate' in st && st.gate === 'integrate' }), last = list.findLastIndex(s => { const st = S[s]; return 'role' in st && !!p.roles[st.role]?.verdict })
    if (land >= 0 && (land !== list.length - 1 || land < last)) return `${at}: the integrate gate must be last and after every review step`
  }
  for (const [k, f] of Object.entries(p.flags)) for (const o of f.options) {
    if (o.effect.length < 1 || o.effect.length > 6) return `flags.${k}.options.${o.key}.effect: 1 to 6 effects`
    for (const e of o.effect) {
      const bad = Object.keys(e).find(x => x !== 'do' && !(PARAMS[e.do] ?? []).includes(x)); if (bad) return `flags.${k}.options.${o.key}: effect "${e.do}" takes no "${bad}"`
      if (e.counter !== undefined && !COUNTERS.includes(e.counter)) return `flags.${k}.options.${o.key}: no counter "${e.counter}" (${COUNTERS.join(', ')})`
    }
  }
  for (const [ev, hs] of Object.entries(p.hooks)) for (const h of hs) if ('role' in h ? !p.roles[h.role] : !h.run.length || !h.run[0]) return `hooks.${ev}: ${'role' in h ? `no role "${h.role}"` : 'a hook runs an argument list: ["node", "${MODULES}/x.mjs"], not an empty one'}`
  for (const k of [p.landing.prepare, ...(p.landing.suites ?? [])]) if (k !== undefined && !(k in p.checks)) return `landing: no check "${k}" in checks`
  const names = [...(p.landing.envPass ?? []), ...Object.values(p.hooks).flat().flatMap(x => ('envPass' in x ? x.envPass ?? [] : []))]
  for (const n of names) if (!envName(n)) return `envPass: "${n}" is not an environment variable name (letters, digits and _, not starting with a digit)`
  for (const u of p.landing.union ?? []) if (!plainPath(u)) return `landing.union: "${u}" is not a plain repo-relative path (no spaces, no * ? [ ] # !, no .. , not absolute)`
  for (const f of p.fields) if (Array.isArray(f.required) && f.required.find(t => !(t in T))) return `fields.${f.name}.required: no type "${f.required.find(t => !(t in T))}"`
  for (const [n, r] of Object.entries(p.roles)) { const why = n in DEFAULT.roles ? (own?.roles && n in own.roles ? 'a built-in role cannot be redefined; give yours another name' : null) : customIssue(n, r); if (why) return `roles.${n}: ${why}` }
  for (const k of ['sandbox', 'hooks', 'landing'] as const) { const u = strings(p[k]).map(unknownNames).find(x => x !== null); if (u !== undefined) return `${k}: no \${${u}} (${NAMES.join(', ')})` }
  return null
}

// ---- merge: per section and per key, the upper layer wins; lists and scalars replace whole (plan 2.1a). Fields merge by name, flags by kind ----
function merge(b: Profile, l: ProfileLayer): Profile {
  const out: Record<string, unknown> = { ...b }
  for (const [k, v] of Object.entries(l)) out[k] = k === 'fields' ? [...b.fields.filter(x => !(v as Profile['fields']).some(y => y.name === x.name)), ...(v as Profile['fields'])] : k === 'protected' || k === 'schema' ? v : k === 'sandbox' ? { env: { ...b.sandbox.env, ...(v as Profile['sandbox']).env } } : { ...(b as any)[k], ...(v as object) }
  return out as Profile
}
const refuse = (layer: string, msg: string) => { const k = msg.split('.')[0].split('[')[0].split(':')[0]; return `${layer}: ${msg}; ${EX[k] ? `example: ${EX[k]}` : `sections: ${Object.keys(SCHEMA).join(', ')}`}` }
export const check = (l: unknown): string | null => walk(l, Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [`${k}?`, s])), '')

// a module file in `dir`: a plain `<name>.mjs` that exists there and is a regular file under it (no link out of it, and the folder itself is no link either). The profile's `${MODULES}` paths
// and a user-bound sync adapter module (core/syncrun) share this check.
export async function moduleBad(h: Host, dir: string, name: string): Promise<'name' | 'none' | undefined> {
  if (!name || name.includes('/') || name.includes('..') || !name.endsWith('.mjs')) return 'name'
  const real = dir && (await h.stat(dir))?.kind === 'dir' ? (await h.stat(dir, { resolve: true }))?.realPath : undefined, st = await h.stat(`${dir}/${name}`), at = (await h.stat(`${dir}/${name}`, { resolve: true }))?.realPath
  return st?.kind === 'file' && real && at === `${real}/${name}` ? undefined : 'none'
}
// `${MODULES}/<name>.mjs` of a layer: a plain file name that exists in that layer's modules folder (the plugin's, or the repo's .cadre/modules)
async function modules(h: Host, l: ProfileLayer, dir: string): Promise<string | null> {
  const mine = [...Object.values(l.hooks ?? {}).flat().flatMap(x => ('run' in x ? x.run : [])), ...(l.landing?.provider ? [l.landing.provider] : [])].filter(s => s.includes('${MODULES}'))
  for (const s of mine) {
    const bad = s.startsWith('${MODULES}/') ? await moduleBad(h, dir, s.slice('${MODULES}/'.length)) : 'name'
    if (bad === 'name') return `${s}: a module path is \${MODULES}/<name>.mjs, a plain file name`
    if (bad) return `${s}: no such module in ${dir.endsWith('/.cadre/modules') ? '.cadre/modules' : 'the module folder'}`
  }
  return null
}
const expand = (l: ProfileLayer, dir: string): ProfileLayer => JSON.parse(JSON.stringify(l).split('${MODULES}').join(dir))   // ${MODULES} per origin layer, once the module paths are checked

export type Loaded = { profile: Profile; name: string; user?: string; repo?: string; bad?: string; owner: Record<string, string> }   // user/repo: the layer's file ('inline', '.cadre/profile.json') or absent; bad: why the repo layer is refused
let LOADED: Loaded | undefined
export const loaded = (): Loaded | undefined => LOADED
export async function loadProfile(h: Host): Promise<Loaded> {
  const cfg = await cfgOf(h), root = await h.cwd(), c = cfg.profile as unknown, name = typeof c === 'string' ? c : 'default', plugin = (r => r ? `${r}/modules` : '')(await h.root?.())
  const out: Loaded = { profile: DEFAULT, name, owner: {} }
  const base = BUILTIN[name]; if (!base) out.name = 'default'
  let p = { ...DEFAULT, ...(base ?? DEFAULT), flags: { ...DEFAULT.flags, ...(base ?? DEFAULT).flags } } as Profile   // a built-in profile replaces the sections it names; its flag rows go over the default's
  if (plugin) p = expand(p, plugin) as Profile   // the built-in hooks run the plugin's modules
  const own = (l: ProfileLayer, who: string) => { for (const k of ['types', 'steps', 'roles', 'checks', 'flags']) for (const x of Object.keys((l as any)[k] ?? {})) out.owner[`${k}.${x}`] = who }
  own(base ?? DEFAULT, out.name)
  const layer = async (who: string, l: unknown, dir: string, repo: boolean): Promise<string | null> => {
    const only = repo && obj(l) ? ['adapters', 'credentialEnv'].find(k => k in l) : undefined, e = only ? `${only}: a user-level key, not allowed in a repo profile` : check(l); if (e) return refuse(who, e)
    const x = await modules(h, l as ProfileLayer, dir); if (x) return refuse(who, x)
    const u = expand(l as ProfileLayer, dir), q = merge(p, u), r = cross(q, u); if (r) return refuse(who, r)
    p = q; own(u, repo ? 'repo' : 'user'); return null
  }
  if (!base) out.user = refuse('profile', `profile "${name}": no such built-in profile (${Object.keys(BUILTIN).join(', ')})`)
  const e0 = cross(p); if (e0) throw new Error(`the built-in profile ${out.name} is invalid: ${e0}`)
  if (obj(c)) { const e = await layer('user profile', c, plugin, false); if (e) out.user = e; else out.user = 'inline' }
  const raw = await h.readText(`${root}/.cadre/profile.json`)
  if (raw !== null) {
    let l: unknown; try { l = JSON.parse(raw) } catch { l = undefined }
    const creds = Object.values((cfg.adapters ?? {}) as Record<string, any>).map(a => a?.credentialEnv).filter(Boolean) as string[], leak = strings(l).find(s => creds.includes(s))
    const e = l === undefined ? refuse('repo profile', 'not valid JSON') : leak ? refuse('repo profile', `landing: ${leak} is a credential name the user configured; a repo profile cannot pass it on`) : await layer('repo profile', l, `${root}/.cadre/modules`, true)
    if (e) out.bad = e; else out.repo = '.cadre/profile.json'
  }
  out.profile = p
  return out
}
// at session start (hooks/register): the profile is loaded once and fixed for the session; the engine reads it through core/pipeline (and core/flags, core/roles)
export async function bootProfile(h: Host): Promise<Loaded> { LOADED = await loadProfile(h); setProfile(LOADED.profile); await unionAttrs(h).catch(() => undefined); return LOADED }
export const resetProfile = (): void => { LOADED = undefined }
// `/cadre profile` (read-only): the active profile, which layer each entry came from, what cannot run, and the refusals of a layer that was not taken
export async function describe(h: Host): Promise<string> {
  const l = loaded() ?? (await loadProfile(h)), p = l.profile, by = (sec: string, keys: string[]) => Object.entries(keys.reduce((o: Record<string, string[]>, k) => { (o[l.owner[`${sec}.${k}`] ?? l.name] ??= []).push(k); return o }, {})).map(([w, ks]) => `${ks.join(', ')} (${w})`).join(' · ') || 'none'
  const files = [...Object.values(p.hooks).flat().flatMap(x => ('run' in x ? x.run : [])), p.landing.provider].filter(s => s.startsWith('/') && s.endsWith('.mjs')), gone: string[] = []
  for (const f of files) if (!(await h.stat(f))) gone.push(f.split('/').slice(-2).join('/'))
  return [`profile ${l.name}${l.user === 'inline' ? ' + your own layer' : ''}${l.repo ? ` + ${l.repo}` : ''}`, ...(l.user && l.user !== 'inline' ? [`your profile is refused: ${l.user}`] : []), ...(l.bad ? [`repo profile invalid: ${l.bad.slice('repo profile: '.length)} (cadre stays off for this repo)`] : []),
    ...(['types', 'steps', 'roles', 'checks', 'flags'] as const).map(s => `${s}: ${by(s, Object.keys(p[s]))}`), `hooks: ${Object.entries(p.hooks).map(([e, hs]) => `${e} ${hs.length}`).join(', ') || 'none'} · landing: ${p.landing.provider}`,
    `unrunnable: ${gone.length ? `no module ${gone.join(', ')}` : 'none'}`].join('\n')
}
