// Stage 4 discovery (DESIGN 10.2): brief for the explorer, report{discovery} parsing, jailed runs (audit + validate). Pure helpers + h.run; no language logic.
import type { Host } from '../types'
import * as G from './git'

export interface Pkg {
  root: string; setup: string[]; checks: Record<string, string[]>; fetches?: string[]
  tdd?: { paths: string[]; report?: string; stubs?: string[]; skeleton?: string[] }; viewInclude?: string[]
}
export type Verdict = 'pass' | 'red' | 'net' | 'knownRed'
export interface Run { setupOk: boolean; caches: string[]; results: Record<string, Verdict>; junit?: boolean }

export const brief = (): string => `cadre discovery (read-only). Find how this repo is built and tested; CI config wins over prose.
Read: CI config, task runners, manifests, README/CONTRIBUTING, test dirs. Per package answer ONE mcp__cadre__report {role:"explorer", discovery:{packages:[
{root, setup:[argv] (or [] when none), checks:{name:[argv]}, fetches?:[names of checks whose CI step fetches at test time], tdd:{paths:[globs], report?:"/tmp/cadre/<n>.xml" (JUnit), stubs?:[argv], skeleton?:[argv]}, viewInclude?:[paths]}]}, citations:[{path,line}]}.
Every argv cites the file it came from. Commands only; no shell strings. Do not run anything.`

const isArgv = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x !== '')
export function parse(r: any): Pkg[] | string {
  const ps = r?.discovery?.packages
  if (!Array.isArray(ps) || !ps.length) return 'discovery.packages: expected [{root, setup, checks, tdd}], e.g. {"root":".","setup":["npm","ci"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}'
  if (!Array.isArray(r.citations) || !r.citations.length) return 'citations: expected [{path,line}] naming the files the argv came from'
  for (const [i, p] of ps.entries()) {
    const at = `discovery.packages[${i}]`
    if (typeof p?.root !== 'string' || p.root.startsWith('/') || p.root.split('/').includes('..')) return `${at}.root: expected a repo-relative path like "." or "packages/api"`
    if (p.setup !== undefined && !(Array.isArray(p.setup) && !p.setup.length) && !isArgv(p.setup)) return `${at}.setup: expected an argv array like ["npm","ci"], or [] when the repo has no setup step`
    const cs = Object.entries(p.checks ?? {}); if (!cs.length || cs.some(([, a]) => !isArgv(a))) return `${at}.checks: expected {"test":["npm","test"]}`
    if (p.tdd?.report && !String(p.tdd.report).startsWith('/tmp/cadre/')) return `${at}.tdd.report: must be under /tmp/cadre/`
    if (p.fetches && p.fetches.some((f: string) => !(f in p.checks))) return `${at}.fetches: must name checks`
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
