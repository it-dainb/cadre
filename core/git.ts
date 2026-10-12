// Mod git helpers (DESIGN 3.7, 3.10): pure over an injected run(argv). Type-only imports so `node --test tests/git/*.test.mjs` can load it (ADR 0003).
import type { Host } from '../types'

export type Res = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }) => Promise<Res>
// Commits the mod makes land on the user's branches, so they carry the USER's git identity, never a made-up one (ADR 0009). Missing: Claude asks for it during setup/init (ADR 0010).
export async function identity(run: Run, env: Record<string, string | undefined> = {}): Promise<{ ok: boolean; name: string; email: string }> {   // env: GIT_AUTHOR_* prefill
  const get = async (k: string) => (await run(['git', 'config', '--get', k]).catch(() => undefined))?.stdout.trim() ?? ''
  return { ok: (await run(['git', 'var', 'GIT_COMMITTER_IDENT']).catch(() => ({ exitCode: 1 }))).exitCode === 0 && (await run(['git', 'var', 'GIT_AUTHOR_IDENT']).catch(() => ({ exitCode: 1 }))).exitCode === 0, name: (await get('user.name')) || env.GIT_AUTHOR_NAME || '', email: (await get('user.email')) || env.GIT_AUTHOR_EMAIL || '' }
}
// paths the mod owns in a repo: agents never change them (close refuses, guards fence, the brief names them)
export const PROTECTED = ['.git/', '.cadre/', '.beads/', '.claude/', '.mcp.json', 'CHANGELOG.md']
export const isProt = (p: string, changelog?: string) => [...PROTECTED, ...(changelog ? [changelog] : [])].some(x => (x.endsWith('/') ? p.startsWith(x) : p === x))   // changelog: the configured changelog.path (repo-relative)

// git -C <cwd> <args>: stdout trimmed; a non-zero exit throws with git's own stderr (P6: facts only, never parsed for decisions).
export async function git(run: Run, cwd: string, args: readonly string[]): Promise<string> {
  const r = await run(['git', '-C', cwd, ...args])
  if (r.exitCode) throw new Error(`git ${args[0]} failed (${r.exitCode}): ${r.stderr.trim().slice(0, 300)}`)
  return r.stdout.trim()
}
export const ok = async (run: Run, cwd: string, args: readonly string[]): Promise<boolean> => (await run(['git', '-C', cwd, ...args])).exitCode === 0
export const tip = (run: Run, cwd: string, ref: string) => git(run, cwd, ['rev-parse', '--verify', `${ref}^{commit}`])
export const exists = (run: Run, cwd: string, ref: string) => ok(run, cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])

// git.op: CAS busy=true -> fn -> epoch++ -> busy=false (effect.ts re-baselines on an epoch change). A busy repo refuses; callers retry at the next hook.
export async function op<T>(h: Host, fn: () => Promise<T>): Promise<T> {
  let got = false
  await h.git.update(g => { got = !g.busy; return g.busy ? g : { ...g, busy: true } })
  if (!got) throw new Error('git busy')
  try { return await fn() } finally { await h.git.update(g => ({ ...g, busy: false, epoch: g.epoch + 1 })) }
}

// worktree = the task branch (3.6): add -b from the epic tip; one retry on a lock collision.
export async function worktreeAdd(run: Run, root: string, path: string, branch: string, base: string): Promise<void> {
  const args = ['worktree', 'add', '-b', branch, path, base]
  const r = await run(['git', '-C', root, ...args])
  if (!r.exitCode) return
  await git(run, root, args)   // once more: a concurrent worktree add can hold the lock
}
// recovery (8.4): the directory is gone but the branch is not
export async function worktreeReadd(run: Run, root: string, path: string, branch: string): Promise<void> {
  await git(run, root, ['worktree', 'prune']); await git(run, root, ['worktree', 'add', path, branch])
}
export async function worktreeRemove(run: Run, root: string, path: string, branch?: string): Promise<void> {
  await run(['git', '-C', root, 'worktree', 'remove', '--force', path]); await git(run, root, ['worktree', 'prune'])
  if (branch) await run(['git', '-C', root, 'branch', '-D', branch])
}

