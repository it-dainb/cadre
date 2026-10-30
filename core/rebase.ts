// Parallel tasks in one plan (ADR 0014 G). A task whose squash would conflict, or whose checks go red on the moved plan branch, is reworked by the SAME worker on
// the new tip (the mod merges the tip into its branch under git.op, conflicts left in its tree; locked spec tests keep this task's version), then green -> re-review
// -> squash again. At most limits.rebaseRounds per task; then the caller blocks it (auto: a dialog; yolo: the rest of the plan goes on, core/drive). Running siblings get the new
// tip merged in after every squash, and a trial merge (git merge-tree, >= 2.38) warns two running workers early when their changes collide.
import { modelText } from './say'
import type { Host, SnapTask } from '../types'
import type { Task } from '../task-management/store'
import type { Deps } from './admission'
import { agentsOf } from './board'
import { apply } from './machine'
import { idsIn, pushDelta } from './briefs'
import { mirror } from './dispatch'
import { typeOf } from './pipeline'
import { setup } from './admission'
import { baseOf, taskBranch, wtPath } from './branches'
import { decided } from './drive'
import { ask } from './decide'
import { flagDecision } from './flags'
import { card, modOn, spawnIt } from './render'
import { policyOf, setPolicy } from '../policy/guards'
import { overlap, pathsOf } from './validate'
import * as G from './git'
import { budgetOf, charge, step } from './lifecycle'
import { emit } from './events'
import { holdsRed } from './tdd'

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
  const n = (await budgetOf(h, t.id)).rebase + 1, ROUNDS = d.cfg.limits.rebaseRounds, wt = task.meta['cadre.worktree'], br = task.meta['cadre.branch'], base = task.meta['cadre.base'] ?? tip
  if (n > ROUNDS || !wt || !br) return null
  const locked = ((await policyOf(h)).locks?.[t.id] ?? []).map(p => p.slice(wt.length + 1))
  const conf = await G.op(h, async () => {
    await h.run(['git', '-C', wt, 'checkout', '-q', '-f', br])
    if (!(await h.run(['git', '-C', wt, 'merge', '--no-ff', '--no-edit', '-m', `merge the plan tip ${sha7(tip)} into ${t.id}`, tip])).exitCode) return [] as string[]
    const c = lines(await G.git(h.run, wt, ['diff', '--name-only', '--diff-filter=U']))
    for (const p of c.filter(p => locked.includes(p))) { await G.git(h.run, wt, ['checkout', '--ours', '--', p]); await G.git(h.run, wt, ['add', '--', p]) }   // a locked spec test keeps this task's version
    return c.filter(p => !locked.includes(p))
  })
  const by = await landed(h, d.root, base, tip, conf), at = await h.now()
  const m = await apply(h, { kind: 'rewind', id: t.id, at, actor: 'mod', on: 'worker' }); if (!m.ok) throw new Error(m.error)
  await d.store.resume(t.id, d.actor)
  await charge(h, t.id, 'rebase'); await d.store.setMeta(t.id, { 'cadre.base': tip, 'cadre.review': '', 'cadre.step': 'worker' }, d.actor)
  const text = modelText('nudge', [`The plan moved on while ${t.id} waited to merge${by.length ? `: ${by.join(', ')} landed` : ''}. Your branch now has the new plan tip merged in (round ${n}/${ROUNDS}).`,
    conf.length ? `Resolve the conflicts in: ${conf.join(', ')} (keep both changes where they do not contradict).` : `Its checks fail on the merged tree${detail ? `:\n${detail.slice(0, 800)}` : ''}.`,
    'Keep your change, keep every test green; locked tests stay as they are. Then report done again.'].join('\n'))
  const w = await worker(h, t.id); if (w) await step(h, w, { type: 'resume', text })
  await decided(h, 'rebase', `${t.id}: reworked onto the plan tip ${sha7(tip)} (${why}${by.length ? ` after ${by.join(', ')}` : ''}), round ${n}/${ROUNDS}`, t.id)
  await h.board.update(s => ({ ...s, tasks: s.tasks.map(x => (x.id === t.id ? { ...x, card: card({ id: t.id, title: t.title, role: 'main', to: 'worker', flags: x.flags, next: w ? 'worker resumed: it updates its change onto the plan' : modOn(s) ? 'wait: the worker starts by itself' : `spawn TASK-${t.id} (worker)` }) } : x)) }))
  return `${t.id} was not merged: the plan moved (${why === 'conflict' ? `conflicts in ${conf.join(', ') || 'its files'}` : 'its checks fail on the new tip'}). Its worker updates it (round ${n}/${ROUNDS}); it comes back for review. ${w ? 'Wait for it (status).' : modOn(await h.board.read()) ? 'A new worker starts by itself.' : `Spawn TASK-${t.id} again.`}`
}
// past the cap: the human sees both sides (auto: the dialog; yolo: the task stays blocked while the rest goes on, core/drive)
export async function capAsk(h: Host, d: Deps, t: SnapTask, task: Task, tip: string, files: string[]): Promise<void> {
  const by = await landed(h, d.root, task.meta['cadre.base'] ?? tip, tip, files)
  await ask(h, flagDecision(t.id, 'conflict', undefined, { title: `${t.id} still conflicts after ${d.cfg.limits.rebaseRounds} reworks`, short: `${t.id} conflict`, hash: `conflict:${sha7(tip)}`, keys: ['r', 'x'],
    lines: [t.title, `with ${by.join(', ') || 'work that landed'} on ${files.slice(0, 4).join(', ') || 'the merged tree'}`, 'Retry: one more rework round by its worker. Cancel task: end it, the rest of the plan goes on.'] })!)
}

