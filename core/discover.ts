// Init discovery checks (DESIGN 10.2, ADR 0010): the package list's shape (parse) and the jailed runs that validate it. Pure helpers + h.run; no language logic.
import type { Host } from '../types'
import * as G from './git'

export interface Pkg {
  root: string; setup: string[]; checks: Record<string, string[]>; fetches?: string[]
  tdd?: { paths: string[]; report?: string; stubs?: string[]; skeleton?: string[] }; viewInclude?: string[]
  kind?: Kind; ownGit?: boolean; concurrency?: number; runner?: 'junit' | 'text'; routing?: Record<string, { model: string; effort?: string }>   // a workspace unit (H7); its adopted test command is checks.test (core/tdd.adopt)
}
export const KINDS = ['package', 'service', 'submodule', 'app'] as const
type Kind = typeof KINDS[number]
export const RUNNERS = ['junit', 'text']
// the workspace units (no kind = package). The config's own objects: core/tdd.adopt updates one in place
export const unitsOf = (cfg: { units?: unknown[] }): Pkg[] => (cfg.units ?? []) as Pkg[]
// the unit that owns a repo path: the longest root it lies under
export const ownerOf = <T extends { root: string }>(us: T[], f: string): T | undefined => us.filter(u => u.root === '.' || f === u.root || f.startsWith(`${u.root}/`)).sort((a, b) => b.root.length - a.root.length)[0]
export type Verdict = 'pass' | 'red' | 'net' | 'knownRed'
export interface Run { setupOk: boolean; caches: string[]; results: Record<string, Verdict>; junit?: boolean }

const isArgv = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x !== '')
// the `units` list of .cadre/config.json (written by Claude during init): shape check, with an example in every refusal
export function parse(ps: any, key = 'units'): Pkg[] | string {
  if (!Array.isArray(ps) || !ps.length) return `${key}: expected [{root, setup, checks, tdd}], e.g. {"root":".","setup":["npm","ci"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}`
  for (const [i, p] of ps.entries()) {
    const at = `${key}[${i}]`
    if (typeof p?.root !== 'string' || p.root.startsWith('/') || p.root.split('/').includes('..')) return `${at}.root: expected a repo-relative path like "." or "packages/api"`
    if (p.setup !== undefined && !(Array.isArray(p.setup) && !p.setup.length) && !isArgv(p.setup)) return `${at}.setup: expected an argv array like ["npm","ci"], or [] when the repo has no setup step`
    const cs = Object.entries(p.checks ?? {}); if (!cs.length || cs.some(([, a]) => !isArgv(a))) return `${at}.checks: expected {"test":["npm","test"]}`
    if (p.tdd?.report && !String(p.tdd.report).startsWith('/tmp/cadre/')) return `${at}.tdd.report: must be under /tmp/cadre/`
    if (p.fetches && p.fetches.some((f: string) => !(f in p.checks))) return `${at}.fetches: must name checks`
    if (p.kind !== undefined && !KINDS.includes(p.kind)) return `${at}.kind: one of ${KINDS.join(', ')}`
    if (p.ownGit !== undefined && typeof p.ownGit !== 'boolean') return `${at}.ownGit: true when the unit is its own git repository (a submodule), else false`
    if (p.concurrency !== undefined && !(Number.isInteger(p.concurrency) && p.concurrency > 0)) return `${at}.concurrency: expected a whole number above 0 (tasks of this unit at once)`
    if (p.runner !== undefined && !RUNNERS.includes(p.runner)) return `${at}.runner: ${RUNNERS.join(' or ')} (junit reads a JUnit report, text reads the output)`
    if (p.routing !== undefined && (typeof p.routing !== 'object' || Object.values(p.routing).some((c: any) => typeof c?.model !== 'string'))) return `${at}.routing: expected {"worker":{"model":"opus","effort":"high"}}`
  }
  return ps.map(p => ({ ...p, setup: p.setup ?? [] }))
}

// Depth <= 2 entries written under $HOME, parents dropped when a child is listed, build/target dirs never proposed.
export const caches = (found: string): string[] => {
  const all = found.split('\n').map(l => l.trim().replace(/^\.\//, '')).filter(Boolean).filter(l => !l.split('/').some(s => /^(target|build|dist)$/.test(s)))
  return [...new Set(all)].filter(p => !all.some(q => q !== p && q.startsWith(p + '/'))).sort()
}

const sh = (h: Host, argv: string[], cwd?: string) => h.run(argv, { cwd, timeoutMs: 600000 })

// One throwaway worktree at HEAD: setup (home-jail when auditing, writable jail with confirmed binds when validating), then every check offline (G.checkRun).
// Jail modes (G.jailMode): overlay = $HOME overlay + tmp-overlay; copy (bwrap w/o overlay, A19) = HOME=<empty scratch> audit + copied tree; none = unjailed, network unenforced, no caches learned.
export async function exec(h: Host, root: string, home: string, pkg: Pkg, o: { audit: boolean; caches?: string[]; knownRed?: string[] }): Promise<Run> {
  const scratch = `${home}/.cache/cadre/init-${h.rand(4)}`   // never under /tmp: the jail binds scratch AT /tmp and would mask wt
  const wt = `${scratch}/wt`, pkgRoot = pkg.root === '.' ? wt : `${wt}/${pkg.root}`, sh0 = `${scratch}/home`
  const out: Run = { setupOk: false, caches: [], results: {} }
  const mode = await G.jailMode(h.run), writable = (o.caches ?? []).map(c => `${home}/${c}`), J = (argv: string[]) => ({ wt, scratch, pkgRoot, argv, writable })
  const setup = (): Promise<{ exitCode: number }> => {
    if (!pkg.setup.length) return Promise.resolve({ exitCode: 0 })   // no setup step
    if (mode === 'none') return sh(h, pkg.setup, pkgRoot)
    const j = J(pkg.setup)
    return sh(h, !o.audit ? G.writableJail(j) : mode === 'overlay' ? G.homeJail({ ...j, home }) : G.homeScratchJail({ ...j, scratchHome: sh0 }))
  }
  try {
    await sh(h, ['mkdir', '-p', `${scratch}/home-up`, `${scratch}/home-work`, `${scratch}/cadre`, sh0])
    const add = await sh(h, ['git', 'worktree', 'add', '--detach', wt, 'HEAD'], root); if (add.exitCode) return out
    out.setupOk = (await setup()).exitCode === 0
    if (o.audit && mode !== 'none' && out.setupOk) out.caches = caches((await sh(h, ['find', '.', '-mindepth', '1', '-maxdepth', '2', '-type', 'd'], mode === 'overlay' ? `${scratch}/home-up` : sh0)).stdout)
    if (out.setupOk) for (const [n, argv] of Object.entries(pkg.checks)) {
      if (o.knownRed?.includes(n)) { out.results[n] = 'knownRed'; continue }
      const r = (await G.checkRun(h.run, mode, J(argv))).exitCode === 0
      out.results[n] = r ? 'pass' : pkg.fetches?.includes(n) ? 'net' : 'red'
    }
    if (pkg.tdd?.report && out.setupOk) out.junit = /<testsuites?[\s>]/.test((await h.readText(`${scratch}${pkg.tdd.report.slice(4)}`)) ?? '')
  } finally { await sh(h, ['git', 'worktree', 'remove', '--force', wt], root).catch(() => {}); await sh(h, ['rm', '-rf', scratch]).catch(() => {}) }
  return out
}
