// Config layers (DESIGN 12): defaults -> userConfig -> $HOME/.claude/cadre.json (+ repo section) -> repo .cadre/config.json -> env -> /cadre config set.
// A bad key or value is refused with a diagnostic (doctor shows them). The repo layer may only TIGHTEN S keys and may not set U keys. Metadata: REG (config/defaults).
import type { Host } from '../types'
import { repoKeyOf } from '../commands/init'
import { modelIssues } from '../core/queue'
import { customIssue } from '../core/roles'
import { CATS, REG, defaults } from './defaults'
import type { Cat, Cls, Config, Meta } from './defaults'

export { defaults, REG, CATS } from './defaults'
export type { Config, Cat, Meta } from './defaults'
export type Trust = 'user' | 'repo'
export interface Layer { name: string; trust: Trust; value: unknown }

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// a key, or the free-form key it lives under
const metaOf = (path: string): Meta | undefined => { for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf('.')))) if (REG[p]) return REG[p]; return undefined }
export const classOf = (path: string): Cls => metaOf(path)?.cls ?? 'O'
const isOpen = (path: string) => !!metaOf(path)?.open

// what a repo layer may do to an S key: result of tightening `base` with `val`
export function tighten(path: string, base: unknown, val: unknown): unknown {
  const r = REG[path]?.tighten; if (!r) return base
  if (r === 'enum') { const o = REG[path].opts!; return o.indexOf(String(val)) > o.indexOf(String(base)) ? val : base }
  if (r === 'min') return typeof val === 'number' && val < (base as number) ? val : base
  if (r === 'grow') return Array.isArray(base) && Array.isArray(val) ? [...new Set([...base, ...val])] : base
  return Array.isArray(base) && Array.isArray(val) ? base.filter(x => val.includes(x)) : base
}
// a value against its key's allowed values: null = fine, else why
export function check(path: string, v: unknown): string | null {
  const r = REG[path]; if (!r) return null
  if (r.opts && !r.opts.includes(String(v))) return `expected one of: ${r.opts.map(o => o || "''").join(', ')}`
  if (r.min !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < r.min || v > r.max!)) return `expected a number from ${r.min} to ${r.max}`
  return r.ok?.(v) ?? null
}

const RENAMED: Record<string, string> = { maxParallel: 'concurrency.default', packages: 'units' }
// merge one layer onto base; returns a new object and pushes a diagnostic for every ignored key
export function merge(base: Record<string, any>, layer: Record<string, any>, trust: Trust, diag: string[], path = ''): Record<string, any> {
  const out = { ...base }
  for (const [k, v] of Object.entries(layer)) {
    const p = path ? `${path}.${k}` : k
    if (!(k in base) && !isOpen(path)) { diag.push(RENAMED[p] ? `${p}: renamed: ${RENAMED[p]}` : `${p}: unknown key`); continue }
    const b = base[k]
    if (!isOpen(p) && b != null && !REG[p]?.ok && (plain(b) !== plain(v) || Array.isArray(b) !== Array.isArray(v) || typeof b !== typeof v)) { diag.push(`${p}: expected ${Array.isArray(b) ? 'a list' : plain(b) ? 'an object' : typeof b}`); continue }
    if (plain(v) && plain(b) && !isOpen(p)) { out[k] = merge(b, v, trust, diag, p); continue }   // classes apply at the leaves
    if (trust === 'repo' && p === 'roles.custom' && plain(v)) { out[k] = { ...Object.fromEntries(Object.entries(v).filter(([n, x]) => !(n in (b ?? {})) && !((e) => e && diag.push(`${p}.${n}: ${e}`))(customIssue(n, x, {})))), ...b }; continue }   // the repo file adds read-only roles (core/roles.customIssue); a name the user layer has stays the user's
    if (trust === 'repo' && classOf(p) === 'U') { diag.push(`${p}: user-level only, ignored in the repo file`); continue }
    if (trust === 'repo' && p === 'units' && Array.isArray(v)) { out[k] = relockKnownRed(base[k], v); continue }
    const bad = check(p, v); if (bad) { diag.push(`${p}: ${bad}`); continue }
    if (trust === 'repo' && REG[p]?.tighten) { const t = tighten(p, base[k], v); if (JSON.stringify(t) !== JSON.stringify(v)) diag.push(`${p}: the repo file may only tighten this key`); out[k] = t; continue }
    out[k] = v
  }
  return out
}
// units[].knownRed is an S key: a repo unit keeps only what the user layer already granted for that root
const relockKnownRed = (prev: any[] = [], repo: any[]) => repo.map(p => { const g = prev.find(x => x.root === p.root)?.knownRed ?? []; return { ...p, knownRed: Array.isArray(p.knownRed) ? g.filter((x: string) => p.knownRed.includes(x)) : g } })

