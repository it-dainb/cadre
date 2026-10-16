// Main's planning tools (parent plan §3.2): plan, task, epic, amend, explore, ask, status. tools/index checks the strict schema (validate.checkInput) and the
// role; here the graph (after[]: ids of this plan, no wait that leads back), then the write through the TaskStore. Every write bumps the plan's revision
// (cadre.rev) and clears its approval receipt (cadre.receipt, written by dispatch.approve): an edit revokes approval; amend names the revision it read. ask's
// open questions block approval (dispatch.planMissing). Drafts, field mapping, frozen approved fields and the lifecycle (close/admission register LIFECYCLE).
import { modelData, modelText } from './say'
import { askById, askTask } from './asks'
import type { Host, Snapshot } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { StoreError } from '../task-management/store'
import type { TypeRegistry } from '../task-management/registry'
import { pipeOf } from '../task-management/registry'
import { canon, modelView } from './board'
import { apply } from './machine'
import { settleIf, yoloOn } from './decide'
import { DRIVE, cfgOf, draftsOf, mirror, registryOf, storeOf } from './dispatch'
import { repoSplit } from './specview'
import { scoped } from '../commands/init'
import { retouch, roadmapRules } from './lanes'
import { MS, epicOf, isMs, planEpic } from './milestone'
import { epicBranch, slug } from './branches'
import { capped, clearRetries, missingLine, questionsOf, refuse, validateFields } from './validate'
import { nextAction, subject, taskText } from './render'
import { clarifyTool } from './clarify'
import { idsIn } from './briefs'

// Plan rules (DESIGN 3.1): ≤1.5 KB, byte-stable for one registry. Carried once per plan, in the first answer's `context`.
export const planRules = (reg: TypeRegistry): string => [
  'Plan rules (v1)',
  '- A plan starts with plan {title, description, lane:"full", reason}; then one task call per task. Order tasks with after: ["<id>"].',
  '- Task fields: type, scope?, breaking?, package, scenarios ["S1: Given <state> When <action> Then <outcome>"], changelog {"category":"Added","entry":"…"} or {"none":true,"reason":"…"}, interface {"symbols":[{"name","kind","params":[…],"returns","status":"new|changed|unchanged"}]} or {"none":true,"reason":"…"}.',
  `- Types and pipelines: ${Object.entries(reg).map(([t, s]) => `${t} ${s.pipeline.join('>')}`).join('; ')}.`,
  '- Each task is a vertical slice: shown working on its own, fits one fresh context, has its wiring and one smoke assertion.',
  '- With 2+ tasks: paths per task (files or folders it changes). Code 2+ tasks need: ONE thin core task first (core:true; interfaces, minimal code, contract tests) that the others wait for (after). Two tasks on one path need an after dependency.',
  '- Exploration 2+ tasks need: one explore before the plan; its findings go in the plan\'s notes as [{"paths":[…],"text":"…"}] (no paths: all tasks).',
  '- A draft may be incomplete: the "missing:" line says what approval still needs.',
  '- Only the human approves, in the dialog. An approved task changes only through amend, with reason and evidence.',
].join('\n')

const NATIVE = { draft: 'pending', todo: 'pending', active: 'in_progress', review: 'in_progress', blocked: 'in_progress', done: 'completed', cancelled: 'completed' } as const
const REFUSED = 'approved; amend it to return it to draft'
// The lifecycle (completed / pending / deleted / decision on an approved task or an epic) belongs to close: it registers here at load.
export const LIFECYCLE: Partial<Record<'completed' | 'pending' | 'deleted' | 'decision', (h: Host, id: string, e: any) => Promise<string | null>>> = {}

type Out = Record<'result', unknown> & { context?: string[] }
type In = Record<string, any>
const no = (m: string): Out => ({ result: modelText('tool-result', `error: ${m.replaceAll('metadata.', '')}`) })
const ctx = (...c: string[]) => c.filter(Boolean).map(x => modelText('context', x))
const fail = (e: unknown): string => (e instanceof StoreError ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e))

