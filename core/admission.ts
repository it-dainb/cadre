// agent.spawn admission (DESIGN 3.4, 4.6, 8.4): claim, next step / rebind, review spawn, marker-less retype, lease staleness, recovery.
// Judge before next; on spawn rejection release and rethrow (AG-12). `admit` is the slot; `admitWith` is the same flow over explicit Deps (tests).
import { modelText } from './say'
import type { Binding, Hook, Host, Role, Snapshot, SnapTask } from '../types'
import type { Config } from '../config/defaults'
import { forcedOf } from '../config/index'
import { StoreError, type Task, type TaskStore } from '../task-management/store'
import { kindOf, pipeOf, type TypeRegistry } from '../task-management/registry'
import { repoKeyOf } from '../commands/init'
import { cfgOf, storeOf } from './dispatch'
import { agentsOf, commit, leaseLive, safe, sessionOf } from './board'
import { FOCUS, parseNumstat, riskOf, route, type Tier } from './risk'
import { held, ownerOf, savePointer, stampAlive } from './session'
import { BLOCKING, apply, epicNext } from './machine'
import { emit } from './events'
import { flagName } from './render'
import { brief, idsIn, type BriefIn } from './briefs'
import { asked } from './asks'
import { taskBranch, wtPath, wtRootOf } from './branches'
import * as G from './git'
import { checkpoint } from './effect'
import { warm } from './session'
import { buildView, pkgOf } from './specview'
import { realRoot } from '../policy/guards'
import { lockCore, watch } from './rebase'
import { notesOf, pathsOf, sliceNotes, specTestsOf, untested } from './validate'
import { branchOf, epicOf } from './milestone'
import { plannerBrief } from './planner'
import { budgetOf, intentOf, reserve, step as lifeStep, unreserve } from './lifecycle'

export interface Deps {
  store: TaskStore; cfg: Config; reg: TypeRegistry; root: string; home: string; wtRoot: string; key: string; actor: string; session: string
  view?: (h: Host, d: Deps, t: Task, wt: string) => Promise<string>   // spec view builder (core/specview, M5); absent = tester/red are skipped (3.1)
}
const ROLE: Record<string, Role> = { tester: 'tester', worker: 'worker', reviewer: 'reviewer', explorer: 'explorer' }   // red/green are mod-run, merge is main's close
const deny = (why: string) => ({ deny: modelText('deny', why) })


// Everything admission needs from the outside world, resolved per hook (never cached across hooks): store + config via the register.ts wiring.
export async function resolveDeps(h: Host): Promise<Deps> {
  const [root, home, cfg] = [await h.cwd(), await h.home(), await cfgOf(h)], store = await storeOf(h), key = repoKeyOf(root), ak = `cadre:${key}:actor`
  let actor = (await h.store.get(ak)) as string | undefined
  if (!actor) { actor = `cadre/${home.split('/').pop() || 'user'}/${h.rand(3)}`; await h.store.set(ak, actor) }
  return { store, cfg, reg: cfg.types as TypeRegistry, root, home, wtRoot: await realRoot(h, await wtRootOf(h, cfg)), key, actor, session: await sessionOf(h), view: buildView }
}
export const admit: Hook = async (h, e, next) => { await warm(h); return admitWith(h, await resolveDeps(h), e, next) }

// model x effort for a run (core/risk.route); env overrides that beat cadre (config/forcedOf) are recorded as forced (Claude Code applies them anyway)
const rounds = async (h: Host, id: string) => { const b = await budgetOf(h, id); return b.rework + b.rebase }   // escalation (core/risk.route) counts the task's review and rebase rounds
const routeOf = (d: Deps, role: Role, risk: Tier, n = 0) => (role === 'explorer' || role === 'planner' ? route(role, d.cfg.roles[role], '', 0) : route(role, d.cfg.roles[role].byRisk[risk], risk, n))
const stepsOf = (d: Deps) => (type: string, lane?: string) => { const p = pipeOf(d.reg)(type, lane); return d.view ? p : p.filter(s => s !== 'tester' && s !== 'red') }   // no view builder: tester/red skipped

