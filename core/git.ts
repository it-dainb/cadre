// Mod git helpers (DESIGN 3.7, 3.10): pure over an injected run(argv). Type-only imports so `node --test tests/git/*.test.mjs` can load it (ADR 0003).
import type { Host } from '../types'

export type Res = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }) => Promise<Res>
const ID = ['-c', 'user.name=cadre', '-c', 'user.email=cadre@localhost']

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
  if (/lock/i.test(r.stderr)) { await git(run, root, args); return }
  throw new Error(`git worktree add failed: ${r.stderr.trim().slice(0, 300)}`)
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
  await git(run, wt, [...ID, 'commit', '--no-verify', '-m', msg])
  return tip(run, wt, 'HEAD')
}
// Task squash (3.8), in the task worktree: detach at the epic tip, squash-merge the reviewed commit, commit. Conflict -> throws (caller blocks the task).
export async function squash(run: Run, wt: string, epicTip: string, source: string, msg: string): Promise<string> {
  await git(run, wt, ['checkout', '--detach', epicTip])
  const r = await run(['git', '-C', wt, 'merge', '--squash', source])
  if (r.exitCode) { await run(['git', '-C', wt, 'merge', '--abort']); await run(['git', '-C', wt, 'reset', '--hard', epicTip]); throw new Error(`conflict squashing ${source.slice(0, 7)}`) }
  await git(run, wt, [...ID, 'commit', '--no-verify', '--allow-empty', '-m', msg])
  return tip(run, wt, 'HEAD')
}
// Ref CAS: update-ref <ref> <new> <old>; false when the ref moved under us.
export const casRef = (run: Run, root: string, ref: string, next: string, old: string) => ok(run, root, ['update-ref', ref, next, old])
// diff facts the mod computes (6.1): stat + capped patch of a range
export const diffStat = (run: Run, wt: string, range: string) => git(run, wt, ['diff', '--stat', range])
export async function diffPatch(run: Run, wt: string, range: string, cap = 3072): Promise<string> { return (await git(run, wt, ['diff', range])).slice(0, cap) }

// Jail argv (3.10). `scratch` is bound at /tmp; `writable` = jailWritable cache dirs. argv is appended after `--`.
type J = { wt: string; scratch: string; pkgRoot: string; argv: readonly string[]; writable?: readonly string[] }
const RO = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc']
const tail = (j: J) => ['--bind', j.scratch, '/tmp', ...(j.writable ?? []).flatMap(w => ['--bind', w, w]), '--chdir', j.pkgRoot, '--', ...j.argv]
// checks: tree writable, writes discarded, no network
export const overlayJail = (j: J): string[] => ['bwrap', '--unshare-net', ...RO, '--overlay-src', j.wt, '--tmp-overlay', j.wt, ...tail(j)]
// setup / skeleton: the worktree is really written, network on
export const writableJail = (j: J): string[] => ['bwrap', ...RO, '--bind', j.wt, j.wt, ...tail(j)]
// init discovery: writable jail + an overlay over $HOME; what setup wrote lands in <scratch>/home-up
export const homeJail = (j: J & { home: string }): string[] => ['bwrap', ...RO, '--bind', j.wt, j.wt, '--overlay-src', j.home, '--overlay', `${j.scratch}/home-up`, `${j.scratch}/home-work`, j.home, ...tail(j)]
