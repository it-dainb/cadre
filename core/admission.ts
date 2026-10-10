// agent.spawn admission (DESIGN 3.4, 4.6, 8.4): claim, next step / rebind, review spawn, marker-less retype, lease staleness, recovery.
// Judge before next; on spawn rejection release and rethrow (AG-12). `admit` is the slot; `admitWith` is the same flow over explicit Deps (tests).
import type { Binding, Hook, Host, Role, Snapshot, SnapTask } from '../types'
import type { Config } from '../config/defaults'
import { StoreError, type Task, type TaskStore } from '../task-management/store'
import { kindOf, pipeOf, type TypeRegistry } from '../task-management/registry'
import { repoKeyOf } from '../commands/init'
import { cfgOf, storeOf } from './dispatch'
import { agentsOf, bindAgent, commit, unbindAgent } from './board'
import { apply, epicNext } from './machine'
import { emit } from './events'
import { DISCOVERY, brief, idsIn, type BriefIn } from './briefs'
import { taskBranch, wtPath } from './branches'
import * as G from './git'
import { buildView, pkgOf } from './specview'

export interface Deps {
  store: TaskStore; cfg: Config; reg: TypeRegistry; root: string; home: string; wtRoot: string; key: string; actor: string; session: string
  view?: (h: Host, d: Deps, t: Task, wt: string) => Promise<string>   // spec view builder (core/specview, M5); absent = tester/red are skipped (3.1)
}
const ROLE: Record<string, Role> = { tester: 'tester', worker: 'worker', reviewer: 'reviewer', explorer: 'explorer' }   // red/green are mod-run, merge is main's close
const BLOCKING = /^(git:|external$|drift$|conflict$|lost-|integration-failed$)/
const PROTECTED = ['.git/', '.cadre/', '.beads/', '.claude/', '.mcp.json', 'CHANGELOG.md']
const deny = (why: string) => ({ deny: `cadre: ${why}` })

export const leaseLive = (t: Pick<Task, 'leaseUntil'>, now: number) => !!t.leaseUntil && Date.parse(t.leaseUntil) > now
export async function sessionOf(h: Host): Promise<string> {
  const n = h.rand(4); await h.secret.update(s => (s.session ? s : { ...s, session: n })); return (await h.secret.read()).session!
}

// Everything admission needs from the outside world, resolved per hook (never cached across hooks): store + config via the register.ts wiring.
export async function resolveDeps(h: Host): Promise<Deps> {
  const [root, home, cfg] = [await h.cwd(), await h.home(), await cfgOf(h)], store = await storeOf(h), key = repoKeyOf(root), ak = `cadre:${key}:actor`
  let actor = (await h.store.get(ak)) as string | undefined
  if (!actor) { actor = `cadre/${home.split('/').pop() || 'user'}/${h.rand(3)}`; await h.store.set(ak, actor) }
  return { store, cfg, reg: cfg.types as TypeRegistry, root, home, wtRoot: cfg.worktrees.root || `${home}/.cache/cadre/wt`, key, actor, session: await sessionOf(h), view: buildView }
}
export const admit: Hook = async (h, e, next) => admitWith(h, await resolveDeps(h), e, next)

const modelOf = (d: Deps, role: Role, t?: Task) => {
  const tier = role === 'reviewer' && t?.labels.some(l => d.cfg.review.deepLabels.includes(l)) ? 'deep' : d.cfg.roles[role]?.tier
  return tier ? (d.cfg.models as Record<string, string>)[tier] ?? tier : undefined
}
const stepsOf = (d: Deps) => (type: string) => { const p = pipeOf(d.reg)(type); return d.view ? p : p.filter(s => s !== 'tester' && s !== 'red') }   // no view builder: tester/red skipped

