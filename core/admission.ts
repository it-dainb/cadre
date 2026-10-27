// agent.spawn admission (DESIGN 3.4, 4.6, 8.4): claim, next step / rebind, review spawn, marker-less retype, lease staleness, recovery.
// Judge before next; on spawn rejection release and rethrow (AG-12). `admit` is the slot; `admitWith` is the same flow over explicit Deps (tests).
import { modelText } from './say'
import type { Binding, Hook, Host, Role, Snapshot, SnapTask } from '../types'
import type { Config } from '../config/defaults'
import { forcedOf } from '../config/index'
import { StoreError, type Task, type TaskStore } from '../task-management/store'
import { kindOf, pipeOf, type TypeRegistry } from '../task-management/registry'
import { repoKeyOf } from '../commands/init'
import { cfgOf, ctlGet, ctlSet, storeOf } from './dispatch'
import { agentsOf, commit, leaseLive, safe, sessionOf } from './board'
import { FOCUS, parseNumstat, riskOf, route, type Tier } from './risk'
import { held, ownerOf, savePointer, stampAlive } from './session'
import { BLOCKING, apply, epicNext } from './machine'
import { emit } from './events'
import { flagName } from './render'
import { brief, handoffOf, idsIn, type BriefIn } from './briefs'
import { asked } from './asks'
import { taskBranch, wtPath, wtRootOf } from './branches'
import * as G from './git'
import { checkpoint } from './effect'
import { warm } from './session'
import { buildView, inRepo, pkgOf, rootOf } from './specview'
import { realRoot } from '../policy/guards'
import { lockCore, watch } from './rebase'
import { feed } from './lessons'
import { holdsOf, notesOf, pathsOf, sliceNotes, specTestsOf, untested } from './validate'
import { branchOf, epicOf } from './milestone'
import { plannerBrief } from './planner'
import { modelRefusal, inSlot, tasksFull } from './queue'
import { specMark, specNeeded } from './specifier'
import { budgetOf, intentOf, reserve, runOf, step as lifeStep, unreserve } from './lifecycle'
import { ROLES_DEFAULT } from './roles'
import * as P from './helpers'
import { needOf, question, running, undelivered, delivered } from './needs'

