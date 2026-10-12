// Parallel tasks in one plan (ADR 0014 G). A task whose squash would conflict, or whose checks go red on the moved plan branch, is reworked by the SAME worker on
// the new tip (the mod merges the tip into its branch under git.op, conflicts left in its tree; locked spec tests keep this task's version), then green -> re-review
// -> squash again. At most ROUNDS per task; then the caller blocks it (auto: a dialog; yolo: the rest of the plan goes on, core/drive). Running siblings get the new
// tip merged in after every squash, and a trial merge (git merge-tree, >= 2.38) warns two running workers early when their changes collide.
import { modelText } from './say'
import type { Host, SnapTask } from '../types'
import type { Task } from '../task-management/store'
import type { Deps } from './admission'
import { agentsOf } from './board'
import { apply } from './machine'
import { pipeOf } from '../task-management/registry'
import { idsIn, pushDelta } from './briefs'
import { queueResume } from './reuse'
import { decided } from './drive'
import { ask } from './decide'
import { card } from './render'
import { policyOf } from '../policy/guards'
import { matches } from './specview'
import * as G from './git'

export const ROUNDS = 2
const num = (v?: string) => Number(v ?? 0) || 0
const sha7 = (s: string) => s.slice(0, 7)
const lines = (s: string) => s.split('\n').filter(Boolean)
const worker = async (h: Host, id: string) => { const b = await h.bind.read(); return agentsOf(b, id).find(a => !a.startsWith('~') && b[a].role === 'worker') }

