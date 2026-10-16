// Main's planning tools (parent plan §3.2): plan, task, epic, amend, explore, ask. tools/index checks the strict schema (validate.checkInput) and the role;
// here the graph (after[]: ids of this plan, no wait that leads back), then the write. Every write bumps the plan's revision (cadre.rev) and clears its
// approval receipt (cadre.receipt, written by dispatch.approve): an edit revokes approval; amend names the revision it read. ask's open questions block
// approval (dispatch.planMissing). The writes go through the Task* answers (native/tasks), which run beside these tools until the switch-over moves them here.
import { modelData, modelText } from './say'
import type { Host, Snapshot } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { pipeOf } from '../task-management/registry'
import { apply } from './machine'
import { settleIf, yoloOn } from './decide'
import { answer } from '../native/tasks'
import { clarifyCall } from './clarify'
import { missingLine, questionsOf } from './validate'
import { DRIVE, mirror, registryOf, storeOf } from './dispatch'
import { retouch } from './lanes'
import { askById, askTask } from './asks'
import { isMs } from './milestone'

type Out = Record<'result', unknown> & { context?: string[] }
type In = Record<string, any>
const no = (m: string): Out => ({ result: modelText('tool-result', `error: ${m}`) })
const NEXT = async () => undefined   // never reached: answer takes every Task* call
// a Task* answer's refusal, in the tools' own field names
const said = (r: any): string | null => { const t = r?.deny ?? (r?.result?.success === false ? r.result.error : null); return t ? String(t).replaceAll('metadata.', '') : null }
const via = (h: Host, e: In) => answer(h, { tool_use_id: 'tool', ...e }, NEXT) as Promise<any>
const revOf = async (store: TaskStore, plan: string) => Number((await store.get(plan)).meta['cadre.rev'] ?? 0)
async function wrote(h: Host, store: TaskStore, plan: string, id: string, r?: any): Promise<Out> {
  const revision = (await revOf(store, plan)) + 1, at = await h.now()
  await store.setMeta(plan, { 'cadre.rev': String(revision), 'cadre.receipt': '' }, 'main')
  return { result: modelData('tool-result', { id, plan, revision, at, by: 'main' }), ...(r?.context?.length ? { context: r.context } : {}) }
}
// after[]: ids of this plan's tasks (or a roadmap's epics); with self (an edit), none may already wait for self
const BLOCK = ['blocks', 'waits-for']
async function graph(store: TaskStore, s: Snapshot, after: string[], self?: string): Promise<string | null> {
  const known = [...s.tasks.map(t => t.id), ...(s.plan?.epics ?? []).map(e => e.id)]
  for (const [k, a] of after.entries()) {
    if (a === self) return `after[${k}]: a task cannot wait for itself; remove it and call again`
    if (!known.includes(a)) return `after[${k}]: ${a} is not a task of this plan (known: ${known.join(', ') || 'none'}); fix it and call again`
  }
  const seen = new Set<string>(), back = async (id: string): Promise<boolean> => {
    if (id === self) return true; if (seen.has(id)) return false; seen.add(id)
    for (const d of (await store.get(id).catch(() => null))?.deps ?? []) if (BLOCK.includes(d.type) && (await back(d.id))) return true
    return false
  }
  if (self) for (const [k, a] of after.entries()) if (await back(a)) return `after[${k}]: ${a} already waits for ${self}, so this would be a cycle; drop it and call again`
  return null
}
const planOf = async (h: Host) => { const s = await h.board.read(); return s.plan ? s : null }
const NOPLAN = 'no plan yet: call plan first'

