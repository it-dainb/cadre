// Command dispatcher (DESIGN 2.5, 3.1): the only entry for `/cadre` commands. Origin rules (gates: the ask dialog only, ADR 0012),
// approve/reject bound to the decision's content hash, init confirm. Also the draft<->board mirror shared with native/tasks.ts.
import type { Host, Plan, SnapTask } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { defaults as typeDefaults, kindOf, merges, pipeOf } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'
import { cfgOf } from '../config/index'
import { canon, ctlGet, ctlKeys, ctlSet, fnv1a64, stamp, storeOf, withConditions } from './board'
import { emit } from './events'
import { ask, plural, settle, settleIf } from './decide'
import { scoped } from '../commands/init'
import { apply, epicNext } from './machine'
import { missingList, openQuestions } from './validate'
import { cutEpic } from './branches'
import { laneLine, laneOption, queueBrief } from './lanes'
import { isMs, roadmap } from './milestone'
import * as G from './git'

export type Origin = { kind: string; name?: string }   // dialog (a decision's answer) | press (a Settings toggle, not a decision) · composer (typed start commands only) | sdk | bridge | plugin | adapter
export interface Command { schemaVersion: 1; cmd: string; args: string[]; origin: Origin }
export type Out = { text: string }
export type Route = (h: Host, c: Command) => Promise<Out>
// Owner modules fill this at load for subs this file doesn't implement: resolve, release, drive, sync (loop), config (config/), ...
export const ROUTES: Record<string, Route> = {}

// store + config arrive through two optional Host members that register.ts wires (CONTRACTS)
export { ctlGet, ctlKeys, ctlSet, storeOf }   // they live in core/board (no import cycle); callers keep importing them here
export { cfgOf }   // the one config read path lives in config/index (ADR 0019)
export const registryOf = async (h: Host): Promise<TypeRegistry> => ((await cfgOf(h)).types as TypeRegistry) ?? typeDefaults()

// the recorded mission (stage 3 / approve of a mission draft): the newest open milestone. A new session's board is cold, the store is the truth.
export async function missionOf(store: TaskStore): Promise<string | null> {
  const ms = (await store.list({})).filter(t => t.type === 'milestone' && t.category !== 'done' && t.category !== 'cancelled').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return ms[0]?.title ?? null
}

// ---- draft <-> board mirror ----
const BLOCKING = ['blocks', 'waits-for', 'conditional-blocks']
export const snapOf = (t: Task, reg: TypeRegistry): SnapTask => {
  const spec = reg[t.type]
  return { id: t.id, title: t.title, type: t.type, kind: spec ? kindOf(spec) : 'code', merges: spec ? merges(spec) : true, state: t.category, ...(t.meta['cadre.lane'] ? { lane: t.meta['cadre.lane'] } : {}), step: t.meta['cadre.step'] ?? '', phaseSince: 0, owner: t.assignee,
    deps: t.deps.filter(d => BLOCKING.includes(d.type)).map(d => ({ id: d.id, type: d.type as SnapTask['deps'][0]['type'] })), flags: [] }
}
// store children of the current epic -> board tasks. Existing board tasks keep their machine state (step, owner, flags, card); title/type/deps follow the store.
export async function mirror(h: Host, store: TaskStore, reg: TypeRegistry): Promise<void> {
  const b0 = await h.board.read(), epic = b0.epic; if (!epic) return
  const cfg = isMs(b0.plan) ? await cfgOf(h) : null, r = cfg && (await roadmap(store, epic, cfg.milestone.maxEpics, cfg.branches.epicPrefix))   // a milestone: the tasks of its epics, and the roadmap (ADR 0015)
  const all = r ? r.tasks : (await store.list({ parent: epic })).filter(t => t.type !== 'gate'), sn = (t: Task) => ({ ...snapOf(t, reg), ...(r ? { epic: t.parent } : {}) })
  await h.board.update(s => withConditions({ ...s, ...(r && s.plan ? { plan: { ...s.plan, epics: r.epics } } : {}), tasks: all.map(t => { const o = s.tasks.find(x => x.id === t.id); return o ? { ...o, ...sn(t), state: o.state, step: o.step, phaseSince: o.phaseSince, owner: o.owner, flags: o.flags, card: o.card } : sn(t) }) }))
}

// ---- approval: bound to the decision's content hash ----
export const draftsOf = async (store: TaskStore, epic: string | null): Promise<Task[]> =>
  epic ? (await store.list({ parent: epic })).filter(t => t.category === 'draft' && t.type !== 'gate') : []