export interface Deps {
  store: TaskStore; cfg: Config; reg: TypeRegistry; root: string; home: string; wtRoot: string; key: string; actor: string; session: string
  top?: string   // set by specview.inRepo: root is a submodule's repository, top the parent's
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
export const routeOf = (d: Deps, role: Role, risk: Tier, n = 0, unit?: { root: string; routing?: Record<string, any> }) => (role === 'explorer' || role === 'planner' || role === 'specifier' ? route(role, d.cfg.roles[role], '', 0)
  : ((r = route(role, { ...d.cfg.roles[role].byRisk[risk], ...unit?.routing?.[role] }, risk, n)) => (unit?.routing?.[role] && !r.escalated ? { ...r, setting: `units ${unit.root}: routing.${role}` } : r))())   // a unit's routing override (H7) wins over the risk cell
const riskFor = (d: Deps, rt?: Tier, task?: Task) => rt ?? riskOf(d.cfg.review, { paths: pathsOf(task), labels: task?.labels ?? [], coreTask: task?.meta['cadre.core'] === 'true' })
// the model a pick will run on: launch's own routing, asked before the start (core/queue counts runs by it)
export async function modelFor(h: Host, d: Deps, id: string, role: string): Promise<string | undefined> {
  const t = (await h.board.read()).tasks.find(x => x.id === id), task = t ? await d.store.get(id).catch(() => undefined) : undefined, step = role === 'claim' && t ? stepsOf(d)(t.type, t.lane)[0] : role
  if (t && !task) return undefined
  return forcedOf(await h.env()).model || routeOf(d, ROLE[step] ?? (step === 'helper' ? 'explorer' : step === 'specify' ? 'specifier' : step as Role), riskFor(d, undefined, task), task ? await rounds(h, id) : 0, task && pkgOf(d, task)).model
}
const stepsOf = (d: Deps) => (type: string, lane?: string) => { const p = pipeOf(d.reg)(type, lane); return d.view ? p : p.filter(s => s !== 'tester' && s !== 'red') }   // no view builder: tester/red skipped

export async function admitWith(h: Host, d: Deps, e: any, next: ((e: any) => any) & { origin?: { plugin: string } }): Promise<any> {
  if (e.isTeammate) return deny('agent teams are not available; use a plain Agent call')
  if (e.workflow) return deny('workflow agents are not available; use a plain Agent call')
  if (e.resume) return next(e)   // a finished agent resumed by a message (Claude Code 2.1.299 raises agent.spawn for it, with resume.agentId): it and its run exist already; the send is judged where it is sent
  const s = await h.board.read(), mine = next.origin?.plugin === 'cadre', it = mine ? await intentOf(h, String(e.prompt ?? '').trim()) : undefined   // the spawner's own start names its intent
  if (mine && !it) { h.log(`spawn refused: no intent ${String(e.prompt ?? '').slice(0, 40)}`); return deny('this start has no task behind it, so it was not started') }   // never an explorer
  const explorer = async (x: any, told?: false) => {   // a read-only explorer, tracked from the start: its stop is observed and main only sees its card (core/asks)
    const r = await next({ ...x, subagentType: 'cadre:explorer', model: routeOf(d, 'explorer', 'light').model, prompt: modelText('agent-brief', brief('explorer', { id: '', title: '', type: '', question: x.prompt })) })
    if (r?.agentId) await asked(h, r.agentId, x, told); return r
  }
  if (it?.role === 'explore') return explorer({ ...e, prompt: modelText('agent-brief', it.taskId) }, false)   // main's explore tool (core/plantools): the question rides on the intent; the answer goes to main as a message
  if (it?.role === 'specify') return specify(h, d, e, next, s, it.taskId)   // roles.specifier.enabled: the how-to notes before a claim (core/specifier)
  if (it?.role === 'helper') return helper(h, d, e, next, s, it.taskId)   // a requester's helper (core/needs): on its task and tree
  if (it && it.role !== 'planner' && !s.tasks.some(x => x.id === it.taskId)) return deny(`${it.taskId} is no longer on the board`)
  if (it?.role === 'planner') return epicOf(s, it.taskId) ? planner(h, d, e, next, s, it.taskId) : deny(`${it.taskId} has no plan to draft now`)   // a ready epic's planner (ADR 0021)
  if (it) e = { ...e, prompt: modelText('agent-brief', '') }   // the brief's notes are main's words only
  const cr = !it && /^cadre:([\w-]+)$/.exec(String(e.subagentType ?? ''))?.[1]; if (cr && !(cr in ROLES_DEFAULT)) return custom(h, e, next, cr)   // main's call of a custom role (roles.custom)
  const ids = it ? [it.taskId] : idsIn(e.prompt ?? '', s.tasks.map(t => t.id))
  if (ids.length > 1) return deny(`one agent takes one task, but the prompt names ${ids.join(', ')}; spawn one agent per task`)
  if (ids.length && s.drive.on && !s.drive.stopped && s.drive.spawn === 'mod' && next.origin?.plugin !== 'cadre') return deny(`${ids[0]} starts by itself; do not spawn agents for the plan's tasks. An Agent without a task id (to explore or ask) is fine`)   // mod mode (ADR 0018): only the spawner's own call, never main's
  if (!ids.length) {   // marker-less: a read-only explorer; forks pass untouched
    if (e.fork) return next(e)
    return explorer(e)
  }
  if (e.fork) return deny('a task agent cannot be a fork; spawn it without fork')
  const t = s.tasks.find(x => x.id === ids[0])!
  if (!d.reg[t.type]) return deny(`${t.id}: unknown type "${t.type}"`)
  if (t.state === 'todo') return claim(h, d, e, next, s, t)
  if (t.state === 'active' || t.state === 'blocked') return rebind(h, d, e, next, s, t)
  if (t.state === 'review') return review(h, d, e, next, s, t)
  return deny(`${t.id} is ${t.state}; nothing to spawn`)
}

// the specifier's one read-only run for a todo task (core/specifier): tracked like an ask, so its stop is observed and its report is the notes. Any failure to start lets the task go on without notes.
async function specify(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, id: string) {
  const t = s.tasks.find(x => x.id === id)!, task = await d.store.get(id)
  if (t.state !== 'todo' || (await specNeeded(h, d, id)) !== 'specify') return deny(`${id} does not need a specifier now`)
  await specMark(h, d, id)
  try {
    const r = await next({ ...e, subagentType: 'cadre:specifier', model: routeOf(d, 'specifier', 'light').model, prompt: modelText('agent-brief', brief('specifier', briefOf(s, t, task, { prompt: '' }, d, 'specifier', await plan(h, d, s, t, task)))) })
    if (r?.agentId) await asked(h, r.agentId, e, undefined, 'specifier', id); else await specMark(h, d, id, 'done')
    return r
  } catch (x) { await specMark(h, d, id, 'done'); throw x }
}

// a custom role is spawned by main like an ask, only once the engine took its register and from a later turn than that register's (it dispatches from the next turn)
async function custom(h: Host, e: any, next: (e: any) => any, name: string) {
  const sec = await h.secret.read(), at = sec.roles?.done.find(x => x.name === name)
  if (!at) return deny(`${name} is not available; to look into the code, call explore`)
  if (at.turn >= (sec.turn ?? 0)) return deny(`${name} is ready from your next turn; ask again then`)
  const r = await next({ ...e, prompt: modelText('agent-brief', brief('explorer', { id: '', title: '', type: '', question: e.prompt })) })
  if (r?.agentId) await asked(h, r.agentId, e, undefined, name); return r
}

// ---- shared tail: retype, model, cwd, next(), bind. A rejected or thrown spawn runs `undo` (release) and rethrows. ----
async function launch(h: Host, d: Deps, e: any, next: (e: any) => any, t: SnapTask, role: Role, prompt: string, cwd: string, step: string, wt: string, undo: () => Promise<void>, rt?: Tier, task?: Task, bx: Partial<Binding> = {}) {
  const risk = riskFor(d, rt, task)
  const r0 = routeOf(d, step === 'tester' ? 'tester' : role, risk, task ? await rounds(h, t.id) : 0, task && pkgOf(d, task)), env = await h.env()
  const fo = forcedOf(env), forced = fo.model || fo.effort ? `${fo.model ?? ''}/${fo.effort ?? ''}` : undefined
  const run = { role, model: fo.model || r0.model, effort: fo.effort || r0.effort || 'default', risk, setting: r0.setting, ...(r0.escalated ? { escalated: true } : {}), ...(forced ? { forced } : {}) }
  let r: any
  try { r = await next({ ...e, subagentType: `cadre:${role}`, prompt: modelText('agent-brief', prompt), model: r0.model, cwd }) } catch (err) { await undo(); throw modelRefusal(err, fo.model ? 'CLAUDE_CODE_SUBAGENT_MODEL' : `${r0.setting}.model`, run.model) }   // the model named is the one the engine was given: a forced one beats cadre's
  if (r?.deny) { await undo(); return r }
  if (!r?.agentId) { await unreserve(h, t.id, step); await undo(); return r }   // nobody started: what the start made (a probe's tree) goes too
  if (typeof r.model === 'string' && r.model !== run.model) Object.assign(run, { ran: r.model })   // the id Claude Code resolved the alias to (its agent.spawn result)
  await lifeStep(h, r.agentId, { type: 'spawn.ok', mode: e.permissionMode, model: run.model, bind: { taskId: t.id, role, step, worktree: wt, sessionId: d.session, ctxTokens: 0, startedAt: await h.now(), ...(r0.effort ? { effort: r0.effort } : {}), ...bx } })
  await emit(h, 'agent.bound', { agentId: r.agentId, taskId: t.id, role, ...(rt ? { tier: rt } : {}), model: run.model, ...((run as any).ran ? { ran: (run as any).ran } : {}), effort: run.effort, setting: r0.setting, ...(r0.escalated ? { escalated: true } : {}), ...(forced ? { forced } : {}) }, { agentId: r.agentId, taskId: t.id, actor: 'mod' })
  if (task) await safe(h, 'runs', async () => { let a: unknown[] = []; try { a = JSON.parse((await d.store.get(t.id)).meta['cadre.runs'] || '[]') } catch {}; await d.store.setMeta(t.id, { 'cadre.runs': JSON.stringify([...a, run].slice(-20)) }, d.actor) })
  await ctlSet(h, { [`hb:${t.id}`]: { s: d.session, at: 0 } })   // the owner session (core/session.ownerOf): another session judges the claim by it; at 0: the next tick renews the claim
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
  holds: holdsOf(task), id: t.id, title: t.title, type: t.type, description: task.description, scenarios: task.acceptance, contract: task.design, notes: noteOf(e.prompt, t.id), protectedPaths: protectedOf(d),
  how: role === 'worker' ? task.meta['cadre.how'] : undefined, deps: t.deps.filter(x => x.type !== 'conditional-blocks').map(x => ({ id: x.id, title: s.tasks.find(y => y.id === x.id)?.title ?? '' })), ...extra })