async function plan(h: Host, i: In): Promise<Out> {
  const { title, description, kind = 'plan', ...m } = i, e = { tool: 'TaskCreate', subject: title, description, metadata: { kind, ...m } }
  const c: any = await clarifyCall(h, e); if (c) return c.deny ? no(said(c)!) : c   // a yolo plan lists its assumptions (core/clarify)
  const r = await via(h, e), bad = said(r); if (bad) return no(bad)
  return wrote(h, await storeOf(h), r.result.task.id, r.result.task.id, r)
}
async function add(h: Host, i: In, m: In): Promise<Out> {   // a task, or an epic of a roadmap
  const s = await planOf(h); if (!s) return no(NOPLAN)
  const store = await storeOf(h), after: string[] = i.after ?? [], g = await graph(store, s, after); if (g) return no(g)
  let r = await via(h, { tool: 'TaskCreate', subject: i.title, description: i.description ?? i.goal, metadata: m }), bad = said(r); if (bad) return no(bad)
  const id = r.result.task.id
  if (after.length && (bad = said((r = await via(h, { tool: 'TaskUpdate', taskId: id, addBlockedBy: after }))))) return no(`after: ${bad}`)
  return wrote(h, store, s.plan!.id, id, r)
}
const task = (h: Host, i: In) => { const { title: _t, description: _d, after: _a, ...m } = i; return add(h, i, m) }
async function epic(h: Host, i: In): Promise<Out> {
  const s = await planOf(h); if (!s) return no(NOPLAN)
  if (!isMs(s.plan)) return no('epics belong to a milestone (plan lane "milestone"); add tasks with task')
  if (i.planned !== undefined) {
    if (i.id === undefined) return no('id: required with planned; name the epic whose tasks are all drafted')
    const r = await via(h, { tool: 'TaskUpdate', taskId: i.id, metadata: { planned: i.planned } }), bad = said(r); return bad ? no(bad) : wrote(h, await storeOf(h), s.plan!.id, i.id, r)
  }
  for (const k of ['title', 'goal', 'size']) if (i[k] === undefined) return no(`${k}: required for a new epic; add it and call again`)
  const { title: _t, goal: _g, after: _a, id: _i, ...m } = i
  return add(h, i, m)
}
// The amendment ledger: a change to an approved task names its reason and evidence; each criterion (a scenario by id, any other field by name) keeps its original
// verbatim and changes once (a second change is the user's). auto: the task goes back to the user's dialog; yolo: main's decision is recorded and stands.
type Entry = { criterion: string; original: string; reason: string; evidence: string; at: number }
const ledgerOf = (t: Task): Entry[] => { try { return JSON.parse(t.meta['cadre.amendments'] || '[]') } catch { return [] } }
const sid = (l: string) => /^S\d+/.exec(l)?.[0] ?? l
const NOT = ['id', 'expectedRevision', 'scenarios', 'after', 'remove', 'reason', 'evidence']
function criteria(t: Task, i: In): { criterion: string; original: string }[] {
  const was = new Map((t.acceptance ?? '').split('\n').filter(Boolean).map(l => [sid(l), l])), now = new Map(((i.scenarios ?? []) as string[]).map(l => [sid(l), l]))
  const sc = i.scenarios ? [...new Set([...was.keys(), ...now.keys()])].filter(k => was.get(k) !== now.get(k)).map(k => ({ criterion: `scenario ${k}`, original: was.get(k) ?? '(none)' })) : []
  const orig = (k: string) => (k === 'title' ? t.title : k === 'description' ? t.description : k === 'interface' ? t.design : k === 'type' ? t.type : t.meta[`cadre.${k}`]) || '(none)'
  return [...sc, ...Object.keys(i).filter(k => !NOT.includes(k)).map(k => ({ criterion: k, original: orig(k) }))]
}
async function amend(h: Host, i: In): Promise<Out> {
  const { id, expectedRevision, title, description, after = [], remove, reason, evidence, ...m } = i, s = await planOf(h); if (!s) return no(NOPLAN)
  const store = await storeOf(h), cur = await revOf(store, s.plan!.id)
  if (expectedRevision !== cur) return no(`expectedRevision: the plan is at revision ${cur}, not ${expectedRevision}; check your change against it and call again with expectedRevision ${cur}`)
  if (id === s.plan!.id && s.plan!.state !== 'draft') return no('id: the approved plan itself is fixed; amend its tasks')
  if (remove) { const r = await via(h, { tool: 'TaskUpdate', taskId: id, status: 'deleted' }), bad = said(r); return bad ? no(bad) : wrote(h, store, s.plan!.id, id, r) }
  if (title === undefined && description === undefined && !after.length && !Object.keys(m).length) return no('nothing to change: give at least one field to change')
  const g = await graph(store, s, after, id); if (g) return no(g)
  const t = await store.get(id).catch(() => null), approved = !!t && id !== s.plan!.id && (t.category !== 'draft' || !!t.meta['cadre.amended']), cs = approved ? criteria(t!, i) : [], at = await h.now()
  if (approved && (!reason || !evidence)) return no(`${reason ? 'evidence' : 'reason'}: required to change an approved task; give why (reason) and what shows it (evidence: a test output, a file and line), then call again`)
  const twice = cs.find(c => ledgerOf(t!).some(x => x.criterion === c.criterion)); if (twice) return no(`${twice.criterion}: changed once already; a second change to it is the user's: ask them`)
  const r = await via(h, { tool: 'TaskUpdate', taskId: id, ...(title !== undefined ? { subject: title } : {}), ...(description !== undefined ? { description } : {}), metadata: { ...m, ...(id === s.plan!.id ? {} : { amend: true }) }, ...(after.length ? { addBlockedBy: after } : {}) })
  const bad = said(r); if (bad) return no(bad)
  if (approved) {
    await store.setMeta(id, { 'cadre.amendments': JSON.stringify([...ledgerOf(t!), ...cs.map(c => ({ ...c, reason, evidence, at }))]) }, 'main')
    if (yoloOn((await h.board.read()).drive)) {   // yolo: no dialog; main's change stands, recorded
      const reg = await registryOf(h); await store.approve([id]); await store.setMeta(id, { 'cadre.amended': '' }, 'main'); await mirror(h, store, reg)
      await apply(h, { kind: 'approve', id, at, actor: 'main' }, pipeOf(reg)); await h.board.update(b => ({ ...b, approval: { planId: null, missing: [] }, sheet: [] }) as typeof b); await settleIf(h, 'plan:')
      await DRIVE.decided?.(h, 'plan', `${id} amended by Claude (${cs.map(c => c.criterion).join(', ')}): ${reason}`)
    }
  }
  return wrote(h, store, s.plan!.id, id, r)
}
// a question for the code base: queued here, started by the spawner when this turn ends (core/spawner.explores); the answer comes back as a message
async function explore(h: Host, i: In): Promise<Out> {
  if (i.id !== undefined) { const a = await askById(h, i.id); return a ? { result: modelData('tool-result', askTask(a)) } : no(`id: no explorer answer ${i.id}`) }
  if (i.question === undefined) return no('question: required; ask what you need to know about the code, e.g. "where is login handled?"')
  const q = ((await h.ui.read()).explore as string[] | undefined) ?? []
  if (q.length >= 3) return no('question: 3 explorers are already waiting to start; end your turn and use their answers first')
  await h.ui.update(u => ({ ...u, explore: [...q, i.question] }))
  return { result: modelText('tool-result', 'An explorer starts when this turn ends. Its answer comes back to you as a message; do not ask again.') }
}
// an open question on the plan: it blocks approval until main records the user's answer (ask the user, then ask {id, answer})
async function ask(h: Host, i: In): Promise<Out> {
  const s = await planOf(h); if (!s) return no(NOPLAN)
  const store = await storeOf(h), qs = questionsOf(await store.get(s.plan!.id))
  if (i.id !== undefined || i.answer !== undefined) {
    const q = qs.find(x => x.id === i.id); if (!q) return no(`id: no question ${i.id ?? '(missing)'}; open: ${qs.filter(x => x.answer === undefined).map(x => x.id).join(', ') || 'none'}`)
    if (i.answer === undefined) return no('answer: required with id; give the user\'s answer in their words'); q.answer = i.answer
  } else if (i.question === undefined) return no('question: required; or id and answer to record the user\'s answer')
  else if (qs.length >= 10) return no('question: a plan holds at most 10 questions; ask the user the open ones first')
  else qs.push({ id: `q${qs.length + 1}`, q: i.question })
  await store.setMeta(s.plan!.id, { 'cadre.questions': JSON.stringify(qs) }, 'main')
  const missing = await retouch(h, store, await registryOf(h))
  return wrote(h, store, s.plan!.id, i.id ?? qs[qs.length - 1].id, { context: missing.length ? [modelText('context', missingLine(missing))] : [] })
}
export const PLAN_TOOLS: Record<string, (h: Host, i: In) => Promise<Out>> = { plan, task, epic, amend, explore, ask }

// main's built-in Agent: refused, pointing to the tools (main-only: an agent's own calls carry agentId). Wired at the switch-over (hooks/register), when
// the tools replace main's Agent; today main still starts its clarify explorer and, without the spawner, its task agents with Agent.
export const mainAgent = (e: { tool?: string; agentId?: string }) => (e.tool === 'Agent' && !e.agentId ? { deny: modelText('deny', 'plan the work with plan and task; to learn about the code, call explore with your question') } : undefined)
