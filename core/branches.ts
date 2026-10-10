// Branch names, epic cut, integration and release ref steps (DESIGN 3.6, 3.9). Pure over Host.run; refs move by CAS (3.7).
import type { Host } from '../types'
import { IDENT, casRef, exists, git, op, tip, worktreeAdd, worktreeRemove } from './git'

export const slug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'task'
export const taskBranch = (commitType: string, id: string, title: string) => `${commitType}/${id}-${slug(title)}`
export const epicBranch = (prefix: string, id: string, title: string) => `${prefix}${id}-${slug(title)}`
// the configured worktree root, else ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt (the one default; config/defaults documents it)
export const wtRootOf = async (h: Host, cfg: { worktrees: { root: string } }): Promise<string> => cfg.worktrees.root || `${(await h.env()).XDG_CACHE_HOME || `${await h.home()}/.cache`}/cadre/wt`
export const wtPath = (root: string, key: string, id: string) => `${root}/${key}/${id}`
export const protectedRef = (b: string, o: { main: string; dev: string; epicPrefix: string }) => b === o.main || b === o.dev || b.startsWith(o.epicPrefix)

// First approval: cut epic/<id>-<slug> from dev. Idempotent: an existing branch keeps its tip. Returns the epic tip.
export async function cutEpic(h: Host, planId: string, dev = 'dev'): Promise<string> {
  const [root, plan] = [await h.cwd(), (await h.board.read()).plan]
  if (!plan || plan.id !== planId) throw new Error(`no draft plan ${planId} on the board`)
  const run = h.run
  return op(h, async () => (await exists(run, root, plan.epicBranch)) ? tip(run, root, plan.epicBranch) : (await git(run, root, ['branch', plan.epicBranch, dev]), tip(run, root, plan.epicBranch)))
}

// Integration (3.9): throwaway detached worktree at dev, merge --no-ff the epic. Returns the merge sha (dev itself is untouched until landDev).
// A conflict or failure removes the throwaway and throws.
export async function mergeEpic(h: Host, o: { dev: string; epic: string; tmp: string; msg: string }): Promise<{ sha: string; devTip: string }> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const devTip = await tip(run, root, o.dev)
    await git(run, root, ['worktree', 'add', '--detach', o.tmp, devTip])
    try {
      await git(run, o.tmp, [...IDENT, 'merge', '--no-ff', '--no-verify', '-m', o.msg, o.epic])
      return { sha: await tip(run, o.tmp, 'HEAD'), devTip }
    } catch (e) { await worktreeRemove(run, root, o.tmp); throw e }
  })
}
// Green: move dev by CAS and drop the throwaway + epic branch; false when dev moved (caller re-merges).
export async function landDev(h: Host, o: { dev: string; sha: string; old: string; tmp: string; epic: string }): Promise<boolean> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const won = await casRef(run, root, `refs/heads/${o.dev}`, o.sha, o.old)
    if (won) { await worktreeRemove(run, root, o.tmp); await git(run, root, ['branch', '-D', o.epic]) }
    return won
  })
}
// Release (3.9): dev -> main, --no-ff, annotated tag. Caller has committed the chore(release) on dev. Refs by CAS.
export async function release(h: Host, o: { dev: string; main: string; version: string; tmp: string; msg: string }): Promise<string> {
  const root = await h.cwd(), run = h.run
  return op(h, async () => {
    const [mainTip, devTip] = [await tip(run, root, o.main), await tip(run, root, o.dev)]
    await worktreeAdd(run, root, o.tmp, `release-tmp-${o.version}`, mainTip)
    try {
      await git(run, o.tmp, [...IDENT, 'merge', '--no-ff', '--no-verify', '-m', o.msg, devTip])
      const sha = await tip(run, o.tmp, 'HEAD')
      if (!(await casRef(run, root, `refs/heads/${o.main}`, sha, mainTip))) throw new Error(`${o.main} moved during release`)
      await git(run, root, ['tag', '-a', `v${o.version}`, '-m', `v${o.version}`, sha])
      return sha
    } finally { await worktreeRemove(run, root, o.tmp, `release-tmp-${o.version}`) }
  })
}
// Version from our own commit headers (3.9): `!` -> major (0.x -> minor), feat -> minor, else patch; no tag -> 0.1.0.
export function inferVersion(lastTag: string | null, subjects: readonly string[]): string {
  if (!lastTag) return '0.1.0'
  const [a, b, c] = lastTag.replace(/^v/, '').split('.').map(Number)
  const brk = subjects.some(s => /^\w+(\([^)]*\))?!:/.test(s)), feat = subjects.some(s => /^feat(\(|:|!)/.test(s))
  if (brk) return a === 0 ? `0.${b + 1}.0` : `${a + 1}.0.0`
  return feat ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
}
export const lastTag = async (h: Host): Promise<string | null> => (await git(h.run, await h.cwd(), ['tag', '--list', 'v*', '--sort=-v:refname'])).split('\n')[0] || null
