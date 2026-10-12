// agent.spawn admission (DESIGN 3.4, 4.6, 8.4): claim, next step / rebind, review spawn, marker-less retype, lease staleness, recovery.
// Judge before next; on spawn rejection release and rethrow (AG-12). `admit` is the slot; `admitWith` is the same flow over explicit Deps (tests).
import { modelText } from './say'
import type { Binding, Hook, Host, Role, Snapshot, SnapTask } from '../types'
import type { Config } from '../config/defaults'
import { StoreError, type Task, type TaskStore } from '../task-management/store'
import { kindOf, pipeOf, type TypeRegistry } from '../task-management/registry'
import { repoKeyOf } from '../commands/init'
import { cfgOf, storeOf } from './dispatch'
import { agentsOf, bindAgent, commit, leaseLive, safe, sessionOf, unbindAgent } from './board'
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

const modelOf = (d: Deps, role: Role, t?: Task) => {
  const tier = role === 'reviewer' && t?.labels.some(l => d.cfg.review.deepLabels.includes(l)) ? 'deep' : d.cfg.roles[role]?.tier
  return tier ? (d.cfg.models as Record<string, string>)[tier] ?? tier : undefined
}
const stepsOf = (d: Deps) => (type: string, lane?: string) => { const p = pipeOf(d.reg)(type, lane); return d.view ? p : p.filter(s => s !== 'tester' && s !== 'red') }   // no view builder: tester/red skipped