export async function admitWith(h: Host, d: Deps, e: any, next: ((e: any) => any) & { origin?: { plugin: string } }): Promise<any> {
  if (e.isTeammate) return deny('agent teams are not available; use a plain Agent call')
  if (e.workflow) return deny('workflow agents are not available; use a plain Agent call')
  const s = await h.board.read(), mine = next.origin?.plugin === 'cadre', it = mine ? await intentOf(h, String(e.prompt ?? '').trim()) : undefined   // the spawner's own start names its intent
  if (mine && !it) { h.log(`spawn refused: no intent ${String(e.prompt ?? '').slice(0, 40)}`); return deny('this start has no task behind it, so it was not started') }   // never an explorer
  if (it && it.role !== 'planner' && !s.tasks.some(x => x.id === it.taskId)) return deny(`${it.taskId} is no longer on the board`)
  if (it?.role === 'planner') return epicOf(s, it.taskId) ? planner(h, d, e, next, s, it.taskId) : deny(`${it.taskId} has no plan to draft now`)   // a ready epic's planner (ADR 0021)
  if (it) e = { ...e, prompt: modelText('agent-brief', '') }   // the brief's notes are main's words only
  const ids = it ? [it.taskId] : idsIn(e.prompt ?? '', s.tasks.map(t => t.id))
  if (ids.length > 1) return deny(`one agent takes one task, but the prompt names ${ids.join(', ')}; spawn one agent per task`)
  if (ids.length && s.drive.on && !s.drive.stopped && s.drive.spawn === 'mod' && next.origin?.plugin !== 'cadre') return deny(`${ids[0]} starts by itself; do not spawn agents for the plan's tasks. An Agent without a task id (to explore or ask) is fine`)   // mod mode (ADR 0018): only the spawner's own call, never main's
  if (!ids.length) {   // marker-less: a read-only explorer; forks pass untouched
    if (e.fork) return next(e)
    const m = routeOf(d, 'explorer', 'light').model
    const r = await next({ ...e, subagentType: 'cadre:explorer', model: m, prompt: modelText('agent-brief', brief('explorer', { id: '', title: '', type: '', question: e.prompt })) })
    if (r?.agentId) await asked(h, r.agentId, e)   // tracked from the start: its stop is observed and main only sees its card (core/asks)
    return r
  }
  if (e.fork) return deny('a task agent cannot be a fork; spawn it without fork')
  const t = s.tasks.find(x => x.id === ids[0])!
  if (!d.reg[t.type]) return deny(`${t.id}: unknown type "${t.type}"`)
  if (t.state === 'todo') return claim(h, d, e, next, s, t)
  if (t.state === 'active' || t.state === 'blocked') return rebind(h, d, e, next, s, t)
  if (t.state === 'review') return review(h, d, e, next, s, t)
  return deny(`${t.id} is ${t.state}; nothing to spawn`)
}

