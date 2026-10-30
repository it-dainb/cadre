// Branch names, epic cut, integration and release ref steps (DESIGN 3.6, 3.9). Pure over Host.run; refs move by CAS (3.7).
import type { Host } from '../types'
import { casRef, exists, git, op, tip, worktreeAdd, worktreeRemove } from './git'

const words = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// ≤ 24 chars, cut at a word boundary (a single longer word is cut hard)
export const slug = (title: string): string => { const w = words(title); if (w.length <= 24) return w || 'task'; const c = w.slice(0, 25), i = c.lastIndexOf('-'); return i > 0 ? c.slice(0, i) : w.slice(0, 24) }
export const slug32 = (title: string): string => words(title).slice(0, 32) || 'task'   // names before 0.9.1: still used when such a branch exists
export const taskBranch = (prefix: string, id: string, title: string) => `${prefix}${id}-${slug(title)}`   // prefix: the type's plain `branch` string (feat/)
export const epicBranch = (prefix: string, id: string, title: string) => `${prefix}${id}-${slug(title)}`
// the configured worktree root, else ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt (the one default; config/defaults documents it)
export const wtRootOf = async (h: Host, cfg: { worktrees: { root: string } }): Promise<string> => cfg.worktrees.root || `${(await h.env()).XDG_CACHE_HOME || `${await h.home()}/.cache`}/cadre/wt`
export const wtPath = (root: string, key: string, id: string) => `${root}/${key}/${id}`
export const protectedRef = (b: string, o: { main: string; dev: string; epicPrefix: string }) => b === o.main || b === o.dev || b.startsWith(o.epicPrefix) || b.startsWith('milestone/')

// First approval: cut epic/<id>-<slug> from dev. Idempotent: an existing branch keeps its tip. Returns the epic tip.
export async function cutEpic(h: Host, planId: string, dev = 'dev'): Promise<string> {
  const [root, plan] = [await h.cwd(), (await h.board.read()).plan]
  if (!plan || plan.id !== planId) throw new Error(`no draft plan ${planId} on the board`)
  const run = h.run
  return op(h, async () => (await exists(run, root, plan.epicBranch)) ? tip(run, root, plan.epicBranch) : (await git(run, root, ['branch', plan.epicBranch, await baseOf(h, dev)]), tip(run, root, plan.epicBranch)))   // a landing waiting for the user's checkout is part of dev
}

// Integration (3.9): throwaway detached worktree at dev, merge --no-ff the epic. Returns the merge sha (dev itself is untouched until landDev).
// A conflict or failure removes the throwaway and throws.
export async function mergeEpic(h: Host, o: { dev: string; epic: string; tmp: string; msg: string }): Promise<{ sha: string; devTip: string }> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const devTip = await tip(run, root, await baseOf(h, o.dev))
    await git(run, root, ['worktree', 'add', '--detach', o.tmp, devTip])
    try {
      await git(run, o.tmp, ['merge', '--no-ff', '--no-verify', '-m', o.msg, o.epic])
      return { sha: await tip(run, o.tmp, 'HEAD'), devTip }
    } catch (e) { await worktreeRemove(run, root, o.tmp); throw e }
  })
}
// Green: move dev by CAS and drop the throwaway + epic branch; false when dev moved (caller re-merges).
export async function landDev(h: Host, o: { dev: string; sha: string; old: string; tmp: string; epic: string }): Promise<boolean> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const won = await move(h, o.dev, o.sha, o.old)
    if (won) { await worktreeRemove(run, root, o.tmp); await git(run, root, ['branch', '-D', o.epic]) }
    return won
  })
}
// Release (3.9): dev -> main, --no-ff, annotated tag. Caller has committed the chore(release) on dev. Refs by CAS.
export async function release(h: Host, o: { dev: string; main: string; version: string; tmp: string; msg: string }): Promise<string> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const [mainTip, devTip] = [await tip(run, root, await baseOf(h, o.main)), await tip(run, root, await baseOf(h, o.dev))]
    await worktreeAdd(run, root, o.tmp, `release-tmp-${o.version}`, mainTip)
    try {
      await git(run, o.tmp, ['merge', '--no-ff', '--no-verify', '-m', o.msg, devTip])
      const sha = await tip(run, o.tmp, 'HEAD')
      if (!(await move(h, o.main, sha, mainTip))) throw new Error(`${o.main} moved during release`)
      await git(run, root, ['tag', '-a', `v${o.version}`, '-m', `v${o.version}`, sha])
      return sha
    } finally { await worktreeRemove(run, root, o.tmp, `release-tmp-${o.version}`) }
  })
}
// ---- H5: cadre never moves a branch the user has checked out (any worktree but cadre's own: HEAD would disagree with the index and the files). The landing waits as
// refs/cadre/pending/<b> (moved by CAS, so landings stack), with refs/cadre/base/<b> = the branch tip it first merged on, until it lands into the checkout
// (core/integrate.landPending: the dialog's Land) or, once the branch is checked out nowhere, by itself. ----
export const pendingRef = (b: string) => `refs/cadre/pending/${b}`, baseRef = (b: string) => `refs/cadre/base/${b}`
// the tip a landing builds on: the pending landing when there is one, else the branch
export const baseOf = async (h: Host, b: string) => ((await exists(h.run, await h.cwd(), pendingRef(b))) ? pendingRef(b) : b)
// the worktree that has b checked out, if any: the user's (cadre's own worktrees are on task branches or detached, never on a branch it lands on)
export const checkedOut = async (h: Host, b: string): Promise<string | undefined> =>
  (await git(h.run, await h.cwd(), ['worktree', 'list', '--porcelain'])).split('\n\n').find(x => x.split('\n').includes(`branch refs/heads/${b}`))?.match(/^worktree (.*)$/m)?.[1]
// the one way cadre moves a protected branch: by CAS, or, while the user has it checked out or a landing already waits, the pending ref
export async function move(h: Host, b: string, next: string, old: string): Promise<boolean> {
  const root = await h.cwd(), pend = await exists(h.run, root, pendingRef(b))
  if (!pend && !(await checkedOut(h, b))) return casRef(h.run, root, `refs/heads/${b}`, next, old)
  if (!(await casRef(h.run, root, pendingRef(b), next, pend ? old : '0'.repeat(40)))) return false
  if (!pend) await git(h.run, root, ['update-ref', baseRef(b), old])
  return true
}