// trial merge without touching any tree: null = clean, [] / files = conflicting paths, undefined = this git has no merge-tree --write-tree (< 2.38)
export async function trial(h: Host, root: string, a: string, b: string): Promise<string[] | null | undefined> {
  const r = await h.run(['git', '-C', root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', a, b])
  return r.exitCode === 0 ? null : r.exitCode === 1 ? lines(r.stdout).slice(1) : undefined
}
// the tasks whose squash commits since `from` touched these files (their `Refs: <id>` trailer)
const landed = async (h: Host, root: string, from: string, to: string, files: string[]) =>
  idsIn(await G.git(h.run, root, ['log', '--format=%B', `${from}..${to}`, ...(files.length ? ['--', ...files] : [])]), (await h.board.read()).tasks.map(t => t.id))

// One rework round. Returns the text for main, or null when the cap is reached (the caller blocks the task and asks).
export async function rework(h: Host, d: Deps, t: SnapTask, task: Task, tip: string, why: 'conflict' | 'red', detail = ''): Promise<string | null> {
  const n = num(task.meta['cadre.rebase']) + 1, wt = task.meta['cadre.worktree'], br = task.meta['cadre.branch'], base = task.meta['cadre.base'] ?? tip
  if (n > ROUNDS || !wt || !br) return null
  const locked = ((await policyOf(h)).locks?.[t.id] ?? []).map(p => p.slice(wt.length + 1))
  const conf = await G.op(h, async () => {
    await h.run(['git', '-C', wt, 'checkout', '-q', '-f', br])
    if (!(await h.run(['git', '-C', wt, 'merge', '--no-ff', '--no-edit', '-m', `merge the plan tip ${sha7(tip)} into ${t.id}`, tip])).exitCode) return [] as string[]
    const c = lines(await G.git(h.run, wt, ['diff', '--name-only', '--diff-filter=U']))
    for (const p of c.filter(p => locked.includes(p))) { await G.git(h.run, wt, ['checkout', '--ours', '--', p]); await G.git(h.run, wt, ['add', '--', p]) }   // a locked spec test keeps this task's version
    return c.filter(p => !locked.includes(p))
  })
  const by = await landed(h, d.root, base, tip, conf), p = pipeOf(d.reg), at = await h.now()
  const m = await apply(h, { kind: 'rewind', id: t.id, at, actor: 'mod', on: 'worker' }, p); if (!m.ok) throw new Error(m.error)
  await d.store.resume(t.id, d.actor)
  await d.store.setMeta(t.id, { 'cadre.rebase': String(n), 'cadre.base': tip, 'cadre.review': '', 'cadre.step': 'worker' }, d.actor)
  const text = modelText('nudge', [`The plan moved on while ${t.id} waited to merge${by.length ? `: ${by.join(', ')} landed` : ''}. Your branch now has the new plan tip merged in (round ${n}/${ROUNDS}).`,
    conf.length ? `Resolve the conflicts in: ${conf.join(', ')} (keep both changes where they do not contradict).` : `Its checks fail on the merged tree${detail ? `:\n${detail.slice(0, 800)}` : ''}.`,
    'Keep your change, keep every test green; locked tests stay as they are. Then report done again.'].join('\n'))
  const w = await worker(h, t.id); if (w) await queueResume(h, { agentId: w, taskId: t.id, text })
  await decided(h, 'rebase', `${t.id}: reworked onto the plan tip ${sha7(tip)} (${why}${by.length ? ` after ${by.join(', ')}` : ''}), round ${n}/${ROUNDS}`, t.id)
  await h.board.update(s => ({ ...s, tasks: s.tasks.map(x => (x.id === t.id ? { ...x, card: card({ id: t.id, title: t.title, role: 'main', to: 'worker', flags: x.flags, next: w ? 'worker resumed: it updates its change onto the plan' : `spawn TASK-${t.id} (worker)` }) } : x)) }))
  return `${t.id} was not merged: the plan moved (${why === 'conflict' ? `conflicts in ${conf.join(', ') || 'its files'}` : 'its checks fail on the new tip'}). Its worker updates it (round ${n}/${ROUNDS}); it comes back for review. ${w ? 'Wait for it (TaskList).' : `Spawn TASK-${t.id} again.`}`
}
// past the cap: the human sees both sides (auto: the dialog; yolo: the task stays blocked while the rest goes on, core/drive)
export async function capAsk(h: Host, d: Deps, t: SnapTask, task: Task, tip: string, files: string[]): Promise<void> {
  const by = await landed(h, d.root, task.meta['cadre.base'] ?? tip, tip, files)
  await ask(h, { id: `flag:${t.id}:conflict`, kind: 'flag', title: `${t.id} still conflicts after ${ROUNDS} reworks`, short: `${t.id} conflict`, hash: `conflict:${sha7(tip)}`, tab: 'epic', sel: t.id,
    lines: [t.title, `with ${by.join(', ') || 'work that landed'} on ${files.slice(0, 4).join(', ') || 'the merged tree'}`, 'Retry: one more rework round by its worker. Cancel task: end it, the rest of the plan goes on.'],
    options: [{ key: 'r', label: 'Retry', verb: 'change', run: `resolve ${t.id} rebase` }, { key: 'x', label: 'Cancel task', verb: 'cancel', run: `resolve ${t.id} cancel` }] })
}

// after a squash into the plan branch: merge the new tip into every running worker's branch (a throwaway worktree, then the branch ref and the live tree move);
// a sibling that would conflict is told now and reworked at its own merge
export async function refresh(h: Host, d: Deps, tip: string, from: string): Promise<void> {
  for (const x of (await h.board.read()).tasks.filter(x => x.id !== from && x.state === 'active' && x.step === 'worker')) {
    const task = await d.store.get(x.id).catch(() => null), wt = task?.meta['cadre.worktree'], br = task?.meta['cadre.branch']
    if (!task || !wt || !br || !(await h.stat(wt))) continue
    const head = await G.tip(h.run, d.root, br), c = await trial(h, d.root, head, tip), w = await worker(h, x.id)
    if (c === undefined || (c === null && (await G.ok(h.run, d.root, ['merge-base', '--is-ancestor', tip, head])))) continue
    if (c?.length) { if (w) await pushDelta(h, w, modelText('context', `Heads-up: ${from} landed and changes ${c.join(', ')} too. Your change will be merged onto it when you finish; keep your edits there small.`)); continue }
    const tmp = `${d.wtRoot}/${d.key}.scratch/refresh-${x.id}`, moved = await G.op(h, async () => {
      await h.run(['git', '-C', d.root, 'worktree', 'add', '-f', '--detach', tmp, head])
      try {
        if ((await h.run(['git', '-C', tmp, 'merge', '--no-ff', '--no-edit', '-m', `merge the plan tip ${sha7(tip)} into ${x.id}`, tip])).exitCode) return false
        const next = await G.tip(h.run, tmp, 'HEAD')
        if (!(await G.casRef(h.run, d.root, `refs/heads/${br}`, next, head))) return false
        if ((await h.run(['git', '-C', wt, 'read-tree', '-m', '-u', head, next])).exitCode) { await G.casRef(h.run, d.root, `refs/heads/${br}`, head, next); return false }   // the worker's own edits touch the same files: leave its tree alone
        return true
      } finally { await h.run(['git', '-C', d.root, 'worktree', 'remove', '--force', tmp]) }
    })
    if (!moved) continue
    await d.store.setMeta(x.id, { 'cadre.base': tip }, d.actor)
    if (w) await pushDelta(h, w, modelText('context', `${from} landed; your branch now includes it (plan tip ${sha7(tip)}). Your edits are kept.`))
  }
}

// tick (every 60 s): a trial merge of every pair of running workers' trees (uncommitted edits included, via stash create); on a collision both are told once.
// Without merge-tree (git < 2.38) the declared paths (metadata.paths) are compared instead.
export async function watch(h: Host, d: Deps): Promise<void> {
  const run = (await h.board.read()).tasks.filter(x => x.state === 'active' && x.step === 'worker'); if (run.length < 2) return
  const seen = ((await h.store.get(`cadre:${d.key}:collide`)) as string[] | undefined) ?? [], tips: Record<string, string> = {}, meta: Record<string, Task> = {}
  for (const x of run) {
    const task = await d.store.get(x.id).catch(() => null), wt = task?.meta['cadre.worktree']; if (!task || !wt || !(await h.stat(wt))) continue
    meta[x.id] = task; tips[x.id] = (await G.git(h.run, wt, ['stash', 'create']).catch(() => '')).trim() || (await G.tip(h.run, wt, 'HEAD'))
  }
  const ids = Object.keys(tips), add: string[] = []
  for (let i = 0; i < ids.length; i++) for (const b of ids.slice(i + 1)) {
    const a = ids[i], key = `${a}|${b}`; if (seen.includes(key)) continue
    let files = await trial(h, d.root, tips[a], tips[b])
    if (files === undefined) { const pa = pathsOf(meta[a]), pb = pathsOf(meta[b]); files = pa.filter(p => pb.some(q => overlap(p, q))) }
    if (!files?.length) continue
    add.push(key)
    for (const [me, other] of [[a, b], [b, a]]) { const w = await worker(h, me); if (w) await pushDelta(h, w, modelText('context', `Heads-up: ${other} is changing ${files.slice(0, 5).join(', ')} at the same time. Keep your edits there small; whoever merges second updates onto the other.`)) }
  }
  if (add.length) await h.store.set(`cadre:${d.key}:collide`, [...seen, ...add].slice(-50))
}

// declared paths (metadata.paths -> cadre.paths) and their overlap: equal, a folder of the other, or a glob that matches it
export const pathsOf = (t?: Pick<Task, 'meta'>): string[] => { try { return JSON.parse(t?.meta['cadre.paths'] || '[]') } catch { return [] } }
const dir = (p: string) => p.replace(/\/\*\*?$/, '').replace(/\/$/, '')
export const overlap = (a: string, b: string): boolean => a === b || dir(a) === dir(b) || b.startsWith(`${dir(a)}/`) || a.startsWith(`${dir(b)}/`) || matches([a], b) || matches([b], a)