// ---- shared tail: retype, model, cwd, next(), bind. A rejected or thrown spawn runs `undo` (release) and rethrows. ----
async function launch(h: Host, d: Deps, e: any, next: (e: any) => any, t: SnapTask, role: Role, prompt: string, cwd: string, step: string, wt: string, undo: () => Promise<void>, rt?: Tier, task?: Task) {
  const risk = rt ?? riskOf(d.cfg.review, { paths: pathsOf(task), labels: task?.labels ?? [], coreTask: task?.meta['cadre.core'] === 'true' })
  const r0 = routeOf(d, step === 'tester' ? 'tester' : role, risk, task ? await rounds(h, t.id) : 0), env = await h.env()
  const fo = forcedOf(env), forced = fo.model || fo.effort ? `${fo.model ?? ''}/${fo.effort ?? ''}` : undefined
  const run = { role, model: fo.model || r0.model, effort: fo.effort || r0.effort || 'default', risk, setting: r0.setting, ...(r0.escalated ? { escalated: true } : {}), ...(forced ? { forced } : {}) }
  let r: any
  try { r = await next({ ...e, subagentType: `cadre:${role}`, prompt: modelText('agent-brief', prompt), model: r0.model, cwd }) } catch (err) { await undo(); throw err }
  if (r?.deny) { await undo(); return r }
  if (!r?.agentId) { await unreserve(h, t.id, step); return r }
  if (typeof r.model === 'string' && r.model !== run.model) Object.assign(run, { ran: r.model })   // the id Claude Code resolved the alias to (its agent.spawn result)
  await lifeStep(h, r.agentId, { type: 'spawn.ok', mode: e.permissionMode, bind: { taskId: t.id, role, step, worktree: wt, sessionId: d.session, ctxTokens: 0, startedAt: await h.now(), ...(r0.effort ? { effort: r0.effort } : {}) } })
  await emit(h, 'agent.bound', { agentId: r.agentId, taskId: t.id, role, ...(rt ? { tier: rt } : {}), model: run.model, ...((run as any).ran ? { ran: (run as any).ran } : {}), effort: run.effort, setting: r0.setting, ...(r0.escalated ? { escalated: true } : {}), ...(forced ? { forced } : {}) }, { agentId: r.agentId, taskId: t.id, actor: 'mod' })
  if (task) await safe(h, 'runs', async () => { let a: unknown[] = []; try { a = JSON.parse((await d.store.get(t.id)).meta['cadre.runs'] || '[]') } catch {}; await d.store.setMeta(t.id, { 'cadre.runs': JSON.stringify([...a, run].slice(-20)) }, d.actor) })
  await h.store.set(`cadre:${d.key}:hb:${t.id}`, { s: d.session, at: 0 })   // the owner session (core/session.ownerOf): another session judges the claim by it; at 0: the next tick renews the claim
  await safe(h, 'pointer', () => savePointer(h))   // S22: a /clear before main's next turn.complete must still find this binding (the pointer was saved only there)
  return r
}
const viewed = (d: Deps, role: Role) => role === 'tester' && !!d.view && d.cfg.roles.testerView !== 'full' && d.cfg.roles.tdd.author !== 'same'   // testerView:full or author:same (3.5): the tester step works in the worktree
const agentOf = (d: Deps, role: Role): Role => (role === 'tester' && d.cfg.roles.tdd.author === 'same' ? 'worker' : role)   // author:same: the worker agent, tester brief (3.5)
export const protectedOf = (d: Deps): string[] => [...G.PROTECTED, ...(d.cfg.changelog.path !== 'CHANGELOG.md' ? [d.cfg.changelog.path] : [])]
// the spawn prompt as the brief's Notes: main's own words only. The spawner's prompt is the bare TASK-<id> (core/spawner), which said nothing in a "## Notes" section
const noteOf = (said: unknown, id: string): string | undefined => String(said ?? '').trim().replace(new RegExp(`^(?:TASK-)?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])[\\s:.,;-]*`), '').trim() || undefined
const briefOf = (s: Snapshot, t: SnapTask, task: Task, e: any, d: Deps, role: Role, extra: Partial<BriefIn> = {}): BriefIn => ({
  paths: pathsOf(task), testPaths: role === 'tester' ? pkgOf(d, task)?.tdd?.paths : undefined, runAsk: role === 'tester' && d.cfg.tdd.testerCommand.use, locked: task.meta['cadre.locked'] ? JSON.parse(task.meta['cadre.locked']) : undefined, redCard: task.meta['cadre.red'],
  id: t.id, title: t.title, type: t.type, description: task.description, scenarios: task.acceptance, contract: task.design, notes: noteOf(e.prompt, t.id), protectedPaths: protectedOf(d),
  deps: t.deps.filter(x => x.type !== 'conditional-blocks').map(x => ({ id: x.id, title: s.tasks.find(y => y.id === x.id)?.title ?? '' })), ...extra })