// after a squash into the plan branch: merge the new tip into every running worker's branch (a throwaway worktree, then the branch ref and the live tree move);
// a sibling that would conflict is told now and reworked at its own merge
export async function refresh(h: Host, d: Deps, tip: string, from: string, only?: string): Promise<void> {
  const all = (await h.board.read()).tasks, ep = only ?? all.find(x => x.id === from)?.epic   // a milestone: only the same epic's workers (another epic's branch gets the milestone tip at its own landing)
  for (const x of all.filter(x => x.id !== from && x.epic === ep && x.state === 'active' && x.step === 'worker')) {
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
    // the scenarios the plan said already hold are re-run on the moved tree: one that no longer passes blocks the task with a decision, it is never demoted to an unmarked scenario
    const red = await holdsRed(h, d, await d.store.get(x.id), wt).catch((e: Error) => { h.log(`${x.id}: its held tests could not be re-run: ${e.message}`); return ['(the check could not run)'] })   // fail closed: no answer is no pass
    if (red.length) {
      await apply(h, { kind: 'block', id: x.id, at: await h.now(), actor: 'mod' }); await d.store.move(x.id, 'blocked', d.actor); await d.store.setMeta(x.id, { 'cadre.blocked': 'holds' }, d.actor)
      await h.board.update(b => ({ ...b, tasks: b.tasks.map(t => (t.id === x.id && !t.flags.includes('holds') ? { ...t, flags: [...t.flags, 'holds'] } : t)) })); await emit(h, 'flag.raised', { taskId: x.id, flag: 'holds' }, { taskId: x.id })
      await decided(h, 'rebase', `${x.id}: after ${from} landed, the scenarios the plan says already hold could not be confirmed (${red.slice(0, 3).join(', ')}); the plan's author decides`, x.id); continue
    }
    if (w) await pushDelta(h, w, modelText('context', `${from} landed; your branch now includes it (plan tip ${sha7(tip)}). Your edits are kept.`))
  }
}

// tick (every 60 s): a trial merge of every pair of running workers' trees (uncommitted edits included, via stash create); on a collision both are told once.
// Without merge-tree (git < 2.38) the declared paths (metadata.paths) are compared instead.
export async function watch(h: Host, d: Deps): Promise<void> {
  const s = await h.board.read(), run = s.tasks.filter(x => x.state === 'active' && x.step === 'worker'), eps = (s.plan?.epics ?? []).filter(e => e.state === 'running'); if (run.length < 2 && eps.length < 2) return
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
  for (let i = 0; i < eps.length; i++) for (const b of eps.slice(i + 1)) {   // two running epics of a milestone: their branches (what landed in each so far)
    const a = eps[i], key = `${a.id}|${b.id}`, files = seen.includes(key) ? null : await trial(h, d.root, a.branch, b.branch); if (!files?.length) continue
    add.push(key)
    for (const [me, other] of [[a, b], [b, a]]) for (const t of s.tasks.filter(t => t.epic === me.id)) { const w = await worker(h, t.id); if (w) await pushDelta(h, w, modelText('context', `Heads-up: the parallel epic ${other.id} (${other.title}) also changes ${files.slice(0, 5).join(', ')}. Keep your edits there small; the later landing merges onto the other.`)) }
  }
  if (add.length) await h.store.set(`cadre:${d.key}:collide`, [...seen, ...add].slice(-50))
}

// the core task landed: its files are locked for every other task of the plan (write jail); a needed change comes back as a blocked report, then a core-patch task
export async function coreLanded(h: Host, d: Deps, files: string[], contract?: string): Promise<void> {   // contract: the core task's interface, the plan block of every later brief (ADR 0022)
  const epic = (await h.board.read()).epic; if (!epic) return
  const all = [...new Set([...pathsOf({ meta: { 'cadre.paths': (await d.store.get(epic)).meta['cadre.corePaths'] ?? '' } }), ...files])]
  await d.store.setMeta(epic, { 'cadre.corePaths': JSON.stringify(all), ...(contract ? { 'cadre.coreContract': contract } : {}) }, d.actor); await lockCore(h, d)
}
export async function lockCore(h: Host, d: Deps, only?: string): Promise<void> {
  const s = await h.board.read(), files = s.epic ? pathsOf({ meta: { 'cadre.paths': (await d.store.get(s.epic)).meta['cadre.corePaths'] ?? '' } }) : []; if (!files.length) return
  const core = { ...(await policyOf(h)).core }
  for (const x of s.tasks.filter(x => (!only || x.id === only) && x.state !== 'done' && x.state !== 'cancelled')) { const wt = (await d.store.get(x.id).catch(() => null))?.meta['cadre.worktree']; if (wt) core[x.id] = files.map(f => `${wt}/${f}`) }
  await setPolicy(h, { core })
}