// what the plan shares with every task brief (ADR 0014 G, 0022): the plan block (mission, the landed core's interface, the notes without paths) is the same
// for every task; the notes on this task's paths and the paths other running tasks declared go in its task block
async function plan(h: Host, d: Deps, s: Snapshot, t: SnapTask, task: Task): Promise<Partial<BriefIn>> {
  const ep = s.epic ? await d.store.get(s.epic).catch(() => null) : null, run = s.tasks.filter(x => x.id !== t.id && (x.state === 'active' || x.state === 'review'))
  const n = sliceNotes(notesOf(ep?.meta['cadre.notes']), pathsOf(task), d.cfg.notes.slice)
  return { mission: s.mission ?? undefined, core: ep?.meta['cadre.coreContract'] || undefined, shared: n.shared, slice: n.slice, lessons: await feed(h, t.id, pathsOf(task)).catch(() => ''),
    others: (await Promise.all(run.map(async x => { const p = pathsOf(await d.store.get(x.id).catch(() => undefined)); return p.length ? `- ${x.id}: ${p.join(', ')}` : '' }))).filter(Boolean) }
}
const DEPS_DROPPED = modelText('tool-result', 'The install you had before the spec change was dropped with it (it conflicted with the merged plan). Request the packages your code and tests need again: report outcome "request" with request {"helper":"setup","ask":"add <package>","why":"..."}.')   // set in cadre.depsDropped by the spec-change reset (core/tdd), until a setup run commits again
export async function setup(h: Host, d: Deps, task: Task, wt: string) {   // `setup` runs in the writable jail (network on)
  const pkg = pkgOf(d, task) as any
  const pkgRoot = !rootOf(pkg) ? wt : `${wt}/${pkg.root}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}`
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
  await G.op(h, () => G.worktreeReadd(h.run, d.root, wt, branch)); const sub = await G.subInit(h.run, d.root, wt); if (sub) throw new StoreError('Invalid', sub); return 'readd'
}
async function lostEpic(h: Host, s: Snapshot, t: SnapTask) {   // epic branch missing: epic blocked, human resolves (re-cut from dev or cancel)
  await commit(h, x => (x.plan && epicNext(x.plan.state, 'lost') ? { ...x, plan: { ...x.plan, state: epicNext(x.plan.state, 'lost')!, flags: [...new Set([...(x.plan.flags ?? []), 'lost-epic'])] } } : x))
  await emit(h, 'flag.raised', { taskId: s.epic ?? t.id, flag: 'lost-epic' }, { taskId: t.id })
  return deny(`epic branch ${s.plan?.epicBranch} is missing; ask the human to recreate it from dev or end the epic (they answer it in the cadre dialog)`)
}