const pick = (t: Task) => ({ id: t.id, title: t.title, description: t.description, acceptance: t.acceptance, design: t.design, type: t.type, deps: t.deps, meta: t.meta })
export const planHash = (drafts: Task[], m?: Task | null, lane?: string | null): string => fnv1a64(canon(drafts.map(pick)) + (m ? m.title + m.description : '') + (lane ?? ''))
const gateHash = (g: Task): string => fnv1a64(g.title + (g.description ?? ''))
const missionOf_ = (store: TaskStore, s: { plan: { id: string; slug: string } | null }) => (s.plan?.slug === 'mission' ? store.get(s.plan.id).catch(() => null) : Promise.resolve(null))
// a mission drafted with the plan (ADR 0014: a goal in a repo set up on the way): shown and hashed with it, recorded at its approval
const withMission = async (store: TaskStore, s: { plan: { id: string; slug: string } | null }): Promise<string> => (s.plan && s.plan.slug !== 'mission' ? ((await store.get(s.plan.id).catch(() => null))?.meta['cadre.mission'] ?? '') : '')
// yolo clarify (ADR 0020): what Claude assumed instead of asking, shown and hashed with the plan
const assumedOf = async (store: TaskStore, s: { plan: { id: string; slug: string } | null }): Promise<string[]> => { if (!s.plan || s.plan.slug === 'mission') return []; try { const v = JSON.parse((await store.get(s.plan.id)).meta['cadre.assumed'] || '[]'); return Array.isArray(v) ? v.slice(0, 3).map(a => `assumed: ${a}`.slice(0, 160)) : [] } catch { return [] } }
// the plan's own title and description in the card's hash (its tasks are in it already): an edit of the plan after the card was drawn re-asks
const planText = async (store: TaskStore, s: { plan: { id: string; slug: string } | null }): Promise<string> => { const p = s.plan && s.plan.slug !== 'mission' ? await store.get(s.plan.id).catch(() => null) : null; return p ? `\n${p.title}\n${p.description ?? ''}` : '' }
const goalOf = (mission: string) => (mission.split('\n')[0] ?? '').replace(/^goal:\s*/i, '')