export async function admitWith(h: Host, d: Deps, e: any, next: (e: any) => any): Promise<any> {
  if (e.isTeammate) return deny('teammates are not supported (AG-27)')
  if (e.workflow) return deny('workflow agents are not supported (AG-30)')
  const s = await h.board.read(), ids = idsIn(e.prompt ?? '', s.tasks.map(t => t.id))
  if (ids.length > 1) return deny(`one agent = one task, but the prompt names ${ids.join(', ')}`)
  if (!ids.length) {   // marker-less: explorer (or the discovery brief while init stage 4 is pending); forks pass untouched
    if (e.fork) return next(e)
    const disc = s.init.some(i => i.stage === 4 && i.state === 'pending'), m = modelOf(d, 'explorer')
    return next({ ...e, subagentType: 'cadre:explorer', ...(m ? { model: m } : {}), prompt: disc ? `${DISCOVERY}\n\n## Orchestrator notes\n${String(e.prompt ?? '').slice(0, 500)}` : brief('explorer', { id: '', title: '', type: '', question: e.prompt }) })
  }
  if (e.fork) return deny('task-bound spawns are never forks (AG-11); spawn it plainly')
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
  try { r = await next({ ...e, subagentType: `cadre:${role}`, prompt, ...(m ? { model: m } : {}), cwd }) } catch (err) { await undo(); throw err }
  if (r?.deny) { await undo(); return r }
  await unbindAgent(h, `~${t.id}`)
  if (r?.agentId) {
    await bindAgent(h, r.agentId, { taskId: t.id, role, step, worktree: wt, sessionId: d.session, ctxTokens: 0, startedAt: await h.now() })
    await emit(h, 'agent.bound', { agentId: r.agentId, taskId: t.id, role }, { agentId: r.agentId, taskId: t.id, actor: 'mod' })
  }
  return r
}
// CAS reservation in the binding table ("claiming/reviewing" transients live in $.state): false when another spawn holds it or a live agent of that role is bound.
async function reserve(h: Host, d: Deps, id: string, role: Role): Promise<boolean> {
  let got = false
  await h.bind.update(b => { got = !b[`~${id}`] && !agentsOf(b, id).some(a => b[a].role === role); return got ? { ...b, [`~${id}`]: { taskId: id, role, step: '', worktree: '~', sessionId: d.session, ctxTokens: 0, startedAt: 0 } } : b })
  return got
}
const viewed = (d: Deps, role: Role) => role === 'tester' && !!d.view && d.cfg.roles.testerView !== 'full'   // testerView:full = the tester works in the worktree
const agentOf = (d: Deps, role: Role): Role => (role === 'tester' && d.cfg.roles.tdd.author === 'same' ? 'worker' : role)   // author:same: the worker agent, tester brief (3.5)
const briefOf = (s: Snapshot, t: SnapTask, task: Task, e: any, d: Deps, role: Role, extra: Partial<BriefIn> = {}): BriefIn => ({
  testPaths: role === 'tester' ? pkgOf(d, task)?.tdd?.paths : undefined, locked: task.meta['cadre.locked'] ? JSON.parse(task.meta['cadre.locked']) : undefined, redCard: task.meta['cadre.red'],
  id: t.id, title: t.title, type: t.type, description: task.description, scenarios: task.acceptance, contract: task.design, notes: e.prompt, protectedPaths: PROTECTED,
  deps: t.deps.filter(x => x.type !== 'conditional-blocks').map(x => ({ id: x.id, title: s.tasks.find(y => y.id === x.id)?.title ?? '' })), ...extra })

