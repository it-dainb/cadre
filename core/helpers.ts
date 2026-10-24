// The setup and probe helpers (core/needs). Setup: the helper only PROPOSES an install argv; cadre vets it against a per-ecosystem allowlist (structured argv matching, never a
// shell string), runs it in the requester's folder in the home-scratch jail (network on), checks offline, and commits only manifests and lockfiles on the task branch.
// The worker's own edits are never touched: the folder is checkpointed first, afterwards only the paths the run changed are committed or discarded.
// Probe: a throwaway worktree on a `probe/` branch (not protected, never landed or pushed), removed on every end path and swept at session.start.
import type { Host } from '../types'
import * as G from './git'

const MANIFEST = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|requirements[\w.-]*\.txt|pyproject\.toml|uv\.lock|poetry\.lock|Cargo\.(toml|lock)|go\.(mod|sum))$/
const OPS = /^(\||\|\||&&?|;|>>?|<)$|[|;`\n]|&&|\$\(/   // a shell operator, as its own argument or inside one
const GLOBAL = /^(-g|--global|--user|--system|--location=global)$/
// program -> the subcommand tokens that follow it; `.venv/pip` is the repository's own virtualenv pip, the only pip allowed
const ALLOW: Record<string, string[][]> = { npm: [['install'], ['i'], ['add']], pnpm: [['add'], ['install'], ['i']], yarn: [['add'], ['install']], uv: [['add'], ['pip', 'install']], poetry: [['add']], cargo: [['add']], go: [['get']], '.venv/pip': [['install']] }

// the argv to run (scripts off where the ecosystem has the flag), or why it is refused
export function vet(argv: unknown, root: string): string[] | string {
  if (!Array.isArray(argv) || !argv.length || argv.length > 64 || !argv.every(a => typeof a === 'string' && a && a.length < 500)) return 'argv: expected the install command as a list of arguments, e.g. ["npm","install","left-pad"]'
  const [p, ...rest] = argv as string[], key = p === `${root}/.venv/bin/pip` ? '.venv/pip' : p
  if (argv.some(a => OPS.test(a as string))) return 'the command has a shell operator; give one plain command'
  if ((argv as string[]).some(a => GLOBAL.test(a)) || rest.some((a, i) => a === '--location' && rest[i + 1] === 'global')) return 'global and user-wide installs are not allowed; install into this project'
  if (!Object.hasOwn(ALLOW, key) || !ALLOW[key].some(s => s.every((t, i) => rest[i] === t))) return `${p} ${rest[0] ?? ''} is not an install command that may be run here; use npm, pnpm, yarn, uv, poetry, cargo add, go get, or the project's own .venv pip`
  return /^(npm|pnpm|yarn)$/.test(p) ? [...(argv as string[]), '--ignore-scripts'] : (argv as string[])
}

// the one-time per-repo approval: the user's own layer, keyed by repo root; a committed repo file cannot hold it
const FILE = async (h: Host) => `${await h.home()}/.claude/cadre/deps.json`
const read = async (h: Host): Promise<Record<string, boolean>> => { try { return JSON.parse((await h.readText(await FILE(h))) ?? '{}') } catch { return {} } }
export const approved = async (h: Host, root: string) => (await read(h))[root] === true
export const approve = async (h: Host, root: string) => h.write(await FILE(h), JSON.stringify({ ...(await read(h)), [root]: true }, null, 1))

