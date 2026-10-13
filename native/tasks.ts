// Native Task* for main (DESIGN 5.1): `{result}` answers schema-exact per BTO §4 (nothing in core runs: no zod, no panel, no TaskCreated hooks),
// drafts through TaskStore, field mapping, deps, frozen approved fields, TaskList/TaskGet from the model view. Main only; subagents never see Task*.
import { modelData, modelText } from '../core/say'
import { askById, askTask } from '../core/asks'
import type { Hook, Host, Snapshot } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { StoreError } from '../task-management/store'
import type { TypeRegistry } from '../task-management/registry'
import { canon, modelView } from '../core/board'
import { apply } from '../core/machine'
import { pipeOf } from '../task-management/registry'
import { DRIVE, cfgOf, draftsOf, mirror, registryOf, storeOf } from '../core/dispatch'
import { settleIf } from '../core/decide'
import { scoped } from '../commands/init'
import { retouch, roadmapRules } from '../core/lanes'
import { MS, epicOf, isMs, planEpic } from '../core/milestone'
import { epicBranch, slug } from '../core/branches'
import { capped, clearRetries, missingLine, refuse, validateFields } from '../core/validate'
import { nextAction, subject, taskText } from '../core/render'

// Plan rules (DESIGN 3.1): ≤1.5 KB, byte-stable for one registry. Carried once per plan, in the first answer's `context`.
export const planRules = (reg: TypeRegistry): string => [
  'Plan rules (v1)',
  '- Start a plan with TaskCreate metadata {"kind":"plan","lane":"full","reason":"…"}; every later TaskCreate is a task of that plan. Order tasks with TaskUpdate addBlockedBy.',
  '- Task metadata: type, scope?, breaking?, package, scenarios ["S1: Given <state> When <action> Then <outcome>"], changelog {"category":"Added","entry":"…"} or {"none":true,"reason":"…"}, interface {"symbols":[{"name","kind","params":[…],"returns","status":"new|changed|unchanged"}]} or {"none":true,"reason":"…"}.',
  `- Types and pipelines: ${Object.entries(reg).map(([t, s]) => `${t} ${s.pipeline.join('>')}`).join('; ')}.`,
  '- Each task is a vertical slice: shown working on its own, fits one fresh context, has its wiring and one smoke assertion.',
  '- With 2+ tasks: metadata.paths per task (files or folders it changes). Code 2+ tasks need: ONE thin core task first (metadata.core:true; interfaces, minimal code, contract tests) that blocks the others. Two tasks on one path need a blocks dependency.',
  '- Exploration 2+ tasks need: one Agent (no task id) before the plan; its findings go in the plan\'s metadata.notes as [{"paths":[…],"text":"…"}] (no paths: all tasks).',
  '- A draft may be incomplete: the "missing:" line says what approval still needs.',
  '- Only the human approves, in the dialog. Approved tasks are frozen: set metadata.amend:true to edit one. Never set owner, in_progress or cadre*.',
].join('\n')

const NATIVE = { draft: 'pending', todo: 'pending', active: 'in_progress', review: 'in_progress', blocked: 'in_progress', done: 'completed', cancelled: 'completed' } as const
const REFUSED = 'approved; set metadata.amend:true to return it to draft'
// Lifecycle updates (completed / pending / deleted / metadata.decision on an approved task or the epic) belong to close/admission (wave 3):
// they register here at load; until then the call is refused with a clear error.
export const LIFECYCLE: Partial<Record<'completed' | 'pending' | 'deleted' | 'decision', (h: Host, id: string, e: any) => Promise<string | null>>> = {}

const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const withCtx = <T>(result: T, ...ctx: string[]) => { const context = ctx.filter(Boolean).map(c => modelText('context', c)); return context.length ? { result: modelData('tool-result', result), context } : { result: modelData('tool-result', result) } }

