// Spec view (DESIGN 3.5.1, 3.5.3): the tester's tree, built by COPYING blobs (never symlinks) at the base, with a content hash per file and a call log for the audit.
// Paths in the view are package-relative: view/<p> <-> <wt>/<pkg.root>/<p>. Everything runs through h.run / h.write (ADR 0003).
import { modelText } from './say'
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { StoreError } from '../task-management/store'
import type { Deps } from './admission'
import { renderContract } from './briefs'
import * as G from './git'

export interface Pkg { root: string; setup?: string[]; checks: Record<string, string[]>; verify?: string[]; knownRed?: string[]; viewInclude?: string[]; tdd?: { check?: string; paths: string[]; report?: string; stubs?: string[]; skeleton?: string[] } }

// Longest segment-aware root prefix of the task's package (10.2.6).
export const pkgOf = (d: Deps, task: Pick<Task, 'meta'>): Pkg | undefined => {
  const all = d.cfg.packages as Pkg[], at = task.meta['cadre.package'] || (all.length === 1 ? all[0].root : '.')   // no package named: the only one there is (a monorepo with one package in kit/ blocked every unnamed task as "no package", live 0.9.1)
  return all.filter(p => p.root === '.' || at === p.root || at.startsWith(`${p.root}/`)).sort((a, b) => b.root.length - a.root.length)[0]
}
export const rootOf = (p?: Pkg) => (!p || p.root === '.' ? '' : p.root)
// jail: off = run unsandboxed; auto = the sandbox when this machine has one; on = the sandbox or nothing (the check fails with the reason)
export async function modeOf(h: Host, d: Pick<Deps, 'cfg'>): Promise<'overlay' | 'copy' | 'none'> {
  if (d.cfg.jail === 'off') return 'none'
  const m = await G.jailMode(h.run); if (m === 'none' && d.cfg.jail === 'on') throw new Error('checks cannot run here: the isolated runner they require is missing; ask the human to run /cadre doctor')
  return m
}

// Globs: `**` any depth, `*` within a segment, `?` one char; a bare directory matches everything under it.
export const globRe = (g: string) => new RegExp(`^${g.replace(/\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g, m => (m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : m === '?' ? '[^/]' : `\\${m}`))}$`)
export const matches = (globs: readonly string[], p: string) => globs.some(g => globRe(g).test(p) || p.startsWith(`${g.replace(/\/$/, '')}/`))