// the owner before the store claim: a session that dies mid-spawn (a quit right after a turn end, ADR 0018) leaves a claim the next session can tell is gone (core/session.held)
const owner = (h: Host, d: Deps, id: string) => ctlSet(h, { [`hb:${id}`]: { s: d.session, at: 0 } })
// ---- todo -> active: the claim ----
async function claim(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const spec = d.reg[t.type], pipe = stepsOf(d), first = pipe(t.type, t.lane)[0]
  if (!s.epic || !s.plan) return deny('no approved plan yet; ask the human to approve it')
  if (first !== 'worker' && first !== 'explorer' && first !== 'tester') return deny(`${t.id}: type ${t.type} starts at "${first}", which is not available; pick another task`)
  const flag = t.flags.find(f => BLOCKING.test(f)); if (flag) return deny(`${t.id} has flag ${flagName(flag)}; ask the human to resolve it (they answer it in the cadre dialog)`)
  if (t.condition?.state === 'not-met') return deny(`${t.id} never runs: its condition (${t.condition.on} failed) is not met`)
  const ep = epicOf(s, t.epic); if (ep && ep.state !== 'running') return deny(`${t.id}: its epic ${ep.id} is ${ep.state}${ep.why ? ` (${ep.why})` : ''}; go on with the other epics`)   // milestone (ADR 0015)
  if (!(await d.store.ready(t.epic ?? s.epic)).includes(t.id)) return deny(`${t.id} is not ready (waiting on a dependency or gate); spawn a task that status shows ready`)
  if (tasksFull(d.cfg, s)) return deny(`${s.tasks.filter(inSlot).length} agents already running (limit ${d.cfg.concurrency.default}); wait for one to finish`)
  const spike = kindOf(spec) === 'spike', top = d; d = inRepo(d, pkgOf(d, await d.store.get(t.id)))
  if (!spike && !(await G.exists(h.run, d.root, branchOf(s, t)))) { if (d === top) return lostEpic(h, s, t); await G.git(h.run, d.root, ['branch', branchOf(s, t), (await G.exists(h.run, d.root, d.cfg.branches.dev)) ? d.cfg.branches.dev : 'HEAD']) }   // a submodule's epic branch: cut from its dev on first use
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
      if (!(await ensureWt(h, d, wt, branch))) { await G.op(h, () => G.worktreeAdd(h.run, d.root, wt, branch, base)); created = true; const sub = await G.subInit(h.run, d.root, wt); if (sub) throw new StoreError('Invalid', sub); await setup(h, d, task, wt) }
      cwd = viewed(d, role) ? await d.view!(h, d, task, wt) : wt
      meta = { ...meta, 'cadre.base': task.meta['cadre.base'] ?? base, 'cadre.branch': branch, 'cadre.worktree': wt }
    }
    await d.store.setMeta(t.id, meta, d.actor); if (!spike) await lockCore(h, d, t.id)   // a core that already landed is locked for this task
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, await plan(h, d, s, t, task))), cwd, step, spike ? '' : cwd, undo, undefined, task)
  } catch (err) {
    await undo()
    if (err instanceof StoreError) return deny(`${err.code}: ${err.message}`)
    throw err
  }
}