// ---- between epics of a milestone (ADR 0015 wave 2) ----
// an epic landed on the milestone: every other running epic takes the new tip (a throwaway worktree, CAS on its branch), then its running workers do;
// one that would conflict is left as it is: its own landing turns the conflict into a resolve task
export async function refreshEpics(h: Host, d: Deps, msTip: string, landedId: string): Promise<void> {
  for (const e of ((await h.board.read()).plan?.epics ?? []).filter(e => e.state === 'running' && e.id !== landedId)) {
    const head = await G.tip(h.run, d.root, e.branch).catch(() => ''); if (!head || (await trial(h, d.root, head, msTip)) !== null || (await G.ok(h.run, d.root, ['merge-base', '--is-ancestor', msTip, head]))) continue
    const tmp = `${d.wtRoot}/${d.key}.scratch/refresh-${e.id}`, next = await G.op(h, async () => {
      await h.run(['git', '-C', d.root, 'worktree', 'add', '-f', '--detach', tmp, head])
      try { if ((await h.run(['git', '-C', tmp, 'merge', '--no-ff', '--no-edit', '-m', `merge the milestone tip ${sha7(msTip)} into ${e.id}`, msTip])).exitCode) return ''; const n = await G.tip(h.run, tmp, 'HEAD'); return (await G.casRef(h.run, d.root, `refs/heads/${e.branch}`, n, head)) ? n : '' }
      finally { await h.run(['git', '-C', d.root, 'worktree', 'remove', '--force', tmp]) }
    })
    if (next) await refresh(h, d, next, '', e.id)
  }
}
// an epic (or a single plan) does not merge into its target: ONE refactor task in that epic whose tree holds the merge in progress (both sides, conflict markers);
// green, review and the squash land the resolution on the epic branch, then main completes the epic again. At most ROUNDS per epic; null = past the cap
export async function resolveTask(h: Host, d: Deps, epicId: string, from: string, onto: string, files: string[]): Promise<string | null> {
  const e = await d.store.get(epicId), n = num(e.meta['cadre.resolves']) + 1, ROUNDS = d.cfg.limits.rebaseRounds, s = await h.board.read(); if (n > ROUNDS) return null
  const other = await G.tip(h.run, d.root, await baseOf(h, onto))   // a landing that waits for the user's checkout is part of it; the close compares protected paths against this sha
  const title = `Resolve the merge conflict with ${onto}`, landed = (s.plan?.epics ?? []).filter(x => x.state === 'landed').map(x => `- ${x.id} ${x.title}`)
  const t = await d.store.createDraft({ title, type: 'refactor', parent: epicId, meta: { 'cadre.lane': 'lite', 'cadre.resolve': other, 'cadre.changelog': JSON.stringify({ none: true, reason: 'merge resolution' }) },
    description: [`Your working tree holds an unfinished merge of ${onto} into this branch${files.length ? `; the conflicts are marked in ${files.join(', ')}` : ''}. Resolve it so that both sides keep working, and keep every test green.`, `This side: ${e.title}\n${e.description.slice(0, 600)}`, ...(landed.length ? [`The other side (already on ${onto}):\n${landed.join('\n')}`] : [])].join('\n\n') })
  const wt = wtPath(d.wtRoot, d.key, t.id), br = taskBranch(typeOf('refactor')?.commit ?? 'refactor', t.id, title), base = await G.tip(h.run, d.root, from)
  await G.op(h, async () => { await G.worktreeAdd(h.run, d.root, wt, br, base); await h.run(['git', '-C', wt, 'merge', '--no-ff', '--no-edit', other]) })   // the conflict is left in its tree
  await setup(h, d, t, wt).catch(x => h.log(`resolve setup: ${x}`))
  await d.store.setMeta(t.id, { 'cadre.worktree': wt, 'cadre.branch': br, 'cadre.base': base }, d.actor); await d.store.setMeta(epicId, { 'cadre.resolves': String(n) }, d.actor)
  await d.store.approve([t.id]); await mirror(h, d.store); await apply(h, { kind: 'approve', id: t.id, at: await h.now(), actor: 'mod' })
  await decided(h, 'resolve', `${epicId}: merge with ${onto} conflicts${files.length ? ` on ${files.slice(0, 4).join(', ')}` : ''}; resolve task ${t.id} (attempt ${n}/${ROUNDS})`, t.id)
  return `${from} does not merge into ${onto}${files.length ? ` (conflicts in ${files.join(', ')})` : ''}. Resolve task ${t.id} was added to ${epicId} (attempt ${n}/${ROUNDS})${spawnIt(await h.board.read(), `spawn TASK-${t.id}`)}; when it is done, complete ${epicId} again.`
}
