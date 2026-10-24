// The setup and probe helpers (core/needs). Setup: the helper only PROPOSES an install argv; cadre vets it against a per-ecosystem allowlist (structured argv matching, never a
// shell string), runs it in the requester's folder in the home-scratch jail (network on), checks offline, and commits only manifests and lockfiles on the task branch.
// The worker's own edits are never touched: the folder is checkpointed first, afterwards only the paths the run changed are committed or discarded.
// Probe: a throwaway worktree on a `probe/` branch (not protected, never landed or pushed), removed on every end path and swept at session.start.
import type { Host } from '../types'
import * as G from './git'

// Only manifests and lockfiles of the repo root or a unit root may change: the file name here, the folder against `roots`.
const MANIFEST = /^(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|requirements[\w.-]*\.txt|pyproject\.toml|uv\.lock|poetry\.lock|Cargo\.(toml|lock)|go\.(mod|sum))$/
const manifest = (p: string, roots: string[]) => MANIFEST.test(p.split('/').pop()!) && roots.includes(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
// files that make an install run code of the repository's choosing (a registry, a hook, a build): changed since the task's base, no install is run
const RUNS_CODE = /(^|\/)(\.npmrc|\.pnpmfile\.cjs|\.yarnrc\.yml|\.yarnrc|pip\.conf|pip\.ini|uv\.toml|pnpm-workspace\.yaml|\.cargo\/config(\.toml)?|\.yarn\/(releases|plugins)\/.*)$/
const SOURCES = /^\+.*\b(index|sources|find-links|find_links|index-url|index_url|extra-index-url|extra_index_url)\b/m   // a pyproject.toml line added that names where packages come from
const NPM = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|, -]+)?$/i, PY = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(\[[\w,.-]+\])?((==|>=|<=|~=|!=|<|>)[\w.*+!-]+(,(==|>=|<=|~=|!=|<|>)[\w.*+!-]+)*)?$/, CRATE = /^[A-Za-z][\w-]*(@[\w.^~<>=*, -]+)?$/, GO = /^[a-z0-9][\w.-]*(\/[\w.-]+)+(@[\w.-]+)?$/i
// program -> subcommand tokens, known flags (value: the flags that take one word), the spec shape, what cadre adds. `.venv/pip` is the worktree's own virtualenv pip. No poetry: it cannot refuse source builds.
interface Eco { subs: string[][]; flags: string[]; value?: string[]; spec: RegExp; add?: string[]; env?: Record<string, string>; empty?: true }   // empty: runs from an empty folder, so no bare name can be a file or folder of the repository
const JS = { npm_config_ignore_scripts: 'true', YARN_ENABLE_SCRIPTS: 'false', YARN_IGNORE_PATH: '1' }
const ARCHIVE = /\.(tar(\.\w+)?|tgz|zip|whl|egg|gz|bz2|xz|crate)$/i   // a local archive by its bare name
const ALLOW: Record<string, Eco> = {
  npm: { subs: [['install'], ['i'], ['add']], flags: ['-D', '--save-dev', '-O', '--save-optional', '-E', '--save-exact', '-P', '--save-prod', '--no-audit', '--no-fund'], spec: NPM, env: JS },
  pnpm: { subs: [['add'], ['install'], ['i']], flags: ['-D', '--save-dev', '-O', '--save-optional', '-E', '--save-exact', '-P', '--save-prod'], spec: NPM, add: ['--ignore-pnpmfile'], env: JS },
  yarn: { subs: [['add'], ['install']], flags: ['-D', '--dev', '-O', '--optional', '-E', '--exact'], spec: NPM, env: JS },
  uv: { subs: [['add']], flags: ['--dev'], value: ['--group', '--optional'], spec: PY, add: ['--no-build'] },
  'uv pip': { subs: [['pip', 'install']], flags: [], spec: PY, add: ['--only-binary=:all:'], empty: true },
  '.venv/pip': { subs: [['install']], flags: [], spec: PY, add: ['--only-binary=:all:'], empty: true },
  cargo: { subs: [['add']], flags: ['--dev', '-D', '--build', '--optional', '--no-default-features'], value: ['-F', '--features'], spec: CRATE },
  go: { subs: [['get']], flags: [], spec: GO, env: { GOTOOLCHAIN: 'local' } },
}
const WORD = /^\w[\w.-]*$/