// task fields -> the store's fields. null clears: '' for text/meta.
export function fieldsOf(m: Record<string, any>): { patch: Parameters<TaskStore['update']>[1]; meta: Record<string, string> } {
  const patch: Parameters<TaskStore['update']>[1] = {}, meta: Record<string, string> = {}, has = (k: string) => m[k] !== undefined
  if (has('scenarios')) patch.acceptance = m.scenarios === null ? '' : m.scenarios.join('\n')
  if (has('interface')) patch.design = m.interface === null ? '' : canon(m.interface)
  for (const k of ['package', 'scope', 'critique']) if (has(k)) meta[`cadre.${k}`] = m[k] ?? ''
  if (has('breaking')) meta['cadre.breaking'] = String(m.breaking ?? false)
  if (has('changelog')) meta['cadre.changelog'] = m.changelog === null ? '' : canon(m.changelog)
  for (const k of ['repro', 'core']) if (has(k)) meta[`cadre.${k}`] = m[k] ? 'true' : ''
  if (has('paths')) meta['cadre.paths'] = m.paths === null ? '' : JSON.stringify(m.paths)
  if (has('size')) meta['cadre.size'] = m.size === null ? '' : String(m.size)
  return { patch, meta }
}

// An open plan blocks a new one only when someone can act on it (live 0.9.1). Not in the store: the board pointer goes. A draft whose dialog is up: the human
// answers it. An incomplete draft never reached the human: it is discarded. An approved plan: finish it. Returns 'dropped' (go on) or the refusal.
async function stale(h: Host, store: TaskStore, p: NonNullable<Snapshot['plan']>): Promise<string> {
  const t = await store.get(p.id).catch(x => (x instanceof StoreError && x.code === 'NotFound' ? null : Promise.reject(x)))
  if (t && p.state !== 'draft') return `plan ${p.id} is still in progress: finish it first (status shows what is left); a new plan starts after it lands`
  if (t && ((await h.board.read()).decisions ?? []).some(d => d.id === `plan:${p.id}`)) return `plan ${p.id} waits for the human in the dialog: ask them to approve or reject it there (press 1)`
  if (t && isMs(p)) return `plan ${p.id} is an unfinished roadmap: add what its missing line names so the human can approve it`   // its epics hold drafts of their own: never discarded wholesale
  if (t) await store.dropDrafts([...(await draftsOf(store, p.id)).map(x => x.id), p.id])
  await h.board.update(b => ({ ...b, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
  await settleIf(h, 'plan:'); await h.store.del(await scoped(h, 'board'))
  return 'dropped'
}
// a second task of the same plan with the subject or the declared files of an open one: two agents would write the same change and conflict at merge (live)
const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' '), filesOf = (v?: string) => { try { return JSON.parse(v || '[]').map(String).sort().join('\n') } catch { return '' } }
export async function twinOf(store: TaskStore, parent: string, title: string, desc: string, paths?: string): Promise<{ id: string; why: string } | null> {   // same files alone may be two steps on one file
  const open = (await store.list({ parent })).filter(t => t.type !== 'gate' && t.category !== 'done' && t.category !== 'cancelled'), p = filesOf(paths)
  const t = open.find(x => norm(x.title) === norm(title)) ?? (p ? open.find(x => filesOf(x.meta['cadre.paths']) === p && norm(x.description) === norm(desc)) : undefined)
  return t ? { id: t.id, why: norm(t.title) === norm(title) ? 'the same title' : 'the same files and description' } : null
}

// ---- the writes (each returns a refusal or {id, context}) ----
type W = { error: string } | { id: string; context: string[] }
async function create(h: Host, store: TaskStore, reg: TypeRegistry, title: string, description: string, m: In): Promise<W> {
  const key = `create:${title}`
  if (await capped(h, key)) return { error: await refuse(h, key, 'draft refused') }
  const err = validateFields(m, reg) ?? repoSplit(await cfgOf(h), m.paths); if (err) return { error: await refuse(h, key, err) }
  await clearRetries(h, key)
  const s = await h.board.read()
  if (m.kind === 'mission' && (await h.secret.read()).run?.goal) return { error: 'not now: the user\'s goal comes next, and its plan carries the mission (plan mission). Go on with the next setup step.' }   // ADR 0014: one dialog for mission + plan
  if (m.kind) {
    const was = s.plan && !['done-on-dev', 'released'].includes(s.plan.state) ? await stale(h, store, s.plan) : null
    if (was && was !== 'dropped') return { error: was }
    const prefix = m.lane === 'milestone' ? MS : (await cfgOf(h)).branches.epicPrefix, id = await store.createEpic(title, description), mission = m.kind === 'mission', name = mission ? 'mission' : slug(title)
    if (mission) await store.setMeta(id, { 'cadre.kind': 'mission' }, 'main')
    else if (m.lane || m.mission || m.notes || m.assumed) await store.setMeta(id, { ...(m.assumed ? { 'cadre.assumed': JSON.stringify(m.assumed) } : {}), ...(m.lane ? { 'cadre.lane': m.lane } : {}), ...(m.reason ? { 'cadre.laneReason': m.reason } : {}), ...(m.mission ? { 'cadre.mission': m.mission.trim() } : {}), ...(m.notes ? { 'cadre.notes': typeof m.notes === 'string' ? m.notes.trim() : JSON.stringify(m.notes) } : {}) }, 'main')   // lanes (ADR 0011), a mission drafted with the plan (ADR 0014)
    await h.board.update(b => ({ ...b, epic: id, tasks: [], plan: { id, slug: name, state: 'draft', epicBranch: mission ? '' : epicBranch(prefix, id, title) }, approval: { planId: id, missing: [] } }))
    const lite = !mission && m.lane === 'lite', f = fieldsOf(m)   // a lite plan is one call: the plan and its one task
    if (lite) await store.createDraft({ title, description, acceptance: f.patch.acceptance, design: f.patch.design, type: m.type ?? 'feature', parent: id, meta: f.meta })
    const missing = await retouch(h, store, reg)
    return { id, context: ctx(was ? `The unfinished draft ${s.plan!.id} was discarded: the human never saw it.` : '', mission || lite ? '' : m.lane === 'milestone' ? roadmapRules(id) : planRules(reg), missingLine(missing)) }
  }
  if (!s.epic || !s.plan) return { error: 'no plan yet: call plan first' }
  if (s.plan.slug === 'mission') return { error: 'a mission draft takes no tasks; once it is approved, start a plan' }
  const f = fieldsOf(m), ms = isMs(s.plan), road = ms && s.plan.state === 'draft', ep = epicOf(s, m.epic)   // a milestone: a roadmap draft takes epics; an approved one takes the tasks of the epic it names (ADR 0015)
  if (ms && !road && m.core === true && m.epic === undefined) {   // a shared need found while running: a core-patch epic, approved now (recorded) (ADR 0015 wave 2)
    const c = await store.createDraft({ title, description, type: 'epic', parent: s.epic, meta: { ...f.meta, 'cadre.size': '1' } })
    await store.approve([c.id]); await mirror(h, store, reg); await DRIVE.decided?.(h, 'plan', `core patch epic ${c.id} added to milestone ${s.plan.id}: ${title}`)
    return { id: c.id, context: ctx(`${c.id} is a core-patch epic of the milestone: plan it when the next: line names it; the running epics take it when it lands`) }
  }
  if (ms && !road && s.drive.planner === 'agent' && m.epic !== undefined) return { error: `epic ${m.epic}'s tasks are planned for you when it is ready; nothing to do for it` }   // milestone.epicPlanner agent (ADR 0021)
  if (ms && !road && !['ready', 'planning'].includes(ep?.state ?? '')) return { error: `name the epic these tasks plan in epic; ready to plan: ${(s.plan.epics ?? []).filter(x => x.state === 'ready' || x.state === 'planning').map(x => x.id).join(', ') || 'none (wait for the next: line)'}` }
  if (!ms && m.epic !== undefined) return { error: 'epic: only in a milestone; omit it' }
  const twin = await twinOf(store, ep?.id ?? s.epic, title, description, f.meta['cadre.paths']); if (twin) return { error: `${twin.id} already covers this (${twin.why}): amend ${twin.id} instead of adding a second task` }
  const t = await store.createDraft({ title, description, acceptance: f.patch.acceptance, design: f.patch.design, type: road ? 'epic' : m.type ?? 'feature', parent: ep?.id ?? s.epic, meta: f.meta })
  return { id: t.id, context: ctx(ep?.state === 'ready' ? planRules(reg) : '', missingLine(await retouch(h, store, reg))) }
}
// an edit: title, description, task fields, after (more ids to wait for); an approved task returns to draft (amend)
async function edit(h: Host, store: TaskStore, reg: TypeRegistry, id: string, i: In): Promise<W> {
  if (await capped(h, id)) return { error: await refuse(h, id, 'update refused') }
  let t: Task; try { t = await store.get(id) } catch (x) { return { error: x instanceof StoreError && x.code === 'NotFound' ? `id: no task ${id}` : fail(x) } }
  const { title, description, after = [], ...m } = i, s = await h.board.read()
  const no2 = async (why: string): Promise<W> => ({ error: await refuse(h, id, why) })
  if (m.critique !== undefined && !Object.values(((await h.ui.read()).asks ?? {}) as Record<string, { answer?: string }>).some(a => a.answer !== undefined)) return no2('critique: ask the critic first (explore with the whole roadmap) and use its answer')
  const err = validateFields(m, reg) ?? repoSplit(await cfgOf(h), m.paths) ?? (m.type !== undefined && m.type !== t.type ? `type: fixed at creation (${t.type}); remove the draft and add a new task` : null); if (err) return no2(err)
  const isEpic = id === s.epic, draft = t.category === 'draft' && !(isEpic && s.plan && s.plan.state !== 'draft')   // approval leaves the epic itself draft: its board state is the truth
  if (!draft) {
    if (isEpic) return { error: REFUSED }
    await mirror(h, store, reg)   // the board may have lost the task (/clear)
    const r = await apply(h, { kind: 'amend', id, at: await h.now(), actor: 'main' }, pipeOf(reg)); if (!r.ok) return { error: r.error }
    await store.amend(id); await store.setMeta(id, { 'cadre.amended': '1' }, 'main')   // reject reverts an amendment, never deletes the approved task
  }
  const f = fieldsOf(m)
  try {
    const patch = { ...f.patch, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) }
    if (Object.keys(patch).length) await store.update(id, patch, 'main')
    if (Object.keys(f.meta).length) await store.setMeta(id, f.meta, 'main')
    for (const d of after) await store.link(id, { id: d, type: 'blocks' })
  } catch (x) { await retouch(h, store, reg); return no2(fail(x)) }
  await clearRetries(h, id)
  return { id, context: ctx(missingLine(await retouch(h, store, reg))) }
}
// the lifecycle: set completed|pending|deleted, or a decision; a draft's deletion drops it
async function life(h: Host, store: TaskStore, reg: TypeRegistry, id: string, set: string | undefined, decision?: string, reason?: string): Promise<Out> {
  let t: Task; try { t = await store.get(id) } catch (x) { return no(x instanceof StoreError && x.code === 'NotFound' ? `id: no task ${id}` : fail(x)) }
  const s = await h.board.read(), draft = t.category === 'draft' && !(id === s.epic && s.plan && s.plan.state !== 'draft'), k = (set ?? 'decision') as keyof typeof LIFECYCLE
  if (draft && set === 'deleted' && id !== s.epic) { await store.dropDrafts([id]); return { result: modelData('tool-result', { id, set }), context: ctx(missingLine(await retouch(h, store, reg))) } }
  if (draft) return no(`${set ?? 'decision'} does not apply to a draft: the human approves it in the dialog`)
  const why = await LIFECYCLE[k]!(h, id, { metadata: { decision, reason } })
  if (why) return no(why)
  const b = await h.board.read(), card = set === 'completed' ? b.tasks.find(x => x.id === id)?.card ?? (b.plan?.landed ? `${b.plan.id} landed on dev: nothing is left to do; tell the user` : undefined) : undefined   // the close card: main sees that the squash landed
  return { result: modelData('tool-result', { id, ...(set ? { set } : { decision }) }), ...(card ? { context: ctx(card) } : {}) }
}

// ---- revision, graph ----
const revOf = async (store: TaskStore, plan: string) => Number((await store.get(plan)).meta['cadre.rev'] ?? 0)
async function wrote(h: Host, store: TaskStore, plan: string, id: string, context: string[] = [], taken?: number): Promise<Out> {   // taken: amend bumped it already
  const revision = taken ?? (await revOf(store, plan)) + 1, at = await h.now()
  if (taken === undefined) await store.setMeta(plan, { 'cadre.rev': String(revision), 'cadre.receipt': '' }, 'main')
  return { result: modelData('tool-result', { id, plan, revision, at, by: 'main' }), ...(context.length ? { context } : {}) }
}
const BLOCK = ['blocks', 'waits-for']
async function graph(store: TaskStore, s: Snapshot, after: string[], self?: string): Promise<string | null> {   // after[]: ids of this plan's tasks (or a roadmap's epics); none may already wait for self
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
const deps = async (h: Host) => ({ store: await storeOf(h), reg: await registryOf(h) })

// ---- the tools ----
async function plan(h: Host, i: In): Promise<Out> {
  const { title, description, kind = 'plan', ...m } = i
  const c = await clarifyTool(h, 'plan', m) as Out | undefined; if (c) return c   // a yolo plan lists its assumptions (core/clarify)
  const { store, reg } = await deps(h), r = await create(h, store, reg, title, description, { kind, ...m }); if ('error' in r) return no(r.error)
  return wrote(h, store, r.id, r.id, r.context)
}
async function add(h: Host, title: string, description: string, after: string[], m: In): Promise<Out> {   // a task, or an epic of a roadmap
  const s = await planOf(h); if (!s) return no(NOPLAN)
  const { store, reg } = await deps(h), g = await graph(store, s, after); if (g) return no(g)
  const r = await create(h, store, reg, title, description, m); if ('error' in r) return no(r.error)
  const e = after.length ? await edit(h, store, reg, r.id, { after }) : r; if ('error' in e) return no(`after: ${e.error}`)
  return wrote(h, store, (await h.board.read()).plan!.id, r.id, e.context)
}
const task = (h: Host, i: In) => { const { title, description, after = [], ...m } = i; return add(h, title, description, after, m) }
async function epic(h: Host, i: In): Promise<Out> {
  const s = await planOf(h); if (!s) return no(NOPLAN)
  if (!isMs(s.plan)) return no('epics belong to a milestone (plan lane "milestone"); add tasks with task')
  if (i.planned !== undefined) {
    if (i.id === undefined) return no('id: required with planned; name the epic whose tasks are all drafted')
    const { store, reg } = await deps(h), why = i.planned === true ? await planEpic(h, store, reg, i.id) : 'planned: true, on an epic whose tasks are all drafted'
    return why ? no(why) : wrote(h, store, s.plan!.id, i.id, ctx(`${i.id} is approved; next: ${nextAction(modelView(await h.board.read()))}`))   // the epic's plan: approved automatically (core/milestone)
  }
  for (const k of ['title', 'goal', 'size']) if (i[k] === undefined) return no(`${k}: required for a new epic; add it and call again`)
  const { title, goal, after = [], id: _i, ...m } = i
  return add(h, title, goal, after, m)
}
// The amendment ledger: a change to an approved task names its reason and evidence; each criterion (a scenario by id, any other field by name) keeps its original
// verbatim and changes once (a second change is the user's). auto: the task goes back to the user's dialog; yolo: main's decision is recorded and stands.
type Entry = { criterion: string; original: string; reason: string; evidence: string; at: number }
const ledgerOf = (t: Task): Entry[] => { try { return JSON.parse(t.meta['cadre.amendments'] || '[]') } catch { return [] } }
const sid = (l: string) => /^S\d+/.exec(l)?.[0] ?? l
const NOT = ['id', 'expectedRevision', 'scenarios', 'after', 'remove', 'reason', 'evidence']
function criteria(t: Task, i: In): { criterion: string; original: string }[] {   // a value equal to the stored one is no change; after (new waits) is one
  const was = new Map((t.acceptance ?? '').split('\n').filter(Boolean).map(l => [sid(l), l])), now = new Map(((i.scenarios ?? []) as string[]).map(l => [sid(l), l]))
  const sc = i.scenarios ? [...new Set([...was.keys(), ...now.keys()])].filter(k => was.get(k) !== now.get(k)).map(k => ({ criterion: `scenario ${k}`, original: was.get(k) ?? '(none)' })) : []
  const raw = (k: string) => (k === 'title' ? t.title : k === 'description' ? t.description : k === 'interface' ? t.design : k === 'type' ? t.type : t.meta[`cadre.${k}`]) ?? ''
  const f = fieldsOf(i), given = (k: string) => (k === 'title' || k === 'description' || k === 'type' ? i[k] : k === 'interface' ? f.patch.design : f.meta[`cadre.${k}`])
  const deps = t.deps.filter(d => BLOCK.includes(d.type)).map(d => d.id), after = ((i.after ?? []) as string[]).filter(x => !deps.includes(x))
  return [...sc, ...Object.keys(i).filter(k => !NOT.includes(k) && given(k) !== raw(k)).map(k => ({ criterion: k, original: raw(k) || '(none)' })), ...(after.length ? [{ criterion: 'after', original: deps.join(', ') || '(none)' }] : [])]
}
async function amend(h: Host, i: In): Promise<Out> {
  const { id, expectedRevision, after = [], remove, reason, evidence, ...m } = i, s = await planOf(h); if (!s) return no(NOPLAN)
  const { store, reg } = await deps(h), p = await store.get(s.plan!.id), cur = Number(p.meta['cadre.rev'] ?? 0)
  if (expectedRevision !== cur) return no(`expectedRevision: the plan is at revision ${cur}, not ${expectedRevision}; check your change against it and call again with expectedRevision ${cur}`)
  if (id === s.plan!.id && s.plan!.state !== 'draft') return no('id: the approved plan itself is fixed; amend its tasks')
  if (!remove && !after.length && !Object.keys(m).length) return no('nothing to change: give at least one field to change')
  const g = remove ? null : await graph(store, s, after, id); if (g) return no(g)
  const t = await store.get(id).catch(() => null), approved = !!t && id !== s.plan!.id && (t.category !== 'draft' || !!t.meta['cadre.amended']), at = await h.now()
  const cs = !approved ? [] : remove ? [{ criterion: 'removed', original: t!.title }] : criteria(t!, i)
  if (approved && (!reason || !evidence)) return no(`${reason ? 'evidence' : 'reason'}: required to change an approved task; give why (reason) and what shows it (evidence: a test output, a file and line), then call again`)
  if (approved && !cs.length) return no('nothing to change: every value you gave equals the current one')
  const twice = cs.find(c => ledgerOf(t!).some(x => x.criterion === c.criterion)); if (twice) return no(`${twice.criterion}: changed once already; a second change to it is the user's: ask them`)
  // the revision is taken with one compare-and-set on the plan before the write: a write that landed after the check above refuses this one
  try { await store.setMeta(s.plan!.id, { 'cadre.rev': String(cur + 1), 'cadre.receipt': '' }, 'main', p.revision) } catch (x) { if (x instanceof StoreError && x.code === 'GuardMismatch') return no('expectedRevision: the plan changed while you wrote; read it with status and call again with its new revision'); throw x }
  const log = () => store.setMeta(id, { 'cadre.amendments': JSON.stringify([...ledgerOf(t!), ...cs.map(c => ({ ...c, reason, evidence, at }))]) }, 'main')
  if (remove) { const r = await life(h, store, reg, id, 'deleted', undefined, reason); if (typeof r.result === 'string') return r; if (approved) await log(); return wrote(h, store, s.plan!.id, id, r.context, cur + 1) }
  const r = await edit(h, store, reg, id, { ...m, after }); if ('error' in r) return no(r.error)
  if (approved) {
    await log()
    if (yoloOn((await h.board.read()).drive)) {   // yolo: no dialog; main's change stands, recorded
      await store.approve([id]); await store.setMeta(id, { 'cadre.amended': '' }, 'main'); await mirror(h, store, reg)
      await apply(h, { kind: 'approve', id, at, actor: 'main' }, pipeOf(reg)); await h.board.update(b => ({ ...b, approval: { planId: null, missing: [] }, sheet: [] }) as typeof b); await settleIf(h, 'plan:')
      await DRIVE.decided?.(h, 'plan', `${id} amended by Claude (${cs.map(c => c.criterion).join(', ')}): ${reason}`)
    }
  }
  return wrote(h, store, s.plan!.id, id, r.context, cur + 1)
}
// a question for the code base: queued here, started by the spawner when this turn ends (core/spawner.explores); the answer comes back as a message
async function explore(h: Host, i: In): Promise<Out> {
  if (i.id !== undefined) { const a = await askById(h, i.id); return a ? { result: modelData('tool-result', askTask(a)) } : no(`id: no explorer answer ${i.id}`) }
  if (i.question === undefined) return no('question: required; ask what you need to know about the code, e.g. "where is login handled?"')
  const q = ((await h.ui.read()).explore as string[] | undefined) ?? []
  if (q.length >= 3) return no('question: 3 explorers are already waiting to start; end your turn and use their answers first')
  await h.ui.update(u => ({ ...u, explore: [...q, i.question] }))
  return { result: modelText('tool-result', 'An explorer starts when this turn ends. Its answer comes back to you as a message; end your turn now and do not ask again.') }
}
// an open question on the plan: it blocks approval until main records the user's answer; or the goal's clarity record (core/clarify)
async function ask(h: Host, i: In): Promise<Out> {
  if (i.clarity !== undefined) return ((await clarifyTool(h, 'clarity', i.clarity)) as Out | undefined) ?? no('clarity: not now; draft the plan')
  const s = await planOf(h); if (!s) return no(NOPLAN)
  const store = await storeOf(h), qs = questionsOf(await store.get(s.plan!.id))
  if (i.id !== undefined || i.answer !== undefined) {
    const q = qs.find(x => x.id === i.id); if (!q) return no(`id: no question ${i.id ?? '(missing)'}; open: ${qs.filter(x => x.answer === undefined).map(x => x.id).join(', ') || 'none'}`)
    if (i.answer === undefined) return no('answer: required with id; give the user\'s answer in their words'); q.answer = i.answer
  } else if (i.question === undefined) return no('question: required; or id and answer to record the user\'s answer')
  else if (qs.length >= 10) return no('question: a plan holds at most 10 questions; ask the user the open ones first')
  else qs.push({ id: `q${qs.length + 1}`, q: i.question })
  await store.setMeta(s.plan!.id, { 'cadre.questions': JSON.stringify(qs) }, 'main')
  return wrote(h, store, s.plan!.id, i.id ?? qs[qs.length - 1].id, ctx(missingLine(await retouch(h, store, await registryOf(h)))))
}
// the plan's tasks; one task (or an explorer's answer); or its lifecycle: set completed|pending|deleted, or a decision on a blocked task
async function status(h: Host, i: In): Promise<Out> {
  const v = modelView(await h.board.read()), open = (x: string) => !['done', 'cancelled'].includes(v.tasks.find(t => t.id === x)?.state ?? 'done')
  if (i.id === undefined) return { result: modelData('tool-result', { plan: v.plan?.id ?? null, revision: v.plan ? await revOf(await storeOf(h), v.plan.id).catch(() => 0) : 0, tasks: v.tasks.map(t => ({ id: t.id, title: subject(t), status: NATIVE[t.state], ...(t.owner ? { owner: t.owner } : {}), after: t.deps.map(d => d.id).filter(open) })) }) }
  const { store, reg } = await deps(h)
  if (i.set !== undefined || i.decision !== undefined) return life(h, store, reg, i.id, i.set, i.decision, i.reason)
  if (String(i.id).startsWith('ask-')) { const a = await askById(h, String(i.id)); return a ? { result: modelData('taskget', askTask(a)) } : no(`id: no task ${i.id}`) }   // an explorer's answer
  let t: Task; try { t = await store.get(String(i.id)) } catch (x) { return no(x instanceof StoreError && x.code === 'NotFound' ? `id: no task ${i.id}` : fail(x)) }
  const st = v.tasks.find(x => x.id === t.id)
  return { result: modelData('taskget', { id: t.id, title: st ? subject(st) : t.title, description: taskText(t, st), status: NATIVE[t.category], blocks: v.tasks.filter(x => x.deps.some(d => d.id === t.id)).map(x => x.id), after: t.deps.filter(d => d.type !== 'discovered-from' && d.type !== 'related' && d.type !== 'parent-child').map(d => d.id).filter(open) }) }
}
export const PLAN_TOOLS: Record<string, (h: Host, i: In) => Promise<Out>> = { plan, task, epic, amend, explore, ask, status }

// main's built-in Agent with no task in it (exploring, asking a critic): refused, pointing to the tools. A start of a planned task (its id in the prompt) goes on to
// admission: a session where Claude starts the agents (headless) still runs. The task tools of a repo whose settings still show them: refused the same way.
// An agent's own calls carry agentId and pass.
export const TASK_TOOLS = ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate']
export const mainAgent = (e: { tool?: string; agentId?: string; prompt?: string }, ids: string[], origin?: { plugin?: string }) => (e.agentId || (origin?.plugin && origin.plugin !== 'engine') ? undefined   // a plugin's own call (cadre's spawner starting an explorer or a task) passes
  : e.tool === 'Agent' && !idsIn(String(e.prompt ?? ''), ids).length ? { deny: modelText('deny', 'plan the work with plan and task; to learn about the code or ask a critic, call explore with your question') }
  : TASK_TOOLS.includes(String(e.tool)) ? { deny: modelText('deny', 'plan with the plan tools instead: plan, task, epic, amend; status reads the plan and moves a task on') } : undefined)