// what the plan shares with every task brief (ADR 0014 G, 0022): the plan block (mission, the landed core's interface, the notes without paths) is the same
// for every task; the notes on this task's paths and the paths other running tasks declared go in its task block
async function plan(d: Deps, s: Snapshot, t: SnapTask, task: Task): Promise<Partial<BriefIn>> {
  const ep = s.epic ? await d.store.get(s.epic).catch(() => null) : null, run = s.tasks.filter(x => x.id !== t.id && (x.state === 'active' || x.state === 'review'))
  const n = sliceNotes(notesOf(ep?.meta['cadre.notes']), pathsOf(task), d.cfg.notes.slice)
  return { mission: s.mission ?? undefined, core: ep?.meta['cadre.coreContract'] || undefined, shared: n.shared, slice: n.slice,
    others: (await Promise.all(run.map(async x => { const p = pathsOf(await d.store.get(x.id).catch(() => undefined)); return p.length ? `- ${x.id}: ${p.join(', ')}` : '' }))).filter(Boolean) }
}
export async function setup(h: Host, d: Deps, task: Task, wt: string) {   // packages[] are hand-written until M5; `setup` runs in the writable jail (network on)
  const pkg = pkgOf(d, task) as any
  const pkgRoot = !pkg || pkg.root === '.' || !pkg.root ? wt : `${wt}/${pkg.root}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}`
  for (const argv of pkg?.setup?.length ? [pkg.setup as string[]] : []) {   // Pkg.setup is one argv (discover.ts)
    await h.run(['mkdir', '-p', scratch])
    const r = d.cfg.jail === 'off' ? await h.run(argv, { cwd: pkgRoot }) : await h.run(G.writableJail({ wt, scratch, pkgRoot, argv, writable: d.cfg.jailWritable }))
    if (r.exitCode) throw new Error(`setup failed: ${argv.join(' ')}: ${r.stderr.slice(-300)}`)
  }
}
// worktree = the task branch (3.6). Reuses a kept worktree; re-adds one whose directory is gone (8.4); null when the branch itself is missing.
async function ensureWt(h: Host, d: Deps, wt: string, branch: string): Promise<'kept' | 'readd' | null> {
  if (await h.stat(wt)) return 'kept'
  if (!(await G.exists(h.run, d.root, branch))) return null
  await G.op(h, () => G.worktreeReadd(h.run, d.root, wt, branch)); return 'readd'
}
async function lostEpic(h: Host, s: Snapshot, t: SnapTask) {   // epic branch missing: epic blocked, human resolves (re-cut from dev or cancel)
  await commit(h, x => (x.plan && epicNext(x.plan.state, 'lost') ? { ...x, plan: { ...x.plan, state: epicNext(x.plan.state, 'lost')!, flags: [...new Set([...(x.plan.flags ?? []), 'lost-epic'])] } } : x))
  await emit(h, 'flag.raised', { taskId: s.epic ?? t.id, flag: 'lost-epic' }, { taskId: t.id })
  return deny(`epic branch ${s.plan?.epicBranch} is missing; ask the human to recreate it from dev or end the epic (they answer it in the cadre dialog)`)
}

