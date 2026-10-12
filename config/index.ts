// Config layers (DESIGN 12): defaults -> userConfig -> $HOME/.claude/cadre.json (+ repo section) -> repo .cadre/config.json -> env -> /cadre config set.
// A bad layer is skipped with a diagnostic. The repo layer may only TIGHTEN S keys and may not set U keys.
import type { Host } from '../types'
import { CLASS, OPEN, TIGHTEN, defaults } from './defaults'
import type { Cls, Config } from './defaults'

export { defaults } from './defaults'
export type { Config } from './defaults'
export type Trust = 'user' | 'repo'
export interface Layer { name: string; trust: Trust; value: unknown }

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const classOf = (path: string): Cls => {
  for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf('.')))) { if (CLASS[p]) return CLASS[p] }
  return 'O'
}
const isOpen = (path: string) => OPEN.some(o => path === o || path.startsWith(o + '.'))

// what a repo layer may do to an S key: result of tightening `base` with `val`
export function tighten(path: string, base: unknown, val: unknown): unknown {
  const r = TIGHTEN[path]; if (!r) return base
  if (r[0] === 'bool') return val === r[1] ? val : base
  if (r[0] === 'enum') { const o = r.slice(1); return o.indexOf(String(val)) > o.indexOf(String(base)) ? val : base }
  return Array.isArray(base) && Array.isArray(val) ? base.filter(x => val.includes(x)) : base
}

// merge one layer onto base; returns a new object and pushes a diagnostic for every ignored key
export function merge(base: Record<string, any>, layer: Record<string, any>, trust: Trust, diag: string[], path = ''): Record<string, any> {
  const out = { ...base }
  for (const [k, v] of Object.entries(layer)) {
    const p = path ? `${path}.${k}` : k
    if (!(k in base) && !isOpen(path)) { diag.push(`${p}: unknown key`); continue }
    const b = base[k]
    if (!isOpen(p) && b != null && (plain(b) !== plain(v) || Array.isArray(b) !== Array.isArray(v) || typeof b !== typeof v)) { diag.push(`${p}: expected ${Array.isArray(b) ? 'a list' : plain(b) ? 'an object' : typeof b}`); continue }
    if (plain(v) && plain(b) && !isOpen(p)) { out[k] = merge(b, v, trust, diag, p); continue }   // classes apply at the leaves
    if (trust === 'repo' && classOf(p) === 'U') { diag.push(`${p}: user-level only, ignored in the repo file`); continue }
    if (trust === 'repo' && p === 'packages' && Array.isArray(v)) { out[k] = relockKnownRed(base[k], v); continue }
    if (trust === 'repo' && TIGHTEN[p]) { const t = tighten(p, base[k], v); if (JSON.stringify(t) !== JSON.stringify(v)) diag.push(`${p}: the repo file may only tighten this key`); out[k] = t; continue }
    out[k] = v
  }
  return out
}
// packages[].knownRed is an S key: a repo package keeps only what the user layer already granted for that root
const relockKnownRed = (prev: any[] = [], repo: any[]) => repo.map(p => { const g = prev.find(x => x.root === p.root)?.knownRed ?? []; return { ...p, knownRed: Array.isArray(p.knownRed) ? g.filter((x: string) => p.knownRed.includes(x)) : g } })

// Pure: fold layers (lowest first) onto the defaults.
export function resolve(layers: Layer[]): { config: Config; diagnostics: string[] } {
  const diagnostics: string[] = []; let config: Record<string, any> = defaults()
  for (const l of layers) {
    if (!plain(l.value)) { if (l.value !== undefined) diagnostics.push(`${l.name}: not an object, skipped`); continue }
    const d: string[] = []; const m = merge(config, l.value, l.trust, d)
    diagnostics.push(...d.map(x => `${l.name}: ${x}`)); config = m   // ponytail: bad keys are dropped per key, the rest of the layer still applies
  }
  return { config: config as Config, diagnostics }
}

const parse = (name: string, text: string | null): Layer['value'] => { if (text == null) return undefined; try { return JSON.parse(text) } catch { return `bad json in ${name}` } }
const bool = (s?: string) => (s === undefined ? undefined : s === '1' || s === 'true')
// env layer: user-level trust, so it may relax S keys (CADRE_ALLOW_SDK_APPROVAL)
export const envLayer = (e: Record<string, string | undefined>): Record<string, unknown> => ({
  ...(e.CADRE_STRICTNESS ? { strictness: e.CADRE_STRICTNESS } : {}),
  ...(e.CADRE_STORE ? { store: { kind: e.CADRE_STORE } } : {}),
  ...(e.CADRE_ALLOW_SDK_APPROVAL !== undefined ? { approval: { allowSdk: bool(e.CADRE_ALLOW_SDK_APPROVAL) } } : {}),
  ...(e.CADRE_DISABLE !== undefined ? { disable: bool(e.CADRE_DISABLE) } : {}),
})

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

// Settings tab rows (DESIGN 12): every non-free-form key with its class, default, effective value and the layer that set it. Source = the last layer whose
// cumulative result differs from the one before it, so a repo value that was refused (tighten-only) is not the source. ponytail: a layer that sets a key to its default reads as [default].
export type Src = 'default' | 'user' | 'repo' | 'env'
export interface Row { key: string; cls: Cls; value: unknown; def: unknown; src: Src; kind: 'bool' | 'enum' | 'number' | 'text' | 'list'; opts?: string[] }
const ENUM: [RegExp, string[]][] = [[/^ui\.glyphs$/, ['unicode', 'ascii']], [/^roles\.\w+\.tier$/, ['fast', 'standard', 'deep']]]
export const optsOf = (key: string): string[] | undefined => (TIGHTEN[key]?.[0] === 'enum' ? (TIGHTEN[key] as string[]).slice(1) : ENUM.find(([r, o]) => o.length && r.test(key))?.[1])
const leaves = (o: unknown, p = ''): [string, unknown][] => (plain(o) && !isOpen(p) ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : isOpen(p) ? [] : [[p, o]])
const at = (o: unknown, path: string) => path.split('.').reduce((a: any, k) => a?.[k], o)
const srcOf = (n: string): Src => (n === 'env' ? 'env' : n === '.cadre/config.json' ? 'repo' : 'user')
export function rows(layers: Layer[]): Row[] {
  const steps = layers.map((_, i) => resolve(layers.slice(0, i + 1)).config)
  return leaves(defaults()).filter(([k]) => k).map(([key, def]) => {
    let src: Src = 'default', prev: unknown = def
    steps.forEach((c, i) => { const v = at(c, key); if (JSON.stringify(v) !== JSON.stringify(prev)) src = srcOf(layers[i].name); prev = v })
    const opts = optsOf(key)
    return { key, cls: classOf(key), value: prev, def, src, kind: typeof def === 'boolean' ? 'bool' : opts ? 'enum' : typeof def === 'number' ? 'number' : Array.isArray(def) ? 'list' : 'text', ...(opts ? { opts } : {}) }
  })
}

// Strictness as resolved from every layer (userConfig, ~/.claude/cadre.json, repo, env); hosts without a wired config fall back to env/userConfig.
export const strictOf = async (h: Host): Promise<string> =>
  (await (h as any).config?.().catch(() => undefined))?.strictness ?? (await h.env()).CADRE_STRICTNESS ?? h.options.strictness ?? 'strict'