export async function admitWith(h: Host, d: Deps, e: any, next: (e: any) => any): Promise<any> {
  if (e.isTeammate) return deny('agent teams are not available; use a plain Agent call')
  if (e.workflow) return deny('workflow agents are not available; use a plain Agent call')
  const s = await h.board.read(), ids = idsIn(e.prompt ?? '', s.tasks.map(t => t.id))
  if (ids.length > 1) return deny(`one agent takes one task, but the prompt names ${ids.join(', ')}; spawn one agent per task`)
  if (!ids.length) {   // marker-less: a read-only explorer; forks pass untouched
    if (e.fork) return next(e)
    const m = modelOf(d, 'explorer')
    const r = await next({ ...e, subagentType: 'cadre:explorer', ...(m ? { model: m } : {}), prompt: modelText('agent-brief', brief('explorer', { id: '', title: '', type: '', question: e.prompt })) })
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
async function launch(h: Host, d: Deps, e: any, next: (e: any) => any, t: SnapTask, role: Role, prompt: string, cwd: string, step: string, wt: string, undo: () => Promise<void>, task?: Task) {
  const m = modelOf(d, role, task)
  let r: any
  try { r = await next({ ...e, subagentType: `cadre:${role}`, prompt: modelText('agent-brief', prompt), ...(m ? { model: m } : {}), cwd }) } catch (err) { await undo(); throw err }
  if (r?.deny) { await undo(); return r }
  await unbindAgent(h, `~${t.id}`)
  if (r?.agentId) {
    await bindAgent(h, r.agentId, { taskId: t.id, role, step, worktree: wt, sessionId: d.session, ctxTokens: 0, startedAt: await h.now() })
    await emit(h, 'agent.bound', { agentId: r.agentId, taskId: t.id, role }, { agentId: r.agentId, taskId: t.id, actor: 'mod' })
    await h.store.set(`cadre:${d.key}:hb:${t.id}`, { s: d.session, at: 0 })   // the owner session (core/session.ownerOf): another session judges the claim by it; at 0: the next tick renews the claim
    await safe(h, 'pointer', () => savePointer(h))   // S22: a /clear before main's next turn.complete must still find this binding (the pointer was saved only there)
  }
  return r
}
// CAS reservation in the binding table ("claiming/reviewing" transients live in $.state): false when another spawn holds it or a live agent of that role is bound.
async function reserve(h: Host, d: Deps, id: string, role: Role): Promise<boolean> {
  let got = false
  await h.bind.update(b => { got = !b[`~${id}`] && !agentsOf(b, id).some(a => b[a].role === role); return got ? { ...b, [`~${id}`]: { taskId: id, role, step: '', worktree: '~', sessionId: d.session, ctxTokens: 0, startedAt: 0 } } : b })
  return got
}
const viewed = (d: Deps, role: Role) => role === 'tester' && !!d.view && d.cfg.roles.testerView !== 'full' && d.cfg.roles.tdd.author !== 'same'   // testerView:full or author:same (3.5): the tester step works in the worktree
const agentOf = (d: Deps, role: Role): Role => (role === 'tester' && d.cfg.roles.tdd.author === 'same' ? 'worker' : role)   // author:same: the worker agent, tester brief (3.5)
const briefOf = (s: Snapshot, t: SnapTask, task: Task, e: any, d: Deps, role: Role, extra: Partial<BriefIn> = {}): BriefIn => ({
  testPaths: role === 'tester' ? pkgOf(d, task)?.tdd?.paths : undefined, locked: task.meta['cadre.locked'] ? JSON.parse(task.meta['cadre.locked']) : undefined, redCard: task.meta['cadre.red'],
  id: t.id, title: t.title, type: t.type, description: task.description, scenarios: task.acceptance, contract: task.design, notes: e.prompt, protectedPaths: [...G.PROTECTED, ...(d.cfg.changelog.path !== 'CHANGELOG.md' ? [d.cfg.changelog.path] : [])],
  deps: t.deps.filter(x => x.type !== 'conditional-blocks').map(x => ({ id: x.id, title: s.tasks.find(y => y.id === x.id)?.title ?? '' })), ...extra })

async function setup(h: Host, d: Deps, task: Task, wt: string) {   // packages[] are hand-written until M5; `setup` runs in the writable jail (network on)
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

// ---- todo -> active: the claim ----
async function claim(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const spec = d.reg[t.type], pipe = stepsOf(d), first = pipe(t.type, t.lane)[0]
  if (!s.epic || !s.plan) return deny('no approved plan yet; ask the human to approve it')
  if (first !== 'worker' && first !== 'explorer' && first !== 'tester') return deny(`${t.id}: type ${t.type} starts at "${first}", which is not available; pick another task`)
  const flag = t.flags.find(f => BLOCKING.test(f)); if (flag) return deny(`${t.id} has flag ${flagName(flag)}; ask the human to resolve it (they answer it in the cadre dialog)`)
  if (t.condition?.state === 'not-met') return deny(`${t.id} never runs: its condition (${t.condition.on} failed) is not met`)
  if (!(await d.store.ready(s.epic)).includes(t.id)) return deny(`${t.id} is not ready (waiting on a dependency or gate); spawn a task that TaskList shows ready`)
  const running = s.tasks.filter(x => x.state === 'active').length
  if (running >= d.cfg.maxParallel) return deny(`${running} agents already running (limit ${d.cfg.maxParallel}); wait for one to finish`)
  const spike = kindOf(spec) === 'spike'
  if (!spike && !(await G.exists(h.run, d.root, s.plan.epicBranch))) return lostEpic(h, s, t)
  const res = await apply(h, { kind: 'claim', id: t.id, at: await h.now(), actor: 'mod', owner: d.actor }, pipe)   // the CAS reserve: one winner (S2)
  if (!res.ok) return deny(res.error)
  const step = res.board.tasks.find(x => x.id === t.id)!.step, role = ROLE[step], branch = taskBranch(spec.commit ?? 'wip', t.id, t.title), wt = wtPath(d.wtRoot, d.key, t.id)
  let claimed = false, created = false
  const undo = async () => {
    if (created) await G.op(h, () => G.worktreeRemove(h.run, d.root, wt, branch)).catch(() => {})
    if (claimed) await d.store.release(t.id, d.actor, 'spawn failed').catch(() => {})
    await apply(h, { kind: 'release', id: t.id, at: await h.now(), actor: 'mod' }, pipe)
  }
  try {
    const task = await d.store.claim(t.id, d.actor); claimed = true
    let cwd = d.root, meta: Record<string, string> = { 'cadre.step': step }
    if (!spike) {
      const base = await G.tip(h.run, d.root, s.plan.epicBranch)
      if (!(await ensureWt(h, d, wt, branch))) { await G.op(h, () => G.worktreeAdd(h.run, d.root, wt, branch, base)); created = true; await setup(h, d, task, wt) }
      cwd = viewed(d, role) ? await d.view!(h, d, task, wt) : wt
      meta = { ...meta, 'cadre.base': task.meta['cadre.base'] ?? base, 'cadre.branch': branch, 'cadre.worktree': wt }
    }
    await d.store.setMeta(t.id, meta, d.actor)
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role)), cwd, step, spike ? '' : cwd, undo, task)
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
  if (mine.some(a => a.startsWith('~'))) return deny(`${t.id} is already being spawned; wait`)
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
  for (const a of mine) { await unbindAgent(h, a); await emit(h, 'agent.unbound', { agentId: a, reason: live ? 'rebind' : 'stale' }, { agentId: a, taskId: t.id }) }
  if (!(await reserve(h, d, t.id, role))) return deny(`${t.id} is already being spawned; wait`)
  const undo = async () => { await unbindAgent(h, `~${t.id}`) }
  try {
    if (t.state === 'blocked') await apply(h, { kind: 'unblock', id: t.id, at: now, actor: 'mod' }, stepsOf(d))
    await d.store.resume(t.id, d.actor)
    // computed handoff (never a model summary): checkpoint, diff since the handoff base, last notes
    let handoff = ''
    if (!spike) {
      const cp = (await checkpoint(h, d.store, d.actor, t.id, wt)) ?? (await G.tip(h.run, wt, 'HEAD')),   // locked-dirty refuses the commit (8.4)
         hb = (pipeOf(d.reg)(t.type, t.lane).includes('red') && task.meta['cadre.specCommit']) || task.meta['cadre.base'] || cp
      await d.store.setMeta(t.id, { 'cadre.checkpoint': cp }, d.actor)
      handoff = [`checkpoint ${cp}: the work so far is committed in your tree; continue from it, do not redo it`, await G.diffStat(h.run, wt, `${hb}..${cp}`), await G.diffPatch(h.run, wt, `${hb}..${cp}`), task.meta['cadre.lastCheck'] ? `last check: ${task.meta['cadre.lastCheck']}` : '', task.meta['cadre.report'] ?? ''].filter(Boolean).join('\n')
    }
    const cwd = spike ? d.root : viewed(d, role) ? await d.view!(h, d, task, wt) : wt
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, { handoff, decisions: task.meta['cadre.decision'] ? [task.meta['cadre.decision']] : undefined })), cwd, t.step, spike ? '' : cwd, undo, task)
  } catch (err) { await undo(); throw err }
}