// Pure: fold layers (lowest first) onto the defaults.
export function resolve(layers: Layer[]): { config: Config; diagnostics: string[] } {
  const diagnostics: string[] = []; let config: Record<string, any> = defaults()
  for (const l of layers) {
    if (!plain(l.value)) { if (l.value !== undefined) diagnostics.push(`${l.name}: not an object, skipped`); continue }
    const d: string[] = []; const m = merge(config, l.value, l.trust, d)
    diagnostics.push(...d.map(x => `${l.name}: ${x}`)); config = m   // ponytail: bad keys are dropped per key, the rest of the layer still applies
  }
  diagnostics.push(...modelIssues(config as Config))   // refused at load: the drive does not start (core/drive.gate), Doctor names the cell
  return { config: config as Config, diagnostics }
}

const parse = (name: string, text: string | null): Layer['value'] => { if (text == null) return undefined; try { return JSON.parse(text) } catch { return `bad json in ${name}` } }
const bool = (s?: string) => (s === undefined ? undefined : s === '1' || s === 'true')
// env layer: user-level trust, so it may relax S keys (CADRE_STRICTNESS)
export const envLayer = (e: Record<string, string | undefined>): Record<string, unknown> => ({
  ...(e.CADRE_STRICTNESS ? { strictness: e.CADRE_STRICTNESS } : {}),
  ...(e.CADRE_STORE ? { store: { kind: e.CADRE_STORE } } : {}),
  ...(e.CADRE_DISABLE !== undefined ? { disable: bool(e.CADRE_DISABLE) } : {}),
  ...(e.CADRE_SPAWN ? { drive: { spawn: e.CADRE_SPAWN } } : {}),
})
// ADR 0018: a non-interactive session (claude -p) exits once no agent runs, before an agent's turn end could start the next one: drive.spawn mod runs as main
// there, unless CADRE_SPAWN=mod says so (a driver that holds stream-json stdin open). Settings shows it as forced with this reason.
export const HEADLESS = 'a non-interactive session runs main: it ends once no agent runs, before cadre could start the next one (CADRE_SPAWN=mod with stream-json input overrides)'
export const headlessMain = (spawn: string, env: Record<string, string | undefined>, headless: boolean) => headless && spawn === 'mod' && env.CADRE_SPAWN !== 'mod'

// Every layer through the Host, lowest first. `repoKey` selects the per-repo section of the home file; `root` = main checkout.
export async function layersOf(h: Host, o: { home: string; root: string; repoKey: string }): Promise<Layer[]> {
  const homeRaw = parse('cadre.json', await h.readText(`${o.home}/.claude/cadre.json`)) as Record<string, any> | undefined
  const { repos, ...home } = plain(homeRaw) ? homeRaw : ({} as Record<string, any>)
  return [
    { name: 'userConfig', trust: 'user', value: h.options.strictness ? { strictness: h.options.strictness } : {} },
    { name: '~/.claude/cadre.json', trust: 'user', value: plain(homeRaw) ? home : homeRaw },
    { name: `~/.claude/cadre.json[${o.repoKey}]`, trust: 'user', value: plain(repos) ? repos[o.repoKey] : undefined },
    { name: '.cadre/config.json', trust: 'repo', value: parse('config.json', await h.readText(`${o.root}/.cadre/config.json`)) },
    { name: 'env', trust: 'user', value: envLayer(await h.env()) },
  ]
}
export const load = async (h: Host, o: { home: string; root: string; repoKey: string }) => resolve(await layersOf(h, o))

// The one read path (ADR 0019): every module reads the effective config through cfgOf (core/dispatch re-exports it); tests/settings-registry fails on a bypass.
// h.config (hooks/register) is this same load; a Host without it (tests, dev tools) loads the layers here.
export async function cfgOf(h: Host): Promise<Config> {
  const f = (h as any).config; if (f) return f()
  const root = await h.cwd(); return (await load(h, { home: await h.home(), root, repoKey: repoKeyOf(root) })).config
}
export const strictOf = async (h: Host): Promise<string> => (await cfgOf(h).catch(() => undefined))?.strictness ?? 'strict'

