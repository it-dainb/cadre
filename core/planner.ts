// The epic planner (ADR 0021): in a milestone with milestone.epicPlanner 'agent', a ready epic's task plan is drafted by a planner agent (agents/planner.md,
// fresh context, read-only), not by main. The spawner starts it (core/spawner, prompt PLAN-<epic>; admission binds it to the epic); its report carries the
// drafts. They pass the same checks as main's TaskCreate drafts (field validation, the duplicate check, the plan missing list with the path overlap) and the
// same auto-approval (core/milestone.planEpic, recorded "drafted by the planner"). A refused plan goes back to the same planner; planner.maxRounds refused
// rounds (a stop without a plan counts as one) stop the epic: auto asks the human, yolo goes on with the other epics (core/milestone.stopEpic).
import type { Host, MEpic, Snapshot } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { protectedOf, type Deps } from './admission'
import { planBlock } from './briefs'
import { runOf, step } from './lifecycle'
import { cfgOf, draftsOf } from './dispatch'
import { active } from './pipeline'
import { repoSplit } from './specview'
import { retouch } from './lanes'
import { epicOf, planEpic, stopEpic } from './milestone'
import { holdsGap, notesOf, pathsOf, sliceNotes, validateFields } from './validate'
import { fieldsOf, twinOf } from './plantools'
import { limited } from './drive'

const syms = (t: Task) => { try { const s = (JSON.parse(t.design || '{}').symbols ?? []).filter((x: any) => x.status !== 'unchanged'); return s.length ? ` · interface ${s.map((x: any) => `${x.name}(${(x.params ?? []).join(', ')}) -> ${x.returns}`).join('; ')}` : '' } catch { return '' } }
// the brief, in cache order: the plan block (the task agents' own: mission, protected paths, the landed core's interface, the notes without paths), the roadmap
// (the same bytes for every planner of the milestone), then this epic, what landed before it, the locked files, the notes on its files, the task types
export async function plannerBrief(h: Host, d: Deps, s: Snapshot, ep: MEpic): Promise<string> {
  const get = (id: string) => d.store.get(id).catch(() => null), es = s.plan?.epics ?? [], me = await d.store.get(ep.id), ms = s.epic ? await get(s.epic) : null, mine = pathsOf(me)
  const road = await Promise.all(es.map(async e => { const t = await get(e.id), p = pathsOf(t ?? undefined); return `- ${e.id} ${e.title}: ${t?.description.trim() ?? ''}${e.core ? ' · core' : ''}${e.deps.length ? ` · after ${e.deps.join(', ')}` : ''}${p.length ? ` · files ${p.join(', ')}` : ''}` }))
  const seen = new Set<string>(), walk = (id: string): void => { for (const x of epicOf(s, id)?.deps ?? []) if (!seen.has(x)) { seen.add(x); walk(x) } }; walk(ep.id)
  const landed = await Promise.all(es.filter(e => seen.has(e.id) && e.state === 'landed').map(async e => [`- ${e.id} ${e.title}`, ...(await d.store.list({ parent: e.id })).filter(t => t.category === 'done').map(t => `  - ${t.title}: files ${pathsOf(t).join(', ') || 'not declared'}${syms(t)}`)].join('\n')))
  const locked = pathsOf({ meta: { 'cadre.paths': ms?.meta['cadre.corePaths'] ?? '' } }), n = sliceNotes(notesOf(ms?.meta['cadre.notes']), mine, d.cfg.notes.slice)
  return [planBlock({ mission: s.mission ?? undefined, protectedPaths: protectedOf(), core: ms?.meta['cadre.coreContract'] || undefined, shared: n.shared }), `# Roadmap of milestone ${s.plan?.id}`, ...road,
    `# PLAN-${ep.id} ${ep.title}`, `Goal: ${me.description.trim()}`, `Size: about ${ep.size ?? 'a few'} tasks${mine.length ? ` · files ${mine.join(', ')}` : ''}${ep.core ? ' · the core epic: the epics after it share its code, so keep it thin' : ''}`,
    landed.length ? `## Already landed (build on it)\n${landed.join('\n')}` : '', locked.length ? `## Locked files (shared code that landed; never plan a change to them)\n${locked.map(p => `- ${p}`).join('\n')}` : '',
    n.slice ? `## Notes for these files\n${n.slice}` : '', `## Task types\n${Object.entries(active().types).map(([t, x]) => `${t} ${x.pipeline.join('>')}`).join('; ')}`,
  ].filter(Boolean).join('\n').slice(0, 8000)
}