// "The mod commits": git add -A + commit, no repo hooks. Returns the new sha, or null when the tree was clean.
export async function commitAll(run: Run, wt: string, msg: string): Promise<string | null> {
  await git(run, wt, ['add', '-A'])
  if (await ok(run, wt, ['diff', '--cached', '--quiet'])) return null
  await git(run, wt, ['commit', '--no-verify', '-m', msg])
  return tip(run, wt, 'HEAD')
}
// Task squash (3.8), in the task worktree: detach at the epic tip, squash-merge the reviewed commit, commit. Conflict -> throws (caller blocks the task).
export async function squash(run: Run, wt: string, epicTip: string, source: string, msg: string): Promise<string> {
  await git(run, wt, ['checkout', '--detach', epicTip])
  const r = await run(['git', '-C', wt, 'merge', '--squash', source])
  if (r.exitCode) { await run(['git', '-C', wt, 'merge', '--abort']); await run(['git', '-C', wt, 'reset', '--hard', epicTip]); throw new Error(`conflict squashing ${source.slice(0, 7)}`) }
  await git(run, wt, ['commit', '--no-verify', '--allow-empty', '-m', msg])
  return tip(run, wt, 'HEAD')
}
// Ref CAS: update-ref <ref> <new> <old>; false when the ref moved under us.
export const casRef = (run: Run, root: string, ref: string, next: string, old: string) => ok(run, root, ['update-ref', ref, next, old])
// diff facts the mod computes (6.1): stat + capped patch of a range
export const diffStat = (run: Run, wt: string, range: string) => git(run, wt, ['diff', '--stat', range])
export async function diffPatch(run: Run, wt: string, range: string, cap = 3072): Promise<string> { return (await git(run, wt, ['diff', range])).slice(0, cap) }

// Jail argv (3.10). `scratch` is bound at /tmp FIRST, so a worktree that itself lives under /tmp (a sandboxed HOME, an eval) is bound on top and stays visible; `writable` = jailWritable cache dirs. argv is appended after `--`.
type J = { wt: string; scratch: string; pkgRoot: string; argv: readonly string[]; writable?: readonly string[]; env?: Record<string, string> }
const RO = (j: J) => ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', j.scratch, '/tmp']
const tail = (j: J) => [...Object.entries({ TMPDIR: '/tmp', ...j.env }).flatMap(([k, v]) => ['--setenv', k, v]),   // TMPDIR: the caller's (often outside the jail) would not exist in it; /tmp is the scratch
  ...(j.writable ?? []).flatMap(w => ['--bind', w, w]), '--chdir', j.pkgRoot, '--', ...j.argv]
// checks: tree writable, writes discarded, no network
export const overlayJail = (j: J): string[] => ['bwrap', '--unshare-net', ...RO(j), '--overlay-src', j.wt, '--tmp-overlay', j.wt, ...tail(j)]
// setup / skeleton: the worktree is really written, network on
export const writableJail = (j: J): string[] => ['bwrap', ...RO(j), '--bind', j.wt, j.wt, ...tail(j)]
// init discovery: writable jail + an overlay over $HOME; what setup wrote lands in <scratch>/home-up
export const homeJail = (j: J & { home: string }): string[] => ['bwrap', ...RO(j), '--bind', j.wt, j.wt, '--overlay-src', j.home, '--overlay', `${j.scratch}/home-up`, `${j.scratch}/home-work`, j.home, ...tail(j)]

// A19 fallback (bwrap < 0.11 has no overlay, S42/S46). copyJail: j.wt is a throwaway COPY of the tree, bound writable and discarded; network stays off.
export const copyJail = (j: J): string[] => ['bwrap', '--unshare-net', ...writableJail(j).slice(1)]
// init cache audit without a $HOME overlay: HOME (+XDG) = an empty scratch dir the jail may write; what lands there is what setup wrote.
export const homeScratchJail = (j: J & { scratchHome: string }): string[] => {
  const h = j.scratchHome
  return writableJail({ ...j, writable: [...(j.writable ?? []), h], env: { ...j.env, HOME: h, XDG_CACHE_HOME: `${h}/.cache`, XDG_CONFIG_HOME: `${h}/.config`, XDG_DATA_HOME: `${h}/.local/share` } })
}
// Probe once per hook: overlay (bwrap with --overlay-src), copy (bwrap works, no overlay) or none (no usable bwrap: unjailed throwaway copy, network unenforced).
export async function jailMode(run: Run): Promise<'overlay' | 'copy' | 'none'> {
  const t = await run(['bwrap', '--ro-bind', '/', '/', 'true']).catch(() => undefined)
  if (!t || t.exitCode) return 'none'
  const hp = await run(['bwrap', '--help']).catch(() => undefined)
  return /--overlay-src/.test(`${hp?.stdout}${hp?.stderr}`) ? 'overlay' : 'copy'
}
// One offline check in the best jail: overlay, else a copy of j.wt under j.scratch (writes die with the copy). pkgRoot must lie under j.wt.
export async function checkRun(run: Run, mode: 'overlay' | 'copy' | 'none', j: J, timeoutMs = 600000): Promise<Res> {
  if (mode === 'overlay') return run(overlayJail(j), { timeoutMs })
  const cp = `${j.scratch}/cp`, k = { ...j, wt: cp, pkgRoot: cp + j.pkgRoot.slice(j.wt.length) }
  await run(['rm', '-rf', cp]); await run(['mkdir', '-p', cp])
  try {
    const c = await run(['cp', '-a', `${j.wt}/.`, cp]); if (c.exitCode) throw new Error(`copy failed: ${c.stderr.slice(0, 200)}`)
    return mode === 'copy' ? await run(copyJail(k), { timeoutMs }) : await run(j.argv, { cwd: k.pkgRoot, env: j.env, timeoutMs })
  } finally { await run(['rm', '-rf', cp]) }
}