// metadata -> the store's fields. null clears: '' for text/meta.
export function fieldsOf(m: Record<string, any>): { patch: Parameters<TaskStore['update']>[1]; meta: Record<string, string>; names: string[] } {
  const patch: Parameters<TaskStore['update']>[1] = {}, meta: Record<string, string> = {}, names: string[] = []
  const has = (k: string) => m[k] !== undefined
  if (has('scenarios')) { patch.acceptance = m.scenarios === null ? '' : m.scenarios.join('\n'); names.push('metadata.scenarios') }
  if (has('interface')) { patch.design = m.interface === null ? '' : canon(m.interface); names.push('metadata.interface') }
  if (has('package')) { meta['cadre.package'] = m.package ?? ''; names.push('metadata.package') }
  if (has('scope')) { meta['cadre.scope'] = m.scope ?? ''; names.push('metadata.scope') }
  if (has('breaking')) { meta['cadre.breaking'] = String(m.breaking ?? false); names.push('metadata.breaking') }
  if (has('changelog')) { meta['cadre.changelog'] = m.changelog === null ? '' : canon(m.changelog); names.push('metadata.changelog') }
  if (has('repro')) { meta['cadre.repro'] = m.repro ? 'true' : ''; names.push('metadata.repro') }
  if (has('paths')) { meta['cadre.paths'] = m.paths === null ? '' : JSON.stringify(m.paths); names.push('metadata.paths') }
  if (has('core')) { meta['cadre.core'] = m.core ? 'true' : ''; names.push('metadata.core') }
  if (has('size')) { meta['cadre.size'] = m.size === null ? '' : String(m.size); names.push('metadata.size') }
  if (has('critique')) { meta['cadre.critique'] = m.critique ?? ''; names.push('metadata.critique') }
  return { patch, meta, names }
}
const fail = (e: unknown): string => (e instanceof StoreError ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e))