// ---- active|blocked: next step (new role) or rebind (stale lease). Same claim actor, same worktree, computed handoff. ----
async function rebind(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const task = await d.store.get(t.id), role = ROLE[t.step], now = await h.now(), bind = await h.bind.read(), mine = agentsOf(bind, t.id); d = inRepo(d, pkgOf(d, task))
  if (!role || (role === 'tester' && !d.view)) return deny(`${t.id}: step ${t.step || '?'} runs without an agent; wait and call status`)
  if (mine.some(a => a.startsWith('~') && bind[a].role === role)) return deny(`${t.id} is already being spawned; wait`)   // another step's start may run beside it
  if (role === 'worker' && stepsOf(d)(t.type, t.lane).includes('red') && !task.meta['cadre.specCommit']) return deny(`${t.id}: its spec tests are not recorded yet; the tester step must finish first`)
  const live = leaseLive(task, now)
  if (live && !mine.length && (await held(h, await ownerOf(h, t.id))) === 'other') return deny(`${t.id} is being worked on from another session; leave it`)   // a claim of a gone session (quit) or of this process (/clear) does not wait for the lease to lapse
  if (live && mine.some(a => bind[a].role === role && !bind[a].retired)) return deny(`${t.id} is running; wait for its result (status)`)   // retired (core/reuse: context or TTL over) = rebind fresh
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
  const was = (await Promise.all(mine.filter(a => bind[a].role === role).map(a => runOf(h, a)))).find(r => r?.model)?.model   // revival (B5): the run it takes over ran on this model; a fresh agent gets exactly the model routing gives now, or the task waits (never another one)
  if (was && !forcedOf(await h.env()).model) {
    const r0 = routeOf(d, role, riskFor(d, undefined, task), await rounds(h, t.id), pkgOf(d, task))
    if (!r0.escalated && r0.model !== was) return deny(`${t.id}: its ${role} ran on ${was} and ${r0.setting} now says ${r0.model}; set it back to ${was} and ask again (the task waits)`)
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
      handoff = handoffOf(task.meta, cp, await G.diffStat(h.run, wt, `${hb}..${cp}`), await G.diffPatch(h.run, wt, `${hb}..${cp}`))
    }
    const cwd = spike ? d.root : viewed(d, role) ? await d.view!(h, d, task, wt) : wt
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, { ...(await plan(h, d, s, t, task)), handoff, decisions: [...(role === 'tester' ? [task.meta['cadre.specDecision']] : [task.meta['cadre.decision'], await undelivered(h, t.id)]), task.meta['cadre.depsDropped'] ? DEPS_DROPPED : ''].filter(Boolean) as string[] })), cwd, t.step, spike ? '' : cwd, undo, undefined, task).then(async r => { if (r?.agentId) { await delivered(h, t.id); if (role === 'tester' && task.meta['cadre.specDecision']) await d.store.setMeta(t.id, { 'cadre.specDecision': '' }, d.actor) } return r })   // a tester hears only the spec change's decision, once (a stale answer never reaches it)   // an answer its requester never got goes in once
  } catch (err) { await undo(); throw err }
}