// one refused round; the last one stops the epic. Returns what the planner reads.
async function refused(h: Host, d: Deps, id: string, why: string, agentId?: string): Promise<string> {
  const n = (Number((await d.store.get(id)).meta['cadre.planRounds']) || 0) + 1, max = d.cfg.planner.maxRounds
  await d.store.setMeta(id, { 'cadre.planRounds': String(n) }, d.actor)
  if (n < max) return `error: ${why} (round ${n}/${max}): fix it and report the whole task list again`
  await stopEpic(h, id, `its task plan was refused ${n} times: ${why}`)
  return 'the plan was refused too often; the user takes over. Stop.'
}

// report{role:"planner"} (tools/index): draft, check, approve. A round replaces the drafts of the round before.
export async function planned(h: Host, d: Deps, agentId: string, r: { tasks?: unknown }): Promise<string> {
  const id = (await h.bind.read())[agentId].taskId, e = epicOf(await h.board.read(), id)
  if (!e || (e.state !== 'ready' && e.state !== 'planning')) return `${id} needs no plan now. Stop.`
  const why = await draft(h, d.store, id, r.tasks)
  if (why) return refused(h, d, id, why, agentId)
  return `plan accepted: ${(r.tasks as unknown[]).length} tasks approved; they start by themselves. Stop.`
}
// the planner's turn ended: unbind. Its answer is in when its run reported (the binding stays until now, so its last requests keep the routed effort). Without one
// (no accepted plan, no last refusal) it is a round, unless a usage limit stopped it; the spawner starts a fresh one.
export async function planStopped(h: Host, d: Deps, e: { agentId: string }): Promise<void> {
  const b = (await h.bind.read())[e.agentId], ok = (await runOf(h, e.agentId))?.state?.state === 'idle-bound'
  await step(h, e.agentId, { type: 'end', cause: ok ? 'done' : 'released', reason: ok ? 'answer' : 'stopped' }); if (!ok && !(await limited(h, e))) await refused(h, d, b.taskId, 'the planner stopped without a plan')
}

async function draft(h: Host, store: TaskStore, id: string, tasks: unknown): Promise<string | null> {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 7) return 'tasks: expected 1 to 7 tasks, each {"subject","description","metadata":{...},"after":[1]}'
  await store.dropDrafts((await draftsOf(store, id)).map(t => t.id))
  const made: string[] = [], name = (x: string) => made.map((m, i) => [m, i] as const).sort((a, b) => b[0].length - a[0].length).reduce((s, [m, i]) => s.replaceAll(m, `task ${i + 1}`), x)
  const no = async (why: string) => { const w = name(why); await store.dropDrafts(made); await retouch(h, store); return w }
  for (const [i, t] of tasks.entries()) {
    const at = `task ${i + 1}`, m = t?.metadata ?? {}
    if (typeof t?.subject !== 'string' || !t.subject.trim() || typeof t.description !== 'string') return no(`${at}: needs a subject and a description (strings)`)
    if (typeof m !== 'object' || Array.isArray(m)) return no(`${at}: metadata: expected an object`)
    const { epic, ...meta } = m; if (epic !== undefined && epic !== id) return no(`${at}: metadata.epic: omit it (every task is of ${id})`)
    const err = validateFields(meta) ?? repoSplit(await cfgOf(h), meta.paths) ?? (meta.holds ? holdsGap(meta.holds, (meta.scenarios as string[] | undefined)?.join('\n')) : null) ?? (meta.kind !== undefined ? 'metadata.kind: omit it' : null); if (err) return no(`${at}: ${err}`)
    const f = fieldsOf(meta), tw = await twinOf(store, id, t.subject, t.description, f.meta['cadre.paths']); if (tw) return no(`${at} repeats ${tw.id} (${tw.why}): make them one task`)
    made.push((await store.createDraft({ title: t.subject, description: t.description, acceptance: f.patch.acceptance, design: f.patch.design, type: meta.type ?? 'feature', parent: id, meta: f.meta })).id)
  }
  for (const [i, t] of tasks.entries()) {
    const a = t.after ?? []
    if (!Array.isArray(a) || a.some((k: unknown) => !Number.isInteger(k) || (k as number) < 1 || (k as number) > made.length || k === i + 1)) return no(`task ${i + 1}: after: expected the numbers of other tasks in your list, e.g. [1]`)
    for (const k of a) await store.link(made[i], { id: made[k - 1], type: 'blocks' })
  }
  await retouch(h, store)
  const why = await planEpic(h, store, id, 'the planner'); return why ? no(why) : null
}