// ---- review -> reviewing: a fresh reviewer, never a fork, tier by labels ----
async function review(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  if (t.step !== 'reviewer') return deny(`${t.id} passed review; main completes it (TaskUpdate completed)`)
  const task = await d.store.get(t.id), src = task.meta['cadre.sourceCommit']
  if (!src) return deny(`${t.id} has no commit to review yet`)
  if (!(await reserve(h, d, t.id, 'reviewer'))) return deny(`${t.id} already has a reviewer; wait for its verdict`)
  const wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), base = task.meta['cadre.base'] ?? src, undo = async () => { await unbindAgent(h, `~${t.id}`) }
  try {
    const diffStat = await G.diffStat(h.run, wt, `${base}..${src}`), diff = await G.diffPatch(h.run, wt, `${base}..${src}`)
    const r = await launch(h, d, e, next, t, 'reviewer', brief('reviewer', briefOf(s, t, task, e, d, 'reviewer', { sourceCommit: src, diffStat, diff, report: task.meta['cadre.report'], flags: t.flags })), wt, 'reviewer', wt, undo, task)
    if (r?.agentId) await commit(h, b => ({ ...b, tasks: b.tasks.map(x => (x.id === t.id ? { ...x, owner: d.actor } : x)) }))   // the reviewer runs the step now (close clears it at the worker's report); no agent bound: nobody would ever clear it
    return r
  } catch (err) { await undo(); throw err }
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
  if (Object.keys(await h.bind.read()).some(a => !a.startsWith('~'))) await beat(h, await resolveDeps(h))
}