// the argv to run with the environment it adds (scripts off through the environment, wheels only), or why it is refused. Allowlist only: a flag not named, a `--`, a path, URL or
// git source as a package is refused; nothing here reads shell text.
export function vet(argv: unknown, wt: string): { argv: string[]; env: Record<string, string>; empty?: true } | string {
  if (!Array.isArray(argv) || !argv.length || argv.length > 64 || !argv.every(a => typeof a === 'string' && a && a.length < 500)) return 'argv: expected the install command as a list of arguments, e.g. ["npm","install","left-pad"]'
  const [p, ...rest] = argv as string[]
  if (p === 'poetry') return 'poetry cannot be run here: it cannot refuse source builds; use uv or pip (wheels only)'
  const key = p === `${wt}/.venv/bin/pip` ? '.venv/pip' : p === 'uv' && rest[0] === 'pip' ? 'uv pip' : p
  const e = Object.hasOwn(ALLOW, key) ? ALLOW[key] : undefined, sub = e?.subs.find(s => s.every((t, i) => rest[i] === t))
  if (!e || !sub) return `${p} ${rest[0] ?? ''} is not an install command that may be run here; use npm, pnpm, yarn, uv, cargo add, go get, or the project's own .venv pip`
  for (let i = sub.length; i < rest.length; i++) {
    const t = rest[i]
    if (t.startsWith('-')) {
      if (e.value?.includes(t)) { if (!WORD.test(rest[++i] ?? '')) return `${t} needs a plain name` } else if (!e.flags.includes(t)) return `${t} is not an option that may be used here`
    } else if (ARCHIVE.test(t) || !e.spec.test(t)) return `${t} is not a package name from the registry (a name with an optional version)`
  }
  return { argv: [...(argv as string[]), ...(e.add ?? [])], env: { ...(key === 'uv pip' ? { VIRTUAL_ENV: `${wt}/.venv` } : {}), ...e.env }, ...(e.empty ? { empty: true as const } : {}) }
}

// the one-time per-repo approval: the user's own layer, keyed by repo root; a committed repo file cannot hold it
const FILE = async (h: Host) => `${await h.home()}/.claude/cadre/deps.json`
const read = async (h: Host): Promise<Record<string, boolean>> => { try { return JSON.parse((await h.readText(await FILE(h))) ?? '{}') } catch { return {} } }
export const approved = async (h: Host, root: string) => (await read(h))[root] === true
export const approve = async (h: Host, root: string) => h.write(await FILE(h), JSON.stringify({ ...(await read(h)), [root]: true }, null, 1))