// the owner before the store claim: a session that dies mid-spawn (a quit right after a turn end, ADR 0018) leaves a claim the next session can tell is gone (core/session.held)
const owner = (h: Host, d: Deps, id: string) => h.store.set(`cadre:${d.key}:hb:${id}`, { s: d.session, at: 0 })
// ---- todo -> active: the claim ----
async function claim(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const spec = d.reg[t.type], pipe = stepsOf(d), first = pipe(t.type, t.lane)[0]
  if (!s.epic || !s.plan) return deny('no approved plan yet; ask the human to approve it')
  if (first !== 'worker' && first !== 'explorer' && first !== 'tester') return deny(`${t.id}: type ${t.type} starts at "${first}", which is not available; pick another task`)
  const flag = t.flags.find(f => BLOCKING.test(f)); if (flag) return deny(`${t.id} has flag ${flagName(flag)}; ask the human to resolve it (they answer it in the cadre dialog)`)
  if (t.condition?.state === 'not-met') return deny(`${t.id} never runs: its condition (${t.condition.on} failed) is not met`)
  const ep = epicOf(s, t.epic); if (ep && ep.state !== 'running') return deny(`${t.id}: its epic ${ep.id} is ${ep.state}${ep.why ? ` (${ep.why})` : ''}; go on with the other epics`)   // milestone (ADR 0015)
  if (!(await d.store.ready(t.epic ?? s.epic)).includes(t.id)) return deny(`${t.id} is not ready (waiting on a dependency or gate); spawn a task that TaskList shows ready`)
  const running = s.tasks.filter(x => x.state === 'active').length
  if (d.cfg.maxParallel > 0 && running >= d.cfg.maxParallel) return deny(`${running} agents already running (limit ${d.cfg.maxParallel}); wait for one to finish`)
  const spike = kindOf(spec) === 'spike'
  if (!spike && !(await G.exists(h.run, d.root, branchOf(s, t)))) return lostEpic(h, s, t)
  const res = await apply(h, { kind: 'claim', id: t.id, at: await h.now(), actor: 'mod', owner: d.actor }, pipe)   // the CAS reserve: one winner (S2)
  if (!res.ok) return deny(res.error)
  const step = res.board.tasks.find(x => x.id === t.id)!.step, role = ROLE[step], wt = wtPath(d.wtRoot, d.key, t.id)
  let claimed = false, created = false, branch = taskBranch(spec.commit ?? 'wip', t.id, t.title)
  const undo = async () => {
    if (created) await G.op(h, () => G.worktreeRemove(h.run, d.root, wt, branch)).catch(() => {})
    if (claimed) await d.store.release(t.id, d.actor, 'spawn failed').catch(() => {})
    await apply(h, { kind: 'release', id: t.id, at: await h.now(), actor: 'mod' }, pipe)
  }
  try {
    await owner(h, d, t.id); const task = await d.store.claim(t.id, d.actor); claimed = true
    branch = task.meta['cadre.branch'] || branch   // a rebind keeps the branch it started on
    let cwd = d.root, meta: Record<string, string> = { 'cadre.step': step }
    if (!spike) {
      const base = await G.tip(h.run, d.root, branchOf(s, t))
      if (!(await ensureWt(h, d, wt, branch))) { await G.op(h, () => G.worktreeAdd(h.run, d.root, wt, branch, base)); created = true; await setup(h, d, task, wt) }
      cwd = viewed(d, role) ? await d.view!(h, d, task, wt) : wt
      meta = { ...meta, 'cadre.base': task.meta['cadre.base'] ?? base, 'cadre.branch': branch, 'cadre.worktree': wt }
    }
    await d.store.setMeta(t.id, meta, d.actor); if (!spike) await lockCore(h, d, t.id)   // a core that already landed is locked for this task
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, await plan(d, s, t, task))), cwd, step, spike ? '' : cwd, undo, undefined, task)
  } catch (err) {
    await undo()
    if (err instanceof StoreError) return deny(`${err.code}: ${err.message}`)
    throw err
  }
}