// re-ask over the current drafts (every draft change AND every refused approve); board.approval gets the missing list. Returns it.
// what approval still needs; a roadmap complete otherwise needs its critic's review (ADR 0015)
const planMissing = async (store: TaskStore, s: { plan: Plan | null }, drafts: Task[], reg: TypeRegistry): Promise<string[]> => {
  const m = !s.plan || s.plan.slug === 'mission' ? [] : missingList(drafts, reg), q = s.plan ? openQuestions(await store.get(s.plan.id).catch(() => undefined)) : []   // main's ask tool (core/plantools)
  return [...q, ...(!m.length && isMs(s.plan) && !(await store.get(s.plan!.id)).meta['cadre.critique'] ? ['critic review (the roadmap rules say how)'] : m)]
}
export async function redraw(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> {
  const s = await h.board.read()
  if (isMs(s.plan) && s.plan!.state !== 'draft') {   // an approved milestone: its epics' plans are approved automatically (core/milestone.planEpic), never in a dialog
    const missing = (await Promise.all((s.plan!.epics ?? []).filter(e => e.state === 'planning').map(async e => missingList(await draftsOf(store, e.id), reg).map(x => `${e.id} plan: ${x}`)))).flat()
    await h.board.update(b => ({ ...b, approval: { planId: null, missing } })); return missing
  }
  const drafts = await draftsOf(store, s.epic), missing = await planMissing(store, s, drafts, reg)
  const planId = s.plan?.id ?? null
  await h.board.update(b => ({ ...b, approval: { planId, missing } }))
  if (!planId || missing.length || (await drafting(h))) await settleIf(h, 'plan:')   // nothing to approve yet, or main is still drafting: its turn end draws the card (mainTurn)
  else {
    const sc = (t: Task) => (t.acceptance ?? '').split('\n').filter(Boolean).length, m = await missionOf_(store, s), ll = laneLine(s.plan, drafts, reg), lo0 = laneOption(s.plan, drafts, reg, (await cfgOf(h)).lanes), lo = lo0 && { ...lo0, key: `l-${lo0.label.split(' ').pop()}` }   // a mission card shows the mission itself
    const mis = await withMission(store, s), as = await assumedOf(store, s), all = drafts.reduce((n, t) => n + sc(t), 0), k = Math.max(1, (drafts.length > 5 ? 4 : 5) - (mis ? 1 : 0) - as.length)   // body <= 6 lines, each fact once (BRAND P2): the count on the lane line, scenarios per task, none when 0
    await ask(h, { id: `plan:${planId}`, kind: 'plan', title: m ? `approve the mission · ${m.title}` : mis ? `approve the mission and plan ${planId}` : `approve ${isMs(s.plan) ? 'milestone' : 'plan'} ${planId}`, short: m ? 'approve the mission' : mis ? `approve mission + ${planId}` : `approve ${planId}`, tab: m ? 'epic' : 'plan', hash: planHash(drafts, m, (ll ?? '') + mis + as.join('\n') + (await planText(store, s))), change: `Change ${planId}: `,
      lines: m ? (m.description || m.title).split('\n').filter(Boolean).slice(0, 6) : [...(mis ? [`mission: ${goalOf(mis)}`] : []), ll ?? [plural(drafts.length, 'task'), ...(all ? [plural(all, 'scenario')] : [])].join(' · '), ...as, ...drafts.slice(0, k).map(t => t.type === 'epic' ? `  ${t.id}${t.meta['cadre.core'] === 'true' ? ' core' : ''} ${t.title} · ${plural(Number(t.meta['cadre.size']) || 0, 'task')}${t.deps.length ? ` · after ${t.deps.map(d => d.id).join(' ')}` : ''}` : `  ${t.id} ${t.type} ${t.title}${sc(t) ? ` · ${plural(sc(t), 'scenario')}` : ''}`), ...(drafts.length > k ? [`  +${drafts.length - k} more on the Board`] : [])],
      options: [{ key: 'a', label: 'Approve', verb: 'approve', run: `approve ${planId}` }, { key: 'x', label: 'Reject', verb: 'reject', run: `reject ${planId} rejected in the dialog` }, ...(lo ? [lo] : [])] })
  }
  return missing
}
// the approval sheet data ui/ draws (UI-DESIGN 5.3), on the human view as `board.sheet`; `before` = the prior accepted contract of a changed symbol (closed tasks' design), else absent
const sig = (s: any) => `${s.name}(${(s.params ?? []).join(', ')}) -> ${s.returns}`
async function sheetOf(store: TaskStore, drafts: Task[], reg: TypeRegistry) {
  const rows = drafts.filter(t => t.type !== 'epic').map(t => ({ t, d: t.design ? JSON.parse(t.design) : null })), prior = new Map<string, string>()
  if (rows.some(r => r.d?.symbols?.some((x: any) => x.status === 'changed'))) for (const c of await store.list({})) if (c.category === 'done' && c.design) for (const x of JSON.parse(c.design).symbols ?? []) prior.set(x.name, sig(x))
  return rows.map(({ t, d }) => {
    const cl = t.meta['cadre.changelog'] ? JSON.parse(t.meta['cadre.changelog']) : null
    return { id: t.id, title: t.title, type: t.type, scope: t.meta['cadre.scope'] || undefined, package: t.meta['cadre.package'] || undefined, tdd: pipeOf(reg)(t.type, t.meta['cadre.lane']).includes('red') ? 'required' : 'off',
      changelog: cl && (cl.none ? `none (${cl.reason})` : `${cl.category}: ${cl.entry}`), breaking: t.meta['cadre.breaking'] === 'true' || undefined, scenarios: (t.acceptance ?? '').split('\n').filter(Boolean),
      contract: (d?.symbols ?? []).map((x: any) => ({ sig: sig(x), status: x.status, ...(x.status === 'changed' && prior.has(x.name) ? { before: prior.get(x.name) } : {}) })) }
  })
}
// after any draft change: mirror the board, redraw the code, refresh the sheet, announce, stamp seq. Returns the missing list.
export async function touched(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> {
  await mirror(h, store, reg)
  const missing = await redraw(h, store, reg), sheet = await sheetOf(store, await draftsOf(store, (await h.board.read()).epic), reg)
  await h.board.update(b => ({ ...b, sheet }) as typeof b)
  const s = await h.board.read()
  if (s.plan && !(await drafting(h))) await stamp(h, (await emit(h, 'approval.pending', { planId: s.plan.id, missing })).seq)
  return missing
}
// main's turn (turn.start .. turn.complete, an abort included). While it runs, every plan tool call changes the plan, so a card offered then is answered
// against a moving draft (live 0.13.0: 3 refused presses and 3 approvals for one plan, an approval landing between main's calls). The card is drawn once, at its end.
export const drafting = async (h: Host): Promise<boolean> => !!(await h.ui.read()).mainTurn
export async function mainTurn(h: Host, on: boolean): Promise<void> {
  await h.ui.update(u => ({ ...u, mainTurn: on || undefined }))
  const s = await h.board.read()
  if (!on && s.approval.planId && !s.approval.missing.length && !(s.decisions ?? []).some(d => d.id === `plan:${s.approval.planId}`)) await touched(h, await storeOf(h), await registryOf(h))
}

// ---- origin ----
// null = human; else the refusal reason. A decision is answered in the ask dialog (ADR 0012); a press is a Settings toggle (not a decision). No typed, sdk, adapter or model origin decides.
export const isHuman = (o: Origin): string | null => (o.kind === 'press' || o.kind === 'dialog' ? null : `origin ${o.kind} cannot decide: the human answers in the dialog (press 1)`)
// agent-run setup/init (commands/agentrun fills these at load; core never imports commands/agentrun: a load cycle)
export const RUN: { recheck?(h: Host): Promise<string>; cancel?(h: Host, kind: string): Promise<void> } = {}
// drive (core/drive fills these at load; a static import would be a load cycle): arm at approval, hand main the next step after a dialog answer
export const DRIVE: { wanted?(h: Host): Promise<number>; sync?(h: Host): Promise<void>; arm?(h: Host, mode: 'auto' | 'yolo'): Promise<string>; kick?(h: Host): Promise<void>; humanWrite?<T>(h: Host, fn: () => Promise<T>): Promise<T>; decided?(h: Host, kind: 'plan', text: string): Promise<void>; forget?(h: Host, epicId: string): Promise<void> } = {}
// gates = everything that decides or changes state for the human; only `init`/`setup` with no subcommand (start the run) may also be typed
const gated = (c: Command): boolean => ['approve', 'reject', 'resolve', 'release', 'restore', 'deps'].includes(c.cmd) || (c.cmd === 'revert' && !(c.origin.kind === 'composer' && !c.args[1])) || (['init', 'setup'].includes(c.cmd) && !!c.args[0]) || (c.cmd === 'config' && c.args[0] === 'set') || (c.cmd === 'sync' && c.args[0] === 'add') || (c.cmd === 'drive' && c.args[0] !== 'status')

// ---- init confirm (DESIGN 10.1): the decision is bound to the diff's content hash; a confirm is the dialog's answer to it ----
// `d` (optional) is what the human sees: sub = the command the options run (`init`, `setup`, `sync add <name>`); `change` = the re-plan command (none: no Cancel/Change, e.g. sync add)
export async function initPropose(h: Host, stage: number, diff: string, d?: { title: string; short?: string; lines: string[]; sub: string; change?: string; confirm?: string; keep?: string }): Promise<void> {   // confirm: another command than `<sub> confirm`; keep: a "Keep it" answer
  if (d) await ask(h, { id: `init:${stage}`, kind: 'init', title: d.title, short: d.short, lines: d.lines, hash: fnv1a64(diff), tab: 'epic',
    options: [{ key: 'a', label: 'Confirm', verb: 'approve', run: d.confirm ?? `${d.sub} confirm` }, ...(d.keep ? [{ key: 'k', label: 'Keep it', verb: 'reject', run: d.keep }] : []), ...(d.change ? [{ key: 'x', label: 'Cancel', verb: 'reject', run: `${d.sub} cancel` }, { key: 'c', label: 'Change', verb: 'change', run: d.change }] : [])] })
}
// true when the card for `stage` was still pending (the caller then re-reads the files and must find what the card showed); either way it is settled
export async function initConfirm(h: Host, stage: number): Promise<boolean> {
  const ok = ((await h.board.read()).decisions ?? []).some(d => d.id === `init:${stage}`)
  await settle(h, `init:${stage}`); return ok
}

// ---- approve / reject ----
const refuse = (why: string): Out => ({ text: `refused: ${why}` })
// human gates (3.3): an open `gate` child of the epic is approved like a plan: bound to its content hash
export const gateOf = async (store: TaskStore, id: string): Promise<Task | null> => { const g = await store.get(id).catch(() => null); return g && g.type === 'gate' && !['done', 'cancelled'].includes(g.category) ? g : null }
export async function gateDraw(h: Host, g: Task): Promise<void> {
  await h.board.update(b => ({ ...b, approval: { planId: g.id, missing: [] } }))
  await ask(h, { id: `gate:${g.id}`, kind: 'gate', title: `approve gate ${g.id} · ${g.title}`, short: `approve gate ${g.id}`, tab: 'epic', sel: g.id, hash: gateHash(g), change: `Change ${g.id}: `,
    lines: [...(g.description ?? '').split('\n').filter(Boolean).slice(0, 4), 'a human gate: the work after it waits for you'],
    options: [{ key: 'a', label: 'Approve', verb: 'approve', run: `approve ${g.id}` }] })
}
async function approveGate(h: Host, store: TaskStore, reg: TypeRegistry, g: Task): Promise<Out> {
  if (((await h.board.read()).decisions ?? []).find(d => d.id === `gate:${g.id}`)?.hash !== gateHash(g)) { await gateDraw(h, g); return refuse('it changed; review again') }
  await store.resolveGate(g.id, 'approved by the human')
  await h.board.update(b => ({ ...b, approval: { planId: null, missing: [] } }))
  await settle(h, `gate:${g.id}`); await mirror(h, store, reg); return { text: `Gate ${g.id} approved.` }
}
async function approve(h: Host, c: Command): Promise<Out> {
  const planId = c.args[0] ?? '', store = await storeOf(h), reg = await registryOf(h)
  const gate = (await h.board.read()).plan?.id === planId ? null : await gateOf(store, planId); if (gate) return approveGate(h, store, reg, gate)
  const s = await h.board.read(), drafts = await draftsOf(store, s.epic)
  const mission = s.plan?.slug === 'mission', missing = !s.plan || s.plan.id !== planId ? [] : await planMissing(store, s, drafts, reg)   // incomplete is reported before a changed card (an incomplete plan has no card)
  const mis = await withMission(store, s), why = !s.plan || s.plan.id !== planId ? `no draft plan ${planId}` : !missing.length && (s.decisions ?? []).find(d => d.id === `plan:${planId}`)?.hash !== planHash(drafts, await missionOf_(store, s), (laneLine(s.plan, drafts, reg) ?? '') + mis + (await assumedOf(store, s)).join('\n') + (await planText(store, s))) ? 'it changed; review again' : ''
  if (why || missing.length) { await redraw(h, store, reg); return refuse(why || `incomplete, missing: ${missing.join('; ')}`) }   // a refusal redraws the card
  const plan = s.plan!, epic = await store.get(plan.id), at = await h.now()
  if (mission) {
    await store.record('mission', epic.title, epic.description); await store.dropDrafts([plan.id])
    await h.board.update(b => ({ ...b, mission: epic.title, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
    await settleIf(h, 'plan:')
    const more = await (RUN.recheck?.(h) ?? Promise.resolve('')).then(t => t && ` · ${t}`)   // an init run: re-check now (done, or a follow-up for main)
    return { text: `Mission "${epic.title}" approved and recorded${more || '.'}` }
  }
  const ids = drafts.map(t => t.id), first = !plan.approvedAt
  if (mis && first) { await store.record('mission', goalOf(mis), mis); await store.setMeta(plan.id, { 'cadre.mission': '' }, 'human'); await h.board.update(b => ({ ...b, mission: goalOf(mis) })) }   // the mission approved with its first plan
  await store.approve(ids)
  for (const t of drafts) if (t.meta['cadre.amended']) await store.setMeta(t.id, { 'cadre.amended': '' }, 'human')
  await mirror(h, store, reg)   // tasks the board lost (after /clear) come back as drafts; the machine then approves them
  const pipe = pipeOf(reg)
  for (const id of ids) await apply(h, { kind: 'approve', id, at, actor: 'human' }, pipe)
  await store.record('decision', `Approved plan ${plan.id}: ${epic.title}`, drafts.map(t => `- ${t.id} ${t.title} (${t.type})`).join('\n'), plan.id)
  await h.board.update(b => ({ ...b, plan: b.plan && { ...b.plan, state: 'approved', approvedAt: b.plan.approvedAt ?? at }, approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
  await settleIf(h, 'plan:')
  let note = ''
  if (first) try { await cutEpic(h, plan.id, (await cfgOf(h)).branches.dev); note = `; epic branch ${plan.epicBranch} cut` } catch (e) { note = `; epic branch cut failed: ${(e as Error).message}` }
  const dr = first ? await DRIVE.arm?.(h, plan.mode ?? 'auto').catch((e: Error) => `drive not armed: ${e.message}`) : undefined
  const self = (await h.board.read()).drive.spawn === 'mod', runs = 'Its tasks start, get reviewed and land by themselves; you hear one line as each lands.'   // mod mode (ADR 0018): main's turn ends at once and the spawner starts the tasks
  const byAgent = (await h.board.read()).drive.planner === 'agent'   // milestone.epicPlanner agent (ADR 0021): main plans no epic
  await queueBrief(h, isMs(plan) && byAgent ? `Milestone ${plan.id} is approved. Each epic's tasks are planned, started, reviewed and land by themselves; you hear one line as each lands. Nothing to do now: tell the user it is running and stop.`
    : isMs(plan) ? `Milestone ${plan.id} is approved. Plan each epic when the next: line names it (task calls with epic, then epic {id, planned:true})${self ? `. ${runs}` : ', spawn ready tasks one by one, follow the cards, and complete each epic when its tasks are done.'}`
    : self ? `Plan ${plan.id} is approved. ${runs} Nothing to do now: tell the user it is running and stop.` : `Plan ${plan.id} is approved: spawn its ready tasks one by one (each by its id), follow the cards until every task is done, then complete the plan (status {id:"${plan.id}", set:"completed"}).`)   // drive's first push; drive continues at each turn end (ADR 0013)
  return { text: `${isMs(plan) ? 'Milestone' : 'Plan'} ${plan.id} approved: ${plural(ids.length, isMs(plan) ? 'epic' : 'task')} ready${note}${dr ? ` · ${dr}` : ''}.` }
}
async function reject(h: Host, c: Command): Promise<Out> {
  const [planId, ...why] = c.args, store = await storeOf(h), reg = await registryOf(h), s = await h.board.read()
  if (!s.plan || s.plan.id !== planId) return refuse(`no draft plan ${planId}`)
  const all = await draftsOf(store, s.epic), fresh = s.plan.state === 'draft', back = fresh ? [] : all.filter(t => t.meta['cadre.amended']), drafts = all.filter(t => !back.includes(t))
  await store.dropDrafts([...drafts.map(t => t.id), ...(fresh ? [s.plan.id] : [])])
  if (back.length) { await store.approve(back.map(t => t.id)); for (const t of back) await store.setMeta(t.id, { 'cadre.amended': '' }, 'human') }   // an amended approved task keeps its place: the amendment is dropped, never the task (3.1)
  await store.record('decision', `Rejected plan ${planId}`, why.join(' ') || 'no reason given', fresh ? undefined : planId)
  if (fresh) await h.board.update(b => ({ ...b, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
  else { await mirror(h, store, reg); for (const t of back) await apply(h, { kind: 'approve', id: t.id, at: await h.now(), actor: 'human' }, pipeOf(reg)); await h.board.update(b => ({ ...b, sheet: [] }) as typeof b) }
  await settleIf(h, 'plan:')
  return { text: `Plan ${planId}: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} dropped${back.length ? `, ${back.length} amendment${back.length === 1 ? '' : 's'} reverted` : ''}.` }
}

// /cadre resolve <epic> recut|cancel (lost-epic, 3.2): the epic branch is gone; recut it from dev, or end the epic
export async function resolveEpic(h: Host, a: string, b: string): Promise<Out> {
  const s = await h.board.read(), p = s.plan
  if (!p || a !== p.id || p.state !== 'blocked' || !['recut', 'cancel'].includes(b)) return refuse(`usage: /cadre resolve <epic> recut|cancel (only for a blocked epic)`)
  const store = await storeOf(h), reg = await registryOf(h)
  if (b === 'recut') {
    await cutEpic(h, p.id, (await cfgOf(h)).branches.dev)
    await h.board.update(x => (x.plan ? { ...x, plan: { ...x.plan, state: epicNext(x.plan.state, 'recut') ?? x.plan.state, flags: (x.plan.flags ?? []).filter(f => f !== 'lost-epic') } } : x))
    await emit(h, 'flag.resolved', { taskId: p.id, flag: 'lost-epic' }, { taskId: p.id }); return { text: `Epic ${p.id}: ${p.epicBranch} re-cut from dev.` }
  }
  for (const t of s.tasks.filter(x => !['done', 'cancelled'].includes(x.state))) { await apply(h, { kind: 'cancel', id: t.id, at: await h.now(), actor: 'human' }, pipeOf(reg)); await store.close(t.id, { outcome: 'cancelled', note: 'epic cancelled' }).catch(() => {}) }
  await store.close(p.id, { outcome: 'cancelled', note: 'epic cancelled' }).catch(() => {})
  await h.board.update(x => ({ ...x, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof x); return { text: `Epic ${p.id} cancelled.` }
}

// /cadre restore [<name>] (13.7): re-apply a quarantined stash (kept in the stash list, never dropped)
export async function restore(h: Host, name?: string): Promise<Out> {
  const q = ((await h.store.get(await scoped(h, 'quarantine'))) as { name: string; tree: string; paths: string[] }[] | undefined) ?? [], e = name ? q.find(x => x.name === name) : q[q.length - 1]
  if (!e) return refuse(`no quarantined entry${name ? ` ${name}` : ''}${q.length ? `; known: ${q.map(x => x.name).join(', ')}` : ''}`)
  const ref = (await h.run(['git', '-C', e.tree, 'stash', 'list', '--format=%gd %s'])).stdout.split('\n').find(l => l.endsWith(e.name))?.split(' ')[0]
  if (!ref) return refuse(`${e.name}: the stash is gone`)
  const r = await G.op(h, () => h.run(['git', '-C', e.tree, 'stash', 'apply', ref]))
  return r.exitCode ? refuse(`${e.name}: ${r.stderr.trim().slice(0, 200)}`) : { text: `Restored ${e.paths.length} path(s) of ${e.name} into ${e.tree} (the stash is kept).` }
}

// route = the handler for everything else (commands/cadre.ts); a gate command from any origin but the ask dialog (or a Settings press) is refused before it (ADR 0012)
export async function dispatch(h: Host, c: Command, route: Route): Promise<Out> {
  if (c.schemaVersion !== 1) return refuse('unsupported command schemaVersion')
  const why = gated(c) ? isHuman(c.origin) : ['init', 'setup'].includes(c.cmd) && !['composer', 'press', 'dialog'].includes(c.origin.kind) ? `origin ${c.origin.kind} cannot start ${c.cmd}` : null
  if (why) return refuse(why)
  if ((c.cmd === 'init' || c.cmd === 'setup') && c.args[0] === 'cancel') { await settleIf(h, 'init:'); await RUN.cancel?.(h, c.cmd); return { text: `${c.cmd}: cancelled` } }   // the decision's Cancel: ends the run and its lease
  if (c.cmd === 'approve') return approve(h, c)
  if (c.cmd === 'reject') return reject(h, c)
  return route(h, c)
}

// The dialog's answer to decision `id`, option `key`, asked with `hash` (+ the values typed for its fields). The decision changing while the dialog was open refuses it (the dialog
// re-asks); otherwise the option's command runs as origin dialog. commands/cadre passes its router.
export async function answer(h: Host, id: string, key: string, hash: string, route: Route, vals: Record<string, string> = {}): Promise<Out> {
  const d = ((await h.board.read()).decisions ?? []).find(x => x.id === id), o = d?.options.find(x => x.key === key)?.run
  if (!d && id.startsWith('plan:') && (await drafting(h))) return refuse('Claude is still changing the plan; it comes back when Claude is done')   // the dialog does not re-ask it
  if (!d || d.hash !== hash || !o) return refuse('it changed; review again')   // nothing runs
  const [cmd, ...args] = o.split(/\s+/).filter(Boolean).flatMap(a => (a === '{fields}' ? (d.fields ?? []).map(f => `${f.key}=${vals[f.key] ?? f.value ?? ''}`) : [a]))   // fields as k=v argv elements
  await h.ui.update(u => ({ ...u, answering: id }))   // while its command runs (an approval: seconds of store calls) no surface offers "press 1" on it again (ui/model.attention)
  try { const out = await dispatch(h, { schemaVersion: 1, cmd, args, origin: { kind: 'dialog' } }, route); await emit(h, 'decision.answered', { choice: key, id }); await DRIVE.kick?.(h).catch(e => h.log(`drive: ${e}`)); return out } catch (x) { return { text: `cadre: ${(x as Error).message}` } } finally { await h.ui.update(u => ({ ...u, answering: undefined })) }
}