export interface SetupIn { wt: string; cwd?: string; scratch: string; ask: string; argv: unknown; auto: boolean; root: string; base?: string; roots?: string[]; check?: string[]; strays?: number; checkpoint: () => Promise<unknown> }   // root: the repo (the approval's key); base: the task's base commit; roots: folders whose manifests may change
export interface SetupOut { text: string; dialog?: string; allow?: true; stray?: true; done?: true }   // dialog: nothing ran, the human decides; stray: a path besides manifests was discarded; done: installed (or nothing to do) with nothing stray
const HOLD = 'The install was not run: it waits for the user. Go on without it, or report outcome "blocked" naming what you need.'
const scrub = (s: string) => s.trim().split('\n').filter(Boolean).slice(-1)[0]?.replace(/\/[^\s'"]+/g, '…').slice(0, 200) ?? ''   // no host paths in what a model reads
export async function setup(h: Host, o: SetupIn): Promise<SetupOut> {
  const v = vet(o.argv, o.wt); if (typeof v === 'string') return { text: `The install was refused: ${v}. Report outcome "blocked" if it is really needed.` }
  if (!o.auto) return { dialog: 'deps.auto is off: an install was proposed and not run. Turn deps.auto on to let cadre install dependencies.', text: HOLD }
  if (!(await approved(h, o.root))) return { dialog: 'Allow cadre to install dependencies for tasks in this repository? It runs the install in isolation and commits only the manifest and lockfile on the task branch.', allow: true, text: HOLD }
  const mode = await G.jailMode(h.run); if (mode === 'none') return { dialog: 'Installing needs isolation, and none is available on this machine, so the install was not run.', text: HOLD }
  const git = (...a: string[]) => h.run(['git', '-C', o.wt, ...a]), cwd = o.cwd ?? o.wt, home = `${o.scratch}/home`, roots = o.roots ?? ['.']
  const dirty = async () => (await git('status', '--porcelain', '-z', '-uall')).stdout.split('\0').filter(l => l.length > 3).map(l => ({ code: l.slice(0, 2), path: l.slice(3) }))
  const ignored = async () => (await git('ls-files', '--others', '--ignored', '--exclude-standard', '-z')).stdout.split('\0').filter(Boolean)   // every file, so one written into an ignored folder that was there before is seen too
  const revert = async (ps: { code: string; path: string }[]) => {   // only what this run changed: tracked paths back to the checkpoint, new ones removed
    const tracked = ps.filter(p => p.code !== '??').map(p => p.path), fresh = ps.filter(p => p.code === '??').map(p => p.path)
    if (tracked.length) await git('checkout', 'HEAD', '--', ...tracked); if (fresh.length) await git('clean', '-fdq', '--', ...fresh)
  }
  await o.checkpoint()
  if ((await dirty()).length) return { text: 'The install was not run: your folder has changes that could not be set aside. Finish or discard them, then ask again.' }
  const rc = (await git('diff', '--name-only', o.base ?? 'HEAD')).stdout.split('\n').filter(f => RUNS_CODE.test(f))
  if (SOURCES.test((await git('diff', o.base ?? 'HEAD', '--', ':(glob)**/pyproject.toml')).stdout)) rc.push('pyproject.toml')
  if (rc.length) return { text: `The install was not run: ${rc.join(', ')} changed in this task, and an install would act on it. Ask the user, or report outcome "blocked".` }
  const before = new Set(await ignored()), env = await h.env()
  try {
    await h.run(['mkdir', '-p', home, `${o.scratch}/cwd`])
    const path = env.PATH || '/usr/local/bin:/usr/bin:/bin', real = async (...ps: string[]) => (await h.run(['realpath', '-q', '-e', ...ps])).stdout.split('\n').filter(Boolean), rhome = (await real(await h.home()))[0] ?? await h.home()
    const r = await h.run(G.setupJail({ wt: o.wt, scratch: o.scratch, pkgRoot: v.empty ? '/tmp/cwd' : cwd, argv: v.argv, scratchHome: home, home: rhome, path, tools: await real(...path.split(':').filter(Boolean)), varRun: (await h.run(['readlink', '/var/run'])).exitCode !== 0, env: { ...(env.LANG ? { LANG: env.LANG } : {}), ...v.env } }), { timeoutMs: 600000 })   // an empty cwd: the scratch's own folder
    const bad = async (why: string) => {   // a failed run leaves nothing: the paths it changed, and the ignored ones it created
      await revert(await dirty()); const dirs = new Set([...before].flatMap(f => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')))), made = [...new Set((await ignored()).filter(f => !before.has(f) && !f.startsWith('/') && !f.split('/').includes('..')).map(f => { const p = f.split('/'), i = p.findIndex((_, k) => !dirs.has(p.slice(0, k + 1).join('/'))); return p.slice(0, i + 1).join('/') }))]   // each new file, or the top of the new folder it is in
      for (let i = 0; i < made.length; i += 400) await h.run(['rm', '-rf', '--', ...made.slice(i, i + 400).map(f => `${o.wt}/${f}`)])
      return { text: `The install changed nothing: ${why}` }
    }
    if (r.exitCode) return await bad(`it failed (${scrub(r.stderr || r.stdout)})`)
    if (o.check) { const c = await G.checkRun(h.run, mode, { wt: o.wt, scratch: o.scratch, pkgRoot: cwd, argv: o.check }); if (c.exitCode) return await bad(`the offline check failed after it (${scrub(c.stderr || c.stdout)})`) }
    const all = await dirty(), stray = all.filter(p => !manifest(p.path, roots)), files = all.filter(p => manifest(p.path, roots)).map(p => p.path), flag = stray.length ? { stray: true as const } : { done: true as const }
    if (stray.length && o.strays) return await bad('it changed files besides the manifest and lockfile, again')
    await revert(stray)
    if (!files.length) return { text: 'Nothing changed: the dependencies are already there.', ...flag }
    const sub = o.ask.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 60) || 'add dependencies'
    await git('add', '--', ...files); const c = await git('commit', '--no-verify', '-m', `chore(deps): ${sub}`)
    if (c.exitCode) return await bad(`it could not be committed (${scrub(c.stderr)})`)
    return { text: `Installed and committed on your branch: ${files.join(', ')}. The installed packages are in your folder.`, ...flag }
  } finally { await h.run(['rm', '-rf', o.scratch]) }
}

// ---- probe ----
export const PROBE = 'probe/'
const idOf = (n: { task: string; needId: string }) => `${n.task}-${n.needId}`
export const probePath = (base: string, n: { task: string; needId: string }) => `${base}/probe-${idOf(n)}`   // base: <wtRoot>/<repoKey>
// the branches cadre made are on record (a user's own probe/x is never touched)
const REC = (root: string) => `cadre:probes:${root}`
const recs = async (h: Host, root: string) => ((await h.store.get(REC(root))) as string[] | undefined) ?? []
export async function probeAdd(h: Host, root: string, base: string, n: { task: string; needId: string }): Promise<string> {
  const path = probePath(base, n), br = `${PROBE}${idOf(n)}`; await probeEnd(h, root, base, n)   // a respawn after a failure starts from a fresh tree
  await G.worktreeAdd(h.run, root, path, br, 'HEAD'); await h.store.set(REC(root), [...new Set([...(await recs(h, root)), br])]); return path
}
export async function probeEnd(h: Host, root: string, base: string, n: { task: string; needId: string }): Promise<void> {
  const path = probePath(base, n), br = `${PROBE}${idOf(n)}`, mine = await recs(h, root)
  await h.run(['git', '-C', root, 'worktree', 'remove', '--force', path]); await h.run(['rm', '-rf', path]); await h.run(['git', '-C', root, 'worktree', 'prune'])
  if (mine.includes(br)) { await h.run(['git', '-C', root, 'branch', '-D', br]); await h.store.set(REC(root), mine.filter(b => b !== br)) }
}
// session.start: every probe branch cadre made (and its tree) whose request is not live any more; live = `<task>-<needId>` of the requests a running helper holds
export async function probeSweep(h: Host, root: string, base: string, live: string[]): Promise<void> {
  for (const b of (await recs(h, root)).filter(b => !live.includes(b.slice(PROBE.length)))) {
    const id = b.slice(PROBE.length), i = id.lastIndexOf('-'); await probeEnd(h, root, base, { task: id.slice(0, i), needId: id.slice(i + 1) })
  }
}