// ---- active|blocked: next step (new role) or rebind (stale lease). Same claim actor, same worktree, computed handoff. ----
async function rebind(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const task = await d.store.get(t.id), role = ROLE[t.step], now = await h.now(), bind = await h.bind.read(), mine = agentsOf(bind, t.id)
  if (!role || (role === 'tester' && !d.view)) return deny(`${t.id}: step ${t.step || '?'} runs without an agent; wait and call TaskList`)
  if (mine.some(a => a.startsWith('~') && bind[a].role === role)) return deny(`${t.id} is already being spawned; wait`)   // another step's start may run beside it
  if (role === 'worker' && stepsOf(d)(t.type, t.lane).includes('red') && !task.meta['cadre.specCommit']) return deny(`${t.id}: its spec tests are not recorded yet; the tester step must finish first`)
  const live = leaseLive(task, now) && (await held(h, await ownerOf(h, t.id))) === 'other'   // a claim of a gone session (quit) or of this process (/clear) does not wait for the lease to lapse
  if (live && !mine.length) return deny(`${t.id} is being worked on from another session; leave it`)
  if (live && mine.some(a => bind[a].role === role && !bind[a].retired)) return deny(`${t.id} is running; wait for its result (TaskList)`)   // retired (core/reuse: context or TTL over) = rebind fresh
  if (t.state === 'blocked' && task.meta['cadre.decision'] === undefined) return deny(`${t.id} is blocked; ask the human to decide (they answer it in the cadre dialog)`)
  const spike = kindOf(d.reg[t.type]) === 'spike', wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), branch = task.meta['cadre.branch'] ?? ''
  if (!spike) {
    const how = await ensureWt(h, d, wt, branch)
    if (!how) {   // task branch missing: lost-wip, release to todo; the next claim starts fresh from the epic tip
      await apply(h, { kind: 'release', id: t.id, at: now, actor: 'mod' }, stepsOf(d)); await d.store.release(t.id, d.actor, 'lost-wip').catch(() => {})
      await emit(h, 'flag.raised', { taskId: t.id, flag: 'lost-wip' }, { taskId: t.id })
      return deny(`${t.id}: its branch is gone; it was released, spawn it again for a fresh start`)
    }
    if (how === 'readd') await setup(h, d, task, wt)
  }
  for (const a of mine) await lifeStep(h, a, { type: 'end', cause: 'released', reason: live ? 'rebind' : 'stale' })
  if (!(await reserve(h, t.id, role, d.session))) return deny(`${t.id} is already being spawned; wait`)
  const undo = () => unreserve(h, t.id, role)
  try {
    if (t.state === 'blocked') await apply(h, { kind: 'unblock', id: t.id, at: now, actor: 'mod' }, stepsOf(d))
    await owner(h, d, t.id); await d.store.resume(t.id, d.actor)
    // computed handoff (never a model summary): checkpoint, diff since the handoff base, last notes
    let handoff = ''
    if (!spike) {
      const cp = (await checkpoint(h, d.store, d.actor, t.id, wt)) ?? (await G.tip(h.run, wt, 'HEAD')),   // locked-dirty refuses the commit (8.4)
         hb = (pipeOf(d.reg)(t.type, t.lane).includes('red') && task.meta['cadre.specCommit']) || task.meta['cadre.base'] || cp
      await d.store.setMeta(t.id, { 'cadre.checkpoint': cp }, d.actor)
      handoff = [`checkpoint ${cp}: the work so far is committed in your tree; continue from it, do not redo it`, await G.diffStat(h.run, wt, `${hb}..${cp}`), await G.diffPatch(h.run, wt, `${hb}..${cp}`), task.meta['cadre.lastCheck'] ? `last check: ${task.meta['cadre.lastCheck']}` : '', task.meta['cadre.report'] ?? ''].filter(Boolean).join('\n')
    }
    const cwd = spike ? d.root : viewed(d, role) ? await d.view!(h, d, task, wt) : wt
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, { ...(await plan(d, s, t, task)), handoff, decisions: task.meta['cadre.decision'] ? [task.meta['cadre.decision']] : undefined })), cwd, t.step, spike ? '' : cwd, undo, undefined, task)
  } catch (err) { await undo(); throw err }
}