// An open plan blocks a new one only when someone can act on it (live 0.9.1: a draft with no store record and no dialog blocked every plan, and the refusal named a dialog
// that did not exist). Not in the store: the board pointer goes. A draft whose dialog is up: the human answers it. An incomplete draft never reached the human: it is
// discarded. An approved plan: finish it. Returns 'dropped' (go on) or the refusal.
async function stale(h: Host, store: TaskStore, p: NonNullable<Snapshot['plan']>): Promise<string> {
  const t = await store.get(p.id).catch(x => (x instanceof StoreError && x.code === 'NotFound' ? null : Promise.reject(x)))
  if (t && p.state !== 'draft') return `plan ${p.id} is still in progress: finish it first (TaskList shows what is left); a new plan starts after it lands`
  if (t && ((await h.board.read()).decisions ?? []).some(d => d.id === `plan:${p.id}`)) return `plan ${p.id} waits for the human in the dialog: ask them to approve or reject it there (press 1)`
  if (t && isMs(p)) return `plan ${p.id} is an unfinished roadmap: add what its missing line names so the human can approve it`   // its epics hold drafts of their own: never discarded wholesale
  if (t) await store.dropDrafts([...(await draftsOf(store, p.id)).map(x => x.id), p.id])
  await h.board.update(b => ({ ...b, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
  await settleIf(h, 'plan:'); await h.store.del(await scoped(h, 'board'))
  return 'dropped'
}
async function create(h: Host, store: TaskStore, reg: TypeRegistry, e: any) {
  const m = e.metadata ?? {}, key = `create:${e.subject}`
  if (!str(e.subject) || typeof e.description !== 'string') return { deny: modelText('deny', 'TaskCreate needs a subject and a description (strings); fields go in metadata') }
  if (await capped(h, key)) return { deny: modelText('deny', await refuse(h, key, 'draft refused')) }
  const err = typeof m === 'object' && m && !Array.isArray(m) ? validateFields(m, reg) : 'metadata: expected an object'
  if (err) return { deny: modelText('deny', await refuse(h, key, err)) }
  await clearRetries(h, key)
  const s = await h.board.read()
  if (m.kind === 'mission' && (await h.secret.read()).run?.goal) return { deny: modelText('deny', 'not now: the user\'s goal comes next, and its plan carries the mission (metadata.mission). Go on with the next setup step.') }   // ADR 0014: one dialog for mission + plan
  if (m.kind) {
    const was = s.plan && !['done-on-dev', 'released'].includes(s.plan.state) ? await stale(h, store, s.plan) : null
    if (was && was !== 'dropped') return { deny: modelText('deny', was) }
    const prefix = m.lane === 'milestone' ? MS : (await cfgOf(h)).branches.epicPrefix, id = await store.createEpic(e.subject, e.description), mission = m.kind === 'mission', name = mission ? 'mission' : slug(e.subject)
    if (mission) await store.setMeta(id, { 'cadre.kind': 'mission' }, 'main')
    else if (m.lane || m.mission || m.notes || m.assumed) await store.setMeta(id, { ...(m.assumed ? { 'cadre.assumed': JSON.stringify(m.assumed) } : {}), ...(m.lane ? { 'cadre.lane': m.lane } : {}), ...(m.reason ? { 'cadre.laneReason': m.reason } : {}), ...(m.mission ? { 'cadre.mission': m.mission.trim() } : {}), ...(m.notes ? { 'cadre.notes': typeof m.notes === 'string' ? m.notes.trim() : JSON.stringify(m.notes) } : {}) }, 'main')   // lanes (ADR 0011): core/lanes.relane reads them; a mission drafted with the plan (ADR 0014): core/dispatch shows and records it
    await h.board.update(b => ({ ...b, epic: id, tasks: [], plan: { id, slug: name, state: 'draft', epicBranch: mission ? '' : epicBranch(prefix, id, e.subject) }, approval: { planId: id, missing: [] } }))
    const lite = !mission && m.lane === 'lite', f = fieldsOf(m)   // a lite plan is one call: the plan and its one task
    if (lite) await store.createDraft({ title: e.subject, description: e.description, acceptance: f.patch.acceptance, design: f.patch.design, type: m.type ?? 'feature', parent: id, meta: f.meta })
    const missing = await retouch(h, store, reg)
    return withCtx({ task: { id, subject: e.subject } }, was ? `The unfinished draft ${s.plan!.id} was discarded: the human never saw it.` : '', mission || lite ? '' : m.lane === 'milestone' ? roadmapRules(id) : planRules(reg), missingLine(missing))
  }
  if (!s.epic || !s.plan) return { deny: modelText('deny', 'no plan yet: first TaskCreate with metadata {"kind":"plan"}') }
  if (s.plan.slug === 'mission') return { deny: modelText('deny', 'a mission draft takes no tasks; once it is approved, start a plan') }
  const f = fieldsOf(m), ms = isMs(s.plan), road = ms && s.plan.state === 'draft', ep = epicOf(s, m.epic)   // a milestone: a roadmap draft takes epics; an approved one takes the tasks of the epic it names (ADR 0015)
  if (ms && !road && m.core === true && m.epic === undefined) {   // a shared need found while running: a core-patch epic, approved now (recorded), planned and landed like any epic; the running epics then take it (ADR 0015 wave 2)
    const c = await store.createDraft({ title: e.subject, description: e.description, type: 'epic', parent: s.epic, meta: { ...f.meta, 'cadre.size': '1' } })
    await store.approve([c.id]); await mirror(h, store, reg); await DRIVE.decided?.(h, 'plan', `core patch epic ${c.id} added to milestone ${s.plan.id}: ${e.subject}`)
    return withCtx({ task: { id: c.id, subject: e.subject } }, `${c.id} is a core-patch epic of the milestone: plan it when the next: line names it; the running epics take it when it lands`)
  }
  if (ms && !road && s.drive.planner === 'agent' && m.epic !== undefined) return { deny: modelText('deny', `epic ${m.epic}'s tasks are planned for you when it is ready; nothing to do for it`) }   // milestone.epicPlanner agent (ADR 0021)
  if (ms && !road && !['ready', 'planning'].includes(ep?.state ?? '')) return { deny: modelText('deny', `name the epic these tasks plan in metadata.epic; ready to plan: ${(s.plan.epics ?? []).filter(x => x.state === 'ready' || x.state === 'planning').map(x => x.id).join(', ') || 'none (wait for the next: line)'}`) }
  if (!ms && m.epic !== undefined) return { deny: modelText('deny', 'metadata.epic: only in a milestone; omit it') }
  const twin = await twinOf(store, ep?.id ?? s.epic, e.subject, e.description, f.meta['cadre.paths']); if (twin) return { deny: modelText('deny', `${twin.id} already covers this (${twin.why}): TaskUpdate ${twin.id} instead of adding a second task`) }
  const t = await store.createDraft({ title: e.subject, description: e.description, acceptance: f.patch.acceptance, design: f.patch.design, type: road ? 'epic' : m.type ?? 'feature', parent: ep?.id ?? s.epic, meta: f.meta })
  return withCtx({ task: { id: t.id, subject: e.subject } }, ep?.state === 'ready' ? planRules(reg) : '', missingLine(await retouch(h, store, reg)))
}

// a second task of the same plan with the subject or the declared files of an open one: two agents would write the same change and conflict at merge (live: a lite plan's task drafted again)
const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' '), filesOf = (v?: string) => { try { return JSON.parse(v || '[]').map(String).sort().join('\n') } catch { return '' } }
export async function twinOf(store: TaskStore, parent: string, subject: string, desc: string, paths?: string): Promise<{ id: string; why: string } | null> {   // same files alone may be two steps on one file (the overlap check asks for their order)
  const open = (await store.list({ parent })).filter(t => t.type !== 'gate' && t.category !== 'done' && t.category !== 'cancelled'), p = filesOf(paths)
  const t = open.find(x => norm(x.title) === norm(subject)) ?? (p ? open.find(x => filesOf(x.meta['cadre.paths']) === p && norm(x.description) === norm(desc)) : undefined)
  return t ? { id: t.id, why: norm(t.title) === norm(subject) ? 'the same subject' : 'the same files and description' } : null
}
async function update(h: Host, store: TaskStore, reg: TypeRegistry, e: any) {
  const id = e.taskId, m = e.metadata ?? {}
  const out = (success: boolean, updated: string[] = [], error?: string, ctx: string[] = []) => withCtx({ success, taskId: String(id), updatedFields: updated, ...(error ? { error } : {}) }, ...ctx)
  const no = async (why: string) => out(false, [], await refuse(h, String(id), why))
  if (!str(id)) return out(false, [], 'taskId: expected a task id string')
  if (await capped(h, id)) return out(false, [], await refuse(h, id, 'update refused'))
  let t: Task; try { t = await store.get(id) } catch (x) { return out(false, [], x instanceof StoreError && x.code === 'NotFound' ? `no task ${id}` : fail(x)) }
  if (e.owner !== undefined) return out(false, [], 'owner is set when the task\'s agent is spawned')
  if (e.status === 'in_progress') return out(false, [], 'in_progress is set when the task\'s agent is spawned')
  if (typeof m !== 'object' || !m || Array.isArray(m)) return out(false, [], 'metadata: expected an object')
  if (Object.keys(m).some(k => k.startsWith('cadre'))) return out(false, [], 'metadata.cadre*: reserved; omit it')
  const s = await h.board.read()
  if (m.planned !== undefined) { const why = m.planned === true ? await planEpic(h, store, reg, id) : 'metadata.planned: true, on an epic whose tasks are all drafted'; return why ? no(why) : out(true, ['metadata.planned'], undefined, [`${id} is approved; next: ${nextAction(modelView(await h.board.read()))}`]) }   // the epic's plan: approved automatically (core/milestone)
  if (m.critique !== undefined && !Object.values(((await h.ui.read()).asks ?? {}) as Record<string, { answer?: string }>).some(a => a.answer !== undefined)) return no('metadata.critique: spawn the critic Agent first and use its answer')
  const isEpic = id === s.epic, draft = t.category === 'draft' && !(isEpic && s.plan && s.plan.state !== 'draft')   // approval leaves the epic bead itself draft: its board state is the truth
  const life = e.status === 'completed' || e.status === 'pending' || e.status === 'deleted' ? e.status : m.decision !== undefined ? 'decision' : null
  if (life) {   // lifecycle
    if (draft && life === 'deleted' && !isEpic) {
      await store.dropDrafts([id]); await retouch(h, store, reg)
      return out(true, ['status'], undefined, [missingLine((await h.board.read()).approval.missing)])
    }
    if (draft) return out(false, [], `${life} does not apply to a draft: the human approves it in the dialog`)
    const why = await LIFECYCLE[life]!(h, id, e)
    const b = await h.board.read(), card = !why && life === 'completed' ? b.tasks.find(x => x.id === id)?.card ?? (b.plan?.landed ? `${b.plan.id} landed on dev: nothing is left to do; tell the user` : undefined) : undefined   // the close card: main sees that the squash landed (the last epic of a milestone lands the milestone too, live)
    return out(!why, why ? [] : [life === 'decision' ? 'metadata.decision' : 'status'], why ?? undefined, card ? [card] : undefined)
  }
  const { kind: _k, amend, ...plan } = m
  const err = validateFields(m, reg) ?? (m.kind !== undefined ? 'metadata.kind: set at creation only' : m.type !== undefined && m.type !== t.type ? `metadata.type: fixed at creation (${t.type}); delete the draft and create a new one` : null)
  if (err) return no(err)
  const f = fieldsOf(plan), blockedBy = e.addBlockedBy, blocks = e.addBlocks
  if ((blockedBy !== undefined && !ids(blockedBy)) || (blocks !== undefined && !ids(blocks))) return no('addBlocks/addBlockedBy: expected an array of task ids, e.g. ["m-2"]')
  const edits = e.subject !== undefined || e.description !== undefined || f.names.length > 0 || blockedBy?.length > 0 || blocks?.length > 0
  if (!draft) {
    if (!edits && amend !== true) return out(true)
    if (amend !== true || isEpic) return out(false, [], REFUSED)
    await mirror(h, store, reg)   // the board may have lost the task (/clear)
    const r = await apply(h, { kind: 'amend', id, at: await h.now(), actor: 'main' }, pipeOf(reg))
    if (!r.ok) return out(false, [], r.error)
    await store.amend(id); await store.setMeta(id, { 'cadre.amended': '1' }, 'main')   // reject reverts an amendment, never deletes the approved task
  }
  try {
    const patch = { ...f.patch, ...(e.subject !== undefined ? { title: String(e.subject) } : {}), ...(e.description !== undefined ? { description: String(e.description) } : {}) }
    if (Object.keys(patch).length) await store.update(id, patch, 'main')
    if (Object.keys(f.meta).length) await store.setMeta(id, f.meta, 'main')
    for (const d of blockedBy ?? []) await store.link(id, { id: d, type: 'blocks' })
    for (const b of blocks ?? []) { if ((await store.get(b)).category !== 'draft') throw new StoreError('Invalid', `${b} is approved; amend it before adding a blocker`); await store.link(b, { id, type: 'blocks' }) }
  } catch (x) { await retouch(h, store, reg); return no(fail(x)) }
  await clearRetries(h, id)
  const missing = await retouch(h, store, reg)
  const names = [...(e.subject !== undefined ? ['subject'] : []), ...(e.description !== undefined ? ['description'] : []), ...f.names, ...(blockedBy?.length ? ['blockedBy'] : []), ...(blocks?.length ? ['blocks'] : []), ...(amend === true ? ['metadata.amend'] : [])]
  return out(true, names, undefined, [missingLine(missing)])
}

async function list(h: Host) {
  const v = modelView(await h.board.read()), open = (i: string) => !['done', 'cancelled'].includes(v.tasks.find(x => x.id === i)?.state ?? 'done')
  return { result: modelData('tool-result', { tasks: v.tasks.map(t => ({ id: t.id, subject: subject(t), status: NATIVE[t.state], ...(t.owner ? { owner: t.owner } : {}), blockedBy: t.deps.map(d => d.id).filter(open) })) }) }
}
async function get(h: Host, store: TaskStore, e: any) {
  if (String(e.taskId).startsWith('ask-')) { const a = await askById(h, String(e.taskId)); return { result: modelData('taskget', { task: a ? askTask(a) : null }) } }   // a marker-less explorer's answer (core/asks)
  let t: Task; try { t = await store.get(String(e.taskId)) } catch (x) { if (x instanceof StoreError && x.code === 'NotFound') return { result: modelData('taskget', { task: null }) }; throw x }
  const v = modelView(await h.board.read()), st = v.tasks.find(x => x.id === t.id), open = (i: string) => !['done', 'cancelled'].includes(v.tasks.find(x => x.id === i)?.state ?? 'done')
  return { result: modelData('taskget', { task: { id: t.id, subject: st ? subject(st) : t.title, description: taskText(t, st), status: NATIVE[t.category], blocks: v.tasks.filter(x => x.deps.some(d => d.id === t.id)).map(x => x.id), blockedBy: t.deps.filter(d => d.type !== 'discovered-from' && d.type !== 'related' && d.type !== 'parent-child').map(d => d.id).filter(open) } }) }
}

// Chained inside slot #5, after the guards: Task* tool.call answers for main. Anything else passes through.
export const answer: Hook = async (h, e, next) => {
  if (e.agentId || !['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(e.tool)) return next(e)
  let store: TaskStore, reg: TypeRegistry
  try { store = await storeOf(h); reg = await registryOf(h) } catch (x) { return { deny: modelText('deny', `task board unavailable (${fail(x)}); retry, or ask the human`) } }
  try { return e.tool === 'TaskCreate' ? await create(h, store, reg, e) : e.tool === 'TaskUpdate' ? await update(h, store, reg, e) : e.tool === 'TaskList' ? await list(h) : await get(h, store, e) } catch (x) { return { deny: modelText('deny', `${e.tool} failed (${fail(x)}); retry, or ask the human`) } }
}

// tool.describe: isDeferred:false (TP-16) and tightened descriptions (TP-15). Byte-stable: no dates, ids or counters.
export const DESC: Record<string, string> = {
  TaskCreate: 'Create a draft. Start a plan with metadata {"kind":"plan"}; later calls add tasks to it. Task fields go in metadata: type, package, scenarios, changelog, interface. The human approves the plan.',
  TaskUpdate: 'Update a draft: subject, description, metadata fields, addBlockedBy/addBlocks. Approved tasks are frozen unless metadata.amend is true. Never set owner or in_progress.',
  TaskList: 'List the current plan\'s tasks; the subject is prefixed with the task state, e.g. [review✓].',
  TaskGet: 'Get one task with its scenarios, contract, changelog entry and records.',
}
export const describe: Hook = (h, e, next) => (DESC[e.tool] ? { description: DESC[e.tool], isDeferred: false } : next(e))