export interface SetupIn { root: string; wt: string; cwd?: string; scratch: string; ask: string; argv: unknown; auto: boolean; check?: string[]; strays?: number; checkpoint: () => Promise<unknown> }
export interface SetupOut { text: string; dialog?: string; allow?: true; stray?: true }   // dialog: nothing ran, the human decides; stray: a path besides manifests was discarded
const HOLD = 'The install was not run: it waits for the user. Go on without it, or report outcome "blocked" naming what you need.'
const scrub = (s: string) => s.trim().split('\n').filter(Boolean).slice(-1)[0]?.replace(/\/[^\s'"]+/g, '…').slice(0, 200) ?? ''   // no host paths in what a model reads
export async function setup(h: Host, o: SetupIn): Promise<SetupOut> {
  const v = vet(o.argv, o.root); if (typeof v === 'string') return { text: `The install was refused: ${v}. Report outcome "blocked" if it is really needed.` }
  if (!o.auto) return { dialog: 'deps.auto is off: an install was proposed and not run. Turn deps.auto on to let cadre install dependencies.', text: HOLD }
  if (!(await approved(h, o.root))) return { dialog: 'Allow cadre to install dependencies for tasks in this repository? It runs the install in isolation and commits only the manifest and lockfile on the task branch.', allow: true, text: HOLD }
  const mode = await G.jailMode(h.run); if (mode === 'none') return { dialog: 'Installing needs isolation, and none is available on this machine, so the install was not run.', text: HOLD }
  const git = (...a: string[]) => h.run(['git', '-C', o.wt, ...a]), cwd = o.cwd ?? o.wt, home = `${o.scratch}/home`
  const dirty = async () => (await git('status', '--porcelain', '-z', '-uall')).stdout.split('\0').filter(l => l.length > 3).map(l => ({ code: l.slice(0, 2), path: l.slice(3) }))
  const revert = async (ps: { code: string; path: string }[]) => {   // only what this run changed: tracked paths back to the checkpoint, new ones removed
    const tracked = ps.filter(p => p.code !== '??').map(p => p.path), fresh = ps.filter(p => p.code === '??').map(p => p.path)
    if (tracked.length) await git('checkout', 'HEAD', '--', ...tracked); if (fresh.length) await git('clean', '-fdq', '--', ...fresh)
  }
  await o.checkpoint()
  if ((await dirty()).length) return { text: 'The install was not run: your folder has changes that could not be set aside. Finish or discard them, then ask again.' }
  try {
    await h.run(['mkdir', '-p', home])
    const r = await h.run(G.homeScratchJail({ wt: o.wt, scratch: o.scratch, pkgRoot: cwd, argv: v, scratchHome: home }), { timeoutMs: 600000 })
    const bad = async (why: string) => { await revert(await dirty()); return { text: `The install changed nothing: ${why}` } }
    if (r.exitCode) return await bad(`it failed (${scrub(r.stderr || r.stdout)})`)
    if (o.check) { const c = await G.checkRun(h.run, mode, { wt: o.wt, scratch: o.scratch, pkgRoot: cwd, argv: o.check }); if (c.exitCode) return await bad(`the offline check failed after it (${scrub(c.stderr || c.stdout)})`) }
    const all = await dirty(), stray = all.filter(p => !MANIFEST.test(p.path)), files = all.filter(p => MANIFEST.test(p.path)).map(p => p.path)
    if (stray.length && o.strays) return await bad('it changed files besides the manifest and lockfile, again')
    await revert(stray)
    if (!files.length) return { text: 'Nothing changed: the dependencies are already there.', ...(stray.length ? { stray: true as const } : {}) }
    const sub = o.ask.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 60) || 'add dependencies'
    await git('add', '--', ...files); const c = await git('commit', '--no-verify', '-m', `chore(deps): ${sub}`)
    if (c.exitCode) return await bad(`it could not be committed (${scrub(c.stderr)})`)
    return { text: `Installed and committed on your branch: ${files.join(', ')}. The installed packages are in your folder.`, ...(stray.length ? { stray: true as const } : {}) }
  } finally { await h.run(['rm', '-rf', o.scratch]) }
}

// ---- probe ----
export const PROBE = 'probe/'
const idOf = (n: { task: string; needId: string }) => `${n.task}-${n.needId}`
export const probePath = (base: string, n: { task: string; needId: string }) => `${base}/probe-${idOf(n)}`   // base: <wtRoot>/<repoKey>
export async function probeAdd(h: Host, root: string, base: string, n: { task: string; needId: string }): Promise<string> {
  const path = probePath(base, n); await probeEnd(h, root, base, n)   // a respawn after a failure starts from a fresh tree
  await G.worktreeAdd(h.run, root, path, `${PROBE}${idOf(n)}`, 'HEAD'); return path
}
export async function probeEnd(h: Host, root: string, base: string, n: { task: string; needId: string }): Promise<void> {
  const path = probePath(base, n)
  await h.run(['git', '-C', root, 'worktree', 'remove', '--force', path]); await h.run(['rm', '-rf', path]); await h.run(['git', '-C', root, 'worktree', 'prune']); await h.run(['git', '-C', root, 'branch', '-D', `${PROBE}${idOf(n)}`])
}
// session.start: every probe branch (and its tree) whose request is not live any more; live = `<task>-<needId>` of the requests a running helper holds
export async function probeSweep(h: Host, root: string, base: string, live: string[]): Promise<void> {
  const brs = (await h.run(['git', '-C', root, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${PROBE}`])).stdout.split('\n').filter(Boolean)
  for (const b of brs.filter(b => !live.includes(b.slice(PROBE.length)))) {
    const id = b.slice(PROBE.length), i = id.lastIndexOf('-'); await probeEnd(h, root, base, { task: id.slice(0, i), needId: id.slice(i + 1) })
  }
}