// ---- review -> reviewing: a fresh reviewer, never a fork, tier by labels ----
async function review(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  if (t.step !== 'reviewer') return deny(`${t.id} passed review; main completes it (TaskUpdate completed)`)
  const task = await d.store.get(t.id), src = task.meta['cadre.sourceCommit']
  if (!src) return deny(`${t.id} has no commit to review yet`)
  if (!(await reserve(h, t.id, 'reviewer', d.session))) return deny(`${t.id} already has a reviewer; wait for its verdict`)
  const wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), base = task.meta['cadre.base'] ?? src, undo = () => unreserve(h, t.id, 'reviewer')
  try {
    const diffStat = await G.diffStat(h.run, wt, `${base}..${src}`), diff = await G.diffPatch(h.run, wt, `${base}..${src}`)
    const epicMeta = s.epic ? (await d.store.get(s.epic).catch(() => null))?.meta['cadre.corePaths'] : undefined, core: string[] = (() => { try { return JSON.parse(epicMeta ?? '[]') } catch { return [] } })()
    const rt = riskOf(d.cfg.review, { ...parseNumstat(await G.git(h.run, wt, ['diff', '--numstat', `${base}..${src}`])), labels: task.labels, coreTask: task.meta['cadre.core'] === 'true', corePaths: core })
    await d.store.setMeta(t.id, { 'cadre.reviewTier': rt }, d.actor)
    const r = await launch(h, d, e, next, t, 'reviewer', brief('reviewer', briefOf(s, t, task, e, d, 'reviewer', { ...(await plan(d, s, t, task)), uncovered: d.cfg.review.coverage.enforce ? untested(task.acceptance, specTestsOf(task)) : undefined, sourceCommit: src, diffStat, diff, report: task.meta['cadre.report'], flags: t.flags, focus: FOCUS[rt] })), wt, 'reviewer', wt, undo, rt, task)
    if (r?.agentId) await commit(h, b => ({ ...b, tasks: b.tasks.map(x => (x.id === t.id ? { ...x, owner: d.actor } : x)) }))   // the reviewer runs the step now (close clears it at the worker's report); no agent bound: nobody would ever clear it
    return r
  } catch (err) { await undo(); throw err }
}

// ---- a ready epic -> its planner (ADR 0021): read-only in the repo root, bound to the epic (its report drafts the tasks: core/planner) ----
async function planner(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, id: string) {
  const ep = epicOf(s, id)!
  if (s.drive.planner !== 'agent' || (ep.state !== 'ready' && ep.state !== 'planning')) return deny(`${id} has no plan to draft now`)
  if (!(await reserve(h, id, 'planner', d.session))) return deny(`${id} already has a planner; wait`)
  const undo = () => unreserve(h, id, 'planner')
  try { return await launch(h, d, e, next, { id } as SnapTask, 'planner', await plannerBrief(h, d, s, ep), d.root, 'planner', d.root, undo, undefined) } catch (err) { await undo(); throw err }
}

// ---- lease heartbeat (8.4): the tick calls this; bd only, no hooks needed. Beats each of THIS session's bound tasks every `every` ms. ----
export async function beat(h: Host, d: Deps, every = 120_000): Promise<void> {
  const [bind, now] = [await h.bind.read(), await h.now()]
  for (const [a, b] of Object.entries(bind)) {
    if (a.startsWith('~') || b.sessionId !== d.session || (await h.board.read()).tasks.find(t => t.id === b.taskId)?.state !== 'active') continue   // only a claimed (in progress) task has a lease to renew; review/blocked/done are refused every tick
    const k = `cadre:${d.key}:hb:${b.taskId}`, v = (await h.store.get(k)) as { s?: string; at: number } | number | undefined
    if (now - ((typeof v === 'number' ? v : v?.at) ?? 0) < every) continue
    await d.store.heartbeat(b.taskId).catch(err => h.log(`heartbeat ${b.taskId} failed: ${err}`)); await h.store.set(k, { s: d.session, at: now })
  }
}

// ---- tick (5 s): heartbeat this session's bound tasks; nothing else, never a send (G6) ----
export async function tick(h: Host): Promise<void> {
  await warm(h); await stampAlive(h)   // other sessions tell a live session from a gone one by it (core/session.held)
  if (!Object.keys(await h.bind.read()).some(a => !a.startsWith('~'))) return
  const d = await resolveDeps(h), now = await h.now(); await beat(h, d)
  if (now - Number((await h.ui.read()).watchAt ?? 0) >= 60_000) { await h.ui.update(u => ({ ...u, watchAt: now })); await safe(h, 'collision watch', () => watch(h, d)) }   // two running workers on one file: told early (core/rebase)
}