async function setup(h: Host, d: Deps, task: Task, wt: string) {   // packages[] are hand-written until M5; `setup` runs in the writable jail (network on)
  const pkg = pkgOf(d, task) as any
  const pkgRoot = !pkg || pkg.root === '.' || !pkg.root ? wt : `${wt}/${pkg.root}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}`
  for (const argv of (pkg?.setup ?? []) as string[][]) {
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
  await commit(h, x => (x.plan && epicNext(x.plan.state, 'lost') ? { ...x, plan: { ...x.plan, state: epicNext(x.plan.state, 'lost')! } } : x))
  await emit(h, 'flag.raised', { taskId: s.epic ?? t.id, flag: 'lost-epic' }, { taskId: t.id })
  return deny(`epic branch ${s.plan?.epicBranch} is missing (lost-epic); the epic is blocked, the human re-cuts it from dev or cancels (/cadre resolve)`)
}

// ---- todo -> active: the claim ----
async function claim(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  const spec = d.reg[t.type], pipe = stepsOf(d), first = pipe(t.type)[0]
  if (!s.epic || !s.plan) return deny('no approved epic')
  if (first !== 'worker' && first !== 'explorer' && first !== 'tester') return deny(`${t.id}: type ${t.type} starts at "${first}", which needs the tester step (not enabled yet)`)
  const flag = t.flags.find(f => BLOCKING.test(f)); if (flag) return deny(`${t.id} has flag ${flag}; resolve it first (/cadre resolve)`)
  if (t.condition?.state === 'not-met') return deny(`${t.id} never runs: its condition (${t.condition.on} failed) is not met`)
  if (!(await d.store.ready(s.epic)).includes(t.id)) return deny(`${t.id} is not ready (blocked by a dependency or a gate)`)
  const running = s.tasks.filter(x => x.state === 'active').length
  if (running >= d.cfg.maxParallel) return deny(`maxParallel ${d.cfg.maxParallel} reached (${running} active)`)
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
  if (!role || (role === 'tester' && !d.view)) return deny(`${t.id}: step ${t.step || '?'} is mod-run or has no agent`)
  if (mine.some(a => a.startsWith('~'))) return deny(`${t.id} is being spawned`)
  if (role === 'worker' && stepsOf(d)(t.type).includes('red') && !task.meta['cadre.specCommit']) return deny(`${t.id}: no red record yet; its spec commit is needed before the worker`)
  const live = leaseLive(task, now)
  if (live && !mine.length) return deny(`${t.id} is held by another session (its lease is live)`)
  if (live && mine.some(a => bind[a].role === role && !bind[a].retired)) return deny(`${t.id} is running; it is resumed automatically`)   // retired (core/reuse: context or TTL over) = rebind fresh
  if (t.state === 'blocked' && task.meta['cadre.decision'] === undefined) return deny(`${t.id} is blocked; the human decides first (/cadre resolve)`)
  const spike = kindOf(d.reg[t.type]) === 'spike', wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), branch = task.meta['cadre.branch'] ?? ''
  if (!spike) {
    const how = await ensureWt(h, d, wt, branch)
    if (!how) {   // task branch missing: lost-wip, release to todo; the next claim starts fresh from the epic tip
      await apply(h, { kind: 'release', id: t.id, at: now, actor: 'mod' }, stepsOf(d)); await d.store.release(t.id, d.actor, 'lost-wip').catch(() => {})
      await emit(h, 'flag.raised', { taskId: t.id, flag: 'lost-wip' }, { taskId: t.id })
      return deny(`${t.id}: its branch is gone (lost-wip); it was released, spawn it again for a fresh start`)
    }
    if (how === 'readd') await setup(h, d, task, wt)
  }
  for (const a of mine) { await unbindAgent(h, a); await emit(h, 'agent.unbound', { agentId: a, reason: live ? 'rebind' : 'stale' }, { agentId: a, taskId: t.id }) }
  if (!(await reserve(h, d, t.id, role))) return deny(`${t.id} is being spawned`)
  const undo = async () => { await unbindAgent(h, `~${t.id}`) }
  try {
    if (t.state === 'blocked') await apply(h, { kind: 'unblock', id: t.id, at: now, actor: 'mod' }, stepsOf(d))
    await d.store.resume(t.id, d.actor)
    // computed handoff (never a model summary): checkpoint, diff since the handoff base, last notes
    let handoff = ''
    if (!spike) {
      const cp = (await G.op(h, () => G.commitAll(h.run, wt, `wip(${t.id}): checkpoint`))) ?? (await G.tip(h.run, wt, 'HEAD')), hb = (d.reg[t.type].pipeline.includes('red') && task.meta['cadre.specCommit']) || task.meta['cadre.base'] || cp
      await d.store.setMeta(t.id, { 'cadre.checkpoint': cp }, d.actor)
      handoff = [`checkpoint ${cp}`, await G.diffStat(h.run, wt, `${hb}..${cp}`), await G.diffPatch(h.run, wt, `${hb}..${cp}`), task.meta['cadre.report'] ?? ''].filter(Boolean).join('\n')
    }
    const cwd = spike ? d.root : viewed(d, role) ? await d.view!(h, d, task, wt) : wt
    return await launch(h, d, e, next, t, agentOf(d, role), brief(role, briefOf(s, t, task, e, d, role, { handoff, decisions: task.meta['cadre.decision'] ? [task.meta['cadre.decision']] : undefined })), cwd, t.step, spike ? '' : cwd, undo, task)
  } catch (err) { await undo(); throw err }
}

// ---- review -> reviewing: a fresh reviewer, never a fork, tier by labels ----
async function review(h: Host, d: Deps, e: any, next: (e: any) => any, s: Snapshot, t: SnapTask) {
  if (t.step !== 'reviewer') return deny(`${t.id} passed review; main completes it (TaskUpdate completed)`)
  const task = await d.store.get(t.id), src = task.meta['cadre.sourceCommit']
  if (!src) return deny(`${t.id} has no sourceCommit yet`)
  if (!(await reserve(h, d, t.id, 'reviewer'))) return deny(`${t.id} has a reviewer; it is resumed for re-review automatically`)
  const wt = task.meta['cadre.worktree'] ?? wtPath(d.wtRoot, d.key, t.id), base = task.meta['cadre.base'] ?? src, undo = async () => { await unbindAgent(h, `~${t.id}`) }
  try {
    const diffStat = await G.diffStat(h.run, wt, `${base}..${src}`), diff = await G.diffPatch(h.run, wt, `${base}..${src}`)
    return await launch(h, d, e, next, t, 'reviewer', brief('reviewer', briefOf(s, t, task, e, d, 'reviewer', { sourceCommit: src, diffStat, diff, report: task.meta['cadre.report'], flags: t.flags })), wt, 'reviewer', wt, undo, task)
  } catch (err) { await undo(); throw err }
}

// ---- lease heartbeat (8.4): the tick calls this; bd only, no hooks needed. Beats each of THIS session's bound tasks every `every` ms. ----
export async function beat(h: Host, d: Deps, every = 120_000): Promise<void> {
  const [bind, now] = [await h.bind.read(), await h.now()]
  for (const [a, b] of Object.entries(bind)) {
    if (a.startsWith('~') || b.sessionId !== d.session) continue
    const k = `cadre:hb:${b.taskId}`
    if (now - (((await h.store.get(k)) as number | undefined) ?? 0) < every) continue
    await d.store.heartbeat(b.taskId).catch(err => h.log(`cadre: heartbeat ${b.taskId} failed: ${err}`)); await h.store.set(k, now)
  }
}
