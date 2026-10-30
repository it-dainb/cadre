// Milestone lane (ADR 0015): one goal too big for one plan becomes a ROADMAP of epics under one plan record (the milestone). The human approves the roadmap only;
// each epic's task plan is drafted when the epic is ready (by a planner agent, core/planner, or by main: milestone.epicPlanner) and approved here automatically (recorded). Epics with no dependency path run at once (milestone.maxEpics);
// each epic branch is cut from the milestone branch and lands back on it (core/integrate); the milestone branch lands on dev once, at the end.
import type { Host, MEpic, Plan, Snapshot } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { DRIVE, draftsOf, mirror, storeOf } from './dispatch'
import { missingList } from './validate'
import { apply } from './machine'
import { ask } from './decide'
import { flagDecision } from './flags'
import { emit } from './events'
import { epicBranch } from './branches'
import { casRef, exists, git, ok, op, tip, worktreeRemove } from './git'

export const MS = 'milestone/'
export const isMs = (p?: Plan | null): boolean => p?.lane === 'milestone'
// the branch a task squashes into: its epic's in a milestone, else the plan's
export const branchOf = (s: Pick<Snapshot, 'plan'>, t?: { epic?: string }): string => (t?.epic && s.plan?.epics?.find(e => e.id === t.epic)?.branch) || s.plan?.epicBranch || ''
export const epicOf = (s: Pick<Snapshot, 'plan'>, id?: string): MEpic | undefined => s.plan?.epics?.find(e => e.id === id)

// the roadmap from the store (dispatch.mirror): the milestone's epic children, their tasks, and each epic's state. A stopped epic stops the epics that wait on it;
// a waiting epic whose dependencies all landed takes a free slot (max running + planning epics; 0 = no cap)
export async function roadmap(store: TaskStore, ms: string, max: number, prefix: string): Promise<{ epics: MEpic[]; tasks: Task[] }> {
  const kids = (await store.list({ parent: ms })).filter(t => t.type === 'epic' && t.category !== 'cancelled').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  const tasks = (await Promise.all(kids.map(e => store.list({ parent: e.id })))).flat().filter(t => t.type !== 'gate')
  const epics: MEpic[] = kids.map(e => {
    const ts = tasks.filter(t => t.parent === e.id), stop = e.meta['cadre.stopped']
    return { id: e.id, title: e.title, branch: e.meta['cadre.branch'] || epicBranch(prefix, e.id, e.title), deps: e.deps.filter(d => d.type === 'blocks').map(d => d.id), size: Number(e.meta['cadre.size']) || undefined, core: e.meta['cadre.core'] === 'true' || undefined,
      state: e.category === 'draft' ? 'draft' : e.category === 'done' ? 'landed' : stop ? 'stopped' : ts.some(t => t.category !== 'draft') ? 'running' : ts.length ? 'planning' : 'waiting', ...(stop ? { why: stop } : {}) }
  })
  const of = (id: string) => epics.find(e => e.id === id)
  for (let n = 1; n;) { n = 0; for (const e of epics) { const d = e.state === 'waiting' && e.deps.find(x => of(x)?.state === 'stopped'); if (d) { e.state = 'stopped'; e.why = `waits on ${d}, which stopped`; n++ } } }
  let busy = epics.filter(e => e.state === 'running' || e.state === 'planning').length
  for (const e of epics) if (e.state === 'waiting' && e.deps.every(x => !of(x) || of(x)!.state === 'landed') && (!max || busy < max)) { e.state = 'ready'; busy++ }
  return { epics, tasks }
}

// `TaskUpdate <epic> metadata.planned true`: main finished drafting a ready epic's tasks. Complete → approved automatically and recorded (the roadmap was the human's
// approval), the epic branch cut from the milestone tip (a child builds only on what landed on its parent). Returns the refusal, or null.
export async function planEpic(h: Host, store: TaskStore, id: string, by?: string): Promise<string | null> {   // by: who drafted it, when not main (core/planner)
  const s = await h.board.read(), p = s.plan, e = epicOf(s, id)
  if (!p || !e || p.state !== 'approved') return `${id} is not an epic of the running milestone`
  if (e.state !== 'planning') return e.state === 'ready' ? `${id} has no tasks yet: add them with task, epic "${id}", first` : `${id} is ${e.state}; plan an epic when the next: line names it`
  const drafts = await draftsOf(store, id), miss = missingList(drafts); if (miss.length) return `incomplete, missing: ${miss.join('; ')}`
  const root = await h.cwd()
  await op(h, async () => { if (!(await exists(h.run, root, e.branch))) await git(h.run, root, ['branch', e.branch, p.epicBranch]) })
  await store.setMeta(id, { 'cadre.branch': e.branch }, 'cadre'); await store.approve(drafts.map(t => t.id)); await mirror(h, store)
  const at = await h.now(); for (const t of drafts) await apply(h, { kind: 'approve', id: t.id, at, actor: 'mod' })
  await DRIVE.decided?.(h, 'plan', `plan ${id} approved automatically for milestone ${p.id}${by ? ` · drafted by ${by}` : ''}`)   // through dispatch: core/drive imports this module
  return null
}

// an epic that cannot go on (its landing failed again, no progress): its dependants stop with it, independent epics continue (core/drive.gate: auto pauses for the human)
export async function stopEpic(h: Host, id: string, why: string): Promise<void> {
  const store = await storeOf(h), s = await h.board.read(), e = epicOf(s, id); if (!e || e.state === 'stopped' || e.state === 'landed') return
  await store.setMeta(id, { 'cadre.stopped': why.slice(0, 300) }, 'cadre'); await mirror(h, store)
  await ask(h, flagDecision(id, 'stopped', undefined, { title: `epic ${id} stopped`, short: `${id} stopped`, hash: `stopped:${why.slice(0, 60)}`, lines: [e.title, why.slice(0, 160), 'Retry: the epic goes on. The epics that wait on it start after it lands.'] })!)
  await emit(h, 'flag.raised', { taskId: id, flag: 'stopped' }, { taskId: id })
}
export async function goOn(h: Host, id: string): Promise<void> { await DRIVE.forget?.(h, id); const store = await storeOf(h); await store.setMeta(id, { 'cadre.stopped': '', 'cadre.planRounds': '' }, 'cadre'); await mirror(h, store) }

// after an epic landed: the milestone branch takes what dev gained meanwhile (a throwaway worktree, CAS). A conflict leaves it as it is: the final landing on dev shows it.
export async function freshen(h: Host, root: string, ms: string, dev: string, tmp: string): Promise<void> {
  if (await ok(h.run, root, ['merge-base', '--is-ancestor', dev, ms])) return
  await op(h, async () => {
    const old = await tip(h.run, root, ms); await git(h.run, root, ['worktree', 'add', '--detach', tmp, old])
    try {
      if ((await h.run(['git', '-C', tmp, 'merge', '--no-ff', '--no-verify', '--no-edit', '-m', `merge ${dev} into ${ms}`, dev])).exitCode) return h.log(`${ms}: ${dev} does not merge cleanly; left as it is`)
      await casRef(h.run, root, `refs/heads/${ms}`, await tip(h.run, tmp, 'HEAD'), old)
    } finally { await worktreeRemove(h.run, root, tmp) }
  })
}