// what the repo file's own refusals are (unknown key, bad value or type, a safety key loosened, a user-level key): init re-checks them after every write (ADR 0019)
export async function repoFileDiag(h: Host): Promise<string[]> {
  const root = await h.cwd(), n = '.cadre/config.json: '
  return resolve(await layersOf(h, { home: await h.home(), root, repoKey: repoKeyOf(root) })).diagnostics.filter(d => d.startsWith(n)).map(d => d.slice(n.length))
}
// Claude Code env vars that beat cadre's routing (it applies them whatever cadre passes): FORCE=1 puts every agent on CLAUDE_CODE_SUBAGENT_MODEL (unset: main's model);
// CLAUDE_CODE_EFFORT_LEVEL beats every effort. CLAUDE_CODE_SUBAGENT_MODEL alone is only a default: cadre's agent.spawn model wins over it.
export function forcedOf(env: Record<string, string | undefined>): { model?: string; effort?: string } {
  const sm = env.CLAUDE_CODE_SUBAGENT_MODEL, f = /^(1|true)$/i.test(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? '')
  return { ...(f ? { model: sm && sm !== 'inherit' ? sm : "main's model" } : {}), ...(env.CLAUDE_CODE_EFFORT_LEVEL ? { effort: env.CLAUDE_CODE_EFFORT_LEVEL } : {}) }
}

// Settings rows (DESIGN 12, ADR 0019): every registered key with category, class, default, effective value and its source. Source = the last layer whose cumulative
// result differs from the one before it, so a refused repo value is not the source; 'forced' = a Claude Code env var overrides it (`warn` says how).
// ponytail: a layer that sets a key to its default reads as [default].
export type Src = 'default' | 'user' | 'repo' | 'env' | 'forced' | 'fixed' | 'tester'   // tester: a package's test check cadre adopted from the tester's command (ADR 0023)
export interface Row { key: string; cat: Cat; cls: Cls; desc: string; safety: boolean; value: unknown; def: unknown; src: Src; kind: 'bool' | 'enum' | 'number' | 'text' | 'list' | 'json'; opts?: string[]; warn?: string }
const leaves = (o: unknown, p = ''): [string, unknown][] => (plain(o) && !isOpen(p) ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [[p, o]])
export const keysOf = () => leaves(defaults()).map(([k]) => k)
const at = (o: unknown, path: string) => path.split('.').reduce((a: any, k) => a?.[k], o)
const srcOf = (n: string): Src => (n === 'env' ? 'env' : n === '.cadre/config.json' ? 'repo' : 'user')
export function rows(layers: Layer[], env: Record<string, string | undefined> = {}): Row[] {
  const steps = layers.map((_, i) => resolve(layers.slice(0, i + 1)).config), fo = forcedOf(env)
  return leaves(defaults()).map(([key, def]) => {
    let src: Src = 'default', prev: unknown = def
    steps.forEach((c, i) => { const v = at(c, key); if (JSON.stringify(v) !== JSON.stringify(prev)) src = srcOf(layers[i].name); prev = v })
    const r = REG[key], opts = r.opts as string[] | undefined, mf = fo.model && /^roles\.\w+\.(byRisk\.\w+\.(escalate\.)?)?model$/.test(key), ef = fo.effort && /^roles\.\w+\.(byRisk\.\w+\.(escalate\.)?)?effort$/.test(key)
    const warn = mf || ef ? [mf && `CLAUDE_CODE_SUBAGENT_MODEL_FORCE puts every agent on ${fo.model}`, ef && `CLAUDE_CODE_EFFORT_LEVEL puts every agent on effort ${fo.effort}`].filter(Boolean).join('; ') : undefined
    if (key === 'units' && src === 'repo' && Array.isArray(prev) && prev.some(p => p?.testBy === 'tester')) src = 'tester'
    return { key, cat: r.cat, cls: r.cls, desc: r.desc, safety: r.cls === 'S' || !!r.tighten, value: prev, def, src: warn ? 'forced' : src, kind: r.open ? 'json' : typeof def === 'boolean' ? 'bool' : opts ? 'enum' : typeof def === 'number' ? 'number' : Array.isArray(def) ? 'list' : 'text', ...(opts ? { opts } : {}), ...(warn ? { warn } : {}) }
  }).sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat))
}

// ASCII glyphs: `ui.glyphs: ascii`, TERM=dumb, or a non-UTF-8 locale (BRAND §6)
export const asciiOf = (glyphs: string | undefined, env: Record<string, string | undefined>): boolean => {
  if (glyphs === 'ascii') return true
  if (env.TERM === 'dumb') return true
  const loc = env.LC_ALL || env.LC_CTYPE || env.LANG || ''
  return loc !== '' && !/utf-?8/i.test(loc)
}