const sh = (h: Host, argv: string[], cwd?: string) => h.run(argv, { cwd, timeoutMs: 120000 })
const must = async (h: Host, argv: string[], cwd?: string) => { const r = await sh(h, argv, cwd); if (r.exitCode) throw new Error(`${argv[0]} failed: ${r.stderr.slice(0, 200)}`); return r.stdout }
const list = async (h: Host, dir: string, type: 'f' | 'l') => (await must(h, ['find', '.', '-type', type, '-print0'], dir)).split('\0').filter(Boolean).map(p => p.replace(/^\.\//, ''))

// path -> blob hash of every regular file under dir (git hash-object works outside a repo; --no-filters = raw bytes)
export async function hashes(h: Host, dir: string): Promise<Record<string, string>> {
  const files = (await list(h, dir, 'f')).sort(), out: Record<string, string> = {}
  for (let i = 0; i < files.length; i += 200) {
    const part = files.slice(i, i + 200), lines = (await must(h, ['git', 'hash-object', '--no-filters', '--', ...part], dir)).split('\n')
    part.forEach((f, k) => { out[f] = lines[k] })
  }
  return out
}

// Build `<wtRoot>/<repoKey>.views/<id>/` (outside the worker allowWrite). Source = the spec commit when a spec exists (rebuild after accept), else the base. Returns the view path.
export async function buildView(h: Host, d: Deps, task: Task, wt: string): Promise<string> {
  const pkg = pkgOf(d, task), root = rootOf(pkg), paths = pkg?.tdd?.paths ?? []
  if (!paths.length) throw new StoreError('Invalid', `${task.id}: its package has no test paths (tdd.paths); ask the human to run /cadre init`)
  const view = `${d.wtRoot}/${d.key}.views/${task.id}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}-view`, src = task.meta['cadre.specCommit'] ?? task.meta['cadre.base'] ?? (await G.tip(h.run, wt, 'HEAD'))
  await sh(h, ['rm', '-rf', view, scratch]); await must(h, ['mkdir', '-p', view, `${scratch}/x`, `${scratch}/stubs`])
  const want = [...paths, ...(pkg?.viewInclude ?? [])], take: string[] = []
  for (const rec of (await G.git(h.run, wt, ['ls-tree', '-r', '-z', '--full-tree', src])).split('\0').filter(Boolean)) {   // "<mode> <type> <sha>\t<path>"
    const tab = rec.indexOf('\t'), mode = rec.slice(0, 6), path = rec.slice(tab + 1)
    if (root && !path.startsWith(`${root}/`)) continue
    if (!matches(want, root ? path.slice(root.length + 1) : path)) continue
    if (mode === '100644' || mode === '100755') take.push(path); else h.log(`view ${task.id}: skipped ${path} (mode ${mode}, not a regular file)`)
  }
  if (take.length) {
    await G.git(h.run, wt, ['archive', '--format=tar', '-o', `${scratch}/v.tar`, src, '--', ...take]); await must(h, ['tar', '-xf', `${scratch}/v.tar`, '-C', `${scratch}/x`])
    await must(h, ['cp', '-a', `${scratch}/x/${root ? `${root}/` : ''}.`, view])
  }
  // FILES.md: the agent's tools cannot list directories, so the view names its files. SCENARIOS.md: a lite bug fix (ADR 0011) has no scenarios; its
  // title and description are the bug to reproduce (live 0.8.0: an empty spec left the tester nothing to make red). Dev reasons stay here, never in the text.
  await h.write(`${view}/FILES.md`, modelText('agent-file', `# Files in this view\n\nRead these files for this project's test conventions (runner, import style, naming):\n\n${take.map(p => `- ${root ? p.slice(root.length + 1) : p}`).join('\n') || '(none)'}\n`))
  const bug = `No scenarios were written for this fix. Write one test that reproduces the bug described below: it must fail now and pass once the bug is fixed.\n\n${task.title}\n${task.description ?? ''}`
  await h.write(`${view}/SCENARIOS.md`, modelText('agent-file', `# Scenarios ${task.id}\n\n${task.acceptance?.trim() ? task.acceptance : bug}\n`))
  await h.write(`${view}/INTERFACE.md`, modelText('agent-file', `# Interface ${task.id}\n\n${renderContract(task.design)}\n\n\`\`\`json\n${task.design ?? ''}\n\`\`\`\n`))
  if (pkg?.tdd?.stubs) {   // generator output only, run in the offline jail; CADRE_OUT is where it writes
    const mode = await modeOf(h, d), out = mode === 'none' ? `${scratch}/stubs` : '/tmp/stubs', cwd = root ? `${wt}/${root}` : wt
    const r = await G.checkRun(h.run, mode, { wt, scratch, pkgRoot: cwd, argv: pkg.tdd.stubs, env: { CADRE_OUT: out } })
    if (r.exitCode) throw new StoreError('Invalid', `${task.id}: stubs failed: ${r.stderr.slice(-200)}`)
    await must(h, ['cp', '-a', `${scratch}/stubs/.`, view])
  }
  for (const l of await list(h, view, 'l')) { await sh(h, ['rm', '-f', `${view}/${l}`]); h.log(`view ${task.id}: dropped symlink ${l}`) }
  await d.store.setMeta(task.id, { 'cadre.view': JSON.stringify(await hashes(h, view)) }, d.actor)
  await sh(h, ['rm', '-rf', scratch])
  return view
}

// ---- call log (3.5.2): w3-reuse's tool.call wrap calls logCall for every tester call; the audit reads it ----
const lk = (agentId: string) => `cadre:tlog:${agentId}`
export interface Call { tool: string; path?: string; outcome: string }
export async function logCall(h: Host, agentId: string, call: Call): Promise<void> {
  const q = ((await h.store.get(lk(agentId))) as Call[] | undefined) ?? []
  await h.store.set(lk(agentId), [...q, call].slice(-300))
}

// ---- audit at report (3.5.3): hashes vs the build; only files under tdd.paths may differ ----
export interface Audit { changed: string[]; outside: string[]; calls: number; denied: number; text: string }
export async function auditView(h: Host, d: Deps, task: Task, view: string, agentId?: string): Promise<Audit> {
  const built = JSON.parse(task.meta['cadre.view'] ?? '{}') as Record<string, string>, now = await hashes(h, view), paths = pkgOf(d, task)?.tdd?.paths ?? []
  const changed = [...new Set([...Object.keys(built), ...Object.keys(now)])].filter(p => built[p] !== now[p]).sort(), outside = changed.filter(p => !matches(paths, p) || p === 'SCENARIOS.md' || p === 'INTERFACE.md')
  const log = agentId ? ((await h.store.get(lk(agentId))) as Call[] | undefined) ?? [] : [], denied = log.filter(c => c.outcome !== 'ok').length
  const text = `tester audit: ${changed.length} file(s) changed, ${outside.length} outside tdd.paths${outside.length ? ` (${outside.slice(0, 5).join(', ')})` : ''}; ${log.length} call(s), ${denied} refused`
  if (agentId) await h.store.del(lk(agentId))
  await d.store.comment(task.id, `[cadre:tester-log v1] ${text}`, d.actor)
  return { changed, outside, calls: log.length, denied, text }
}