// ---- review -> reviewing: a fresh reviewer, never a fork, tier by labels ----
async function review(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  if (t.step !== 'reviewer') return deny(`${t.id} passed review; main completes it (status set completed)`)
  const task = await d.store.get(t.id), src = task.meta['cadre.sourceCommit']
  if (!src) return deny(`${t.id} has no commit to review yet`)
  if (!(await reserve(h, t.id, 'reviewer', d.session))) return deny(`${t.id} already has a reviewer; wait for its verdict`)
  const wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), base = task.meta['cadre.base'] ?? src, undo = () => unreserve(h, t.id, 'reviewer')
  try {
    const diffStat = await G.diffStat(h.run, wt, `${base}..${src}`), diff = await G.diffPatch(h.run, wt, `${base}..${src}`)
    const epicMeta = s.epic ? (await d.store.get(s.epic).catch(() => null))?.meta['cadre.corePaths'] : undefined, core: string[] = (() => { try { return JSON.parse(epicMeta ?? '[]') } catch { return [] } })()
    const rt = riskOf(d.cfg.review, { ...parseNumstat(await G.git(h.run, wt, ['diff', '--numstat', `${base}..${src}`])), labels: task.labels, coreTask: task.meta['cadre.core'] === 'true', corePaths: core })
    await d.store.setMeta(t.id, { 'cadre.reviewTier': rt }, d.actor)
    const r = await launch(h, d, e, next, t, 'reviewer', brief('reviewer', briefOf(s, t, task, e, d, 'reviewer', { ...(await plan(h, d, s, t, task)), uncovered: d.cfg.review.coverage.enforce && specTestsOf(task) ? untested(task.acceptance, specTestsOf(task)) : undefined, sourceCommit: src, diffStat, diff, report: task.meta['cadre.report'], flags: t.flags, focus: FOCUS[rt] })), wt, 'reviewer', wt, undo, rt, task)
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

// ---- a requester's helper: a read-only explorer on the requester's task and tree, bound to its request; its report answers it (core/needs) ----
async function helper(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, id: string) {
  const n = await needOf(h, id), t = s.tasks.find(x => x.id === id) ?? ({ id } as SnapTask), task = await d.store.get(id).catch(() => null)
  if (!n || running(await h.bind.read(), n) || n.answer !== undefined || !task) return deny(`${id} has no request to help with now`)
  const probe = n.helper === 'probe', wt = probe ? await P.probeAdd(h, d.root, `${d.wtRoot}/${d.key}`, n) : task.meta['cadre.worktree'] || d.root   // a probe looks around in a scratch tree of its own
  return launch(h, d, e, next, t, 'explorer', brief('explorer', { id: '', title: '', type: '', question: question(n) }), wt, 'helper', wt, async () => { if (probe) await P.probeEnd(h, d.root, `${d.wtRoot}/${d.key}`, n) }, undefined, undefined, { parent: n.requester, needId: n.needId })
}

// ---- lease heartbeat (8.4): the tick calls this; the store only, no hooks needed. Beats each of THIS session's bound tasks every `every` ms. ----
export async function beat(h: Host, d: Deps, every = 120_000): Promise<void> {
  const [bind, now] = [await h.bind.read(), await h.now()]
  for (const [a, b] of Object.entries(bind)) {
    if (a.startsWith('~') || b.sessionId !== d.session || (await h.board.read()).tasks.find(t => t.id === b.taskId)?.state !== 'active') continue   // only a claimed (in progress) task has a lease to renew; review/blocked/done are refused every tick
    const k = `hb:${b.taskId}`, v = await ctlGet<{ s?: string; at: number }>(h, k)
    if (now - (v?.at ?? 0) < every) continue
    await d.store.heartbeat(b.taskId).catch(err => h.log(`heartbeat ${b.taskId} failed: ${err}`)); await ctlSet(h, { [k]: { s: d.session, at: now } })
  }
}

// ---- tick (5 s): heartbeat this session's bound tasks; nothing else, never a send (G6) ----
export async function tick(h: Host): Promise<void> {
  await warm(h); await stampAlive(h)   // other sessions tell a live session from a gone one by it (core/session.held)
  if (!Object.keys(await h.bind.read()).some(a => !a.startsWith('~'))) return
  const d = await resolveDeps(h), now = await h.now(); await beat(h, d)
  if (now - Number((await h.ui.read()).watchAt ?? 0) >= 60_000) { await h.ui.update(u => ({ ...u, watchAt: now })); await safe(h, 'collision watch', () => watch(h, d)) }   // two running workers on one file: told early (core/rebase)
}
