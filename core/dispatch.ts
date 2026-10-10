// Command dispatcher (DESIGN 2.5, 3.1): the only entry for `/cadre` commands. Origin rules, session token, plan@code8 with burn-on-use,
// approve/reject, and the nonce-salted init confirm code. Also the draft<->board mirror shared with native/tasks.ts.
import type { Host, SnapTask } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { StoreError } from '../task-management/store'
import { defaults as typeDefaults, kindOf, merges, pipeOf } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'
import { defaults as cfgDefaults, resolve, envLayer } from '../config/index'
import type { Config } from '../config/index'
import { canon, fnv1a64, stamp, withConditions } from './board'
import { emit } from './events'
import { apply } from './machine'
import { missingList } from './validate'
import { cutEpic } from './branches'

export type Origin = { kind: string; name?: string; token?: string }   // composer | sdk | bridge | plugin | adapter (+ name, token)
export interface Command { schemaVersion: 1; cmd: string; args: string[]; origin: Origin }
export type Out = { text: string }
export type Route = (h: Host, c: Command) => Promise<Out>
// Owner modules fill this at load for subs this file doesn't implement: resolve, release, drive, sync (loop), config (config/), ...
export const ROUTES: Record<string, Route> = {}

// store + config arrive through two optional Host members that register.ts wires (CONTRACTS)
export const storeOf = (h: Host): Promise<TaskStore> => { const f = (h as any).taskStore; if (!f) throw new StoreError('Unavailable', 'no task store'); return f() }
export async function cfgOf(h: Host): Promise<Config> {
  const f = (h as any).config
  return f ? f() : resolve([{ name: 'env', trust: 'user', value: envLayer(await h.env()) }]).config
}
export const registryOf = async (h: Host): Promise<TypeRegistry> => ((await cfgOf(h)).types as TypeRegistry) ?? typeDefaults()

// ---- draft <-> board mirror ----
const BLOCKING = ['blocks', 'waits-for', 'conditional-blocks']
export const snapOf = (t: Task, reg: TypeRegistry): SnapTask => {
  const spec = reg[t.type]
  return { id: t.id, title: t.title, type: t.type, kind: spec ? kindOf(spec) : 'code', merges: spec ? merges(spec) : true, state: t.category, step: t.meta['cadre.step'] ?? '', phaseSince: 0, owner: t.assignee,
    deps: t.deps.filter(d => BLOCKING.includes(d.type)).map(d => ({ id: d.id, type: d.type as SnapTask['deps'][0]['type'] })), flags: [] }
}
// store children of the current epic -> board tasks. Existing board tasks keep their machine state (step, owner, flags, card); title/type/deps follow the store.
export async function mirror(h: Host, store: TaskStore, reg: TypeRegistry): Promise<void> {
  const epic = (await h.board.read()).epic; if (!epic) return
  const all = (await store.list({ parent: epic })).filter(t => t.type !== 'gate')
  await h.board.update(s => withConditions({ ...s, tasks: all.map(t => { const o = s.tasks.find(x => x.id === t.id); return o ? { ...o, ...snapOf(t, reg), state: o.state, step: o.step, phaseSince: o.phaseSince, owner: o.owner, flags: o.flags, card: o.card } : snapOf(t, reg) }) }))
}

// ---- approval token ----
export const draftsOf = async (store: TaskStore, epic: string | null): Promise<Task[]> =>
  epic ? (await store.list({ parent: epic })).filter(t => t.category === 'draft' && t.type !== 'gate') : []
const pick = (t: Task) => ({ id: t.id, title: t.title, description: t.description, acceptance: t.acceptance, design: t.design, type: t.type, deps: t.deps, meta: t.meta })
export const code8Of = (nonce: string, drafts: Task[]): string => fnv1a64(nonce + canon(drafts.map(pick))).slice(0, 8)

// new nonce + code8 over the current drafts (every draft change AND every approve attempt); board.approval gets the missing list. Returns it.
export async function redraw(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> {
  const s = await h.board.read(), drafts = await draftsOf(store, s.epic)
  const missing = s.plan?.slug === 'mission' ? [] : missingList(drafts, reg)
  const nonce = h.rand(8), planId = s.plan?.id ?? null
  await h.secret.update(x => ({ ...x, nonce, approval: planId ? { planId, code8: code8Of(nonce, drafts) } : undefined }))
  await h.board.update(b => ({ ...b, approval: { planId, missing } }))
  return missing
}
// after any draft change: mirror the board, redraw the code, announce, stamp seq. Returns the missing list.
export async function touched(h: Host, store: TaskStore, reg: TypeRegistry): Promise<string[]> {
  await mirror(h, store, reg)
  const missing = await redraw(h, store, reg), s = await h.board.read()
  if (s.plan) await stamp(h, (await emit(h, 'approval.pending', { planId: s.plan.id, missing })).seq)
  return missing
}

// ---- origin ----
// null = human; else the refusal reason. composer (CC-07) | sdk under approval.allowSdk | adapter:<name> with a `commands` grant (user config) + the current session token
export async function isHuman(h: Host, o: Origin): Promise<string | null> {
  if (o.kind === 'composer') return null
  const cfg = await cfgOf(h)
  if (o.kind === 'sdk') return cfg.approval.allowSdk ? null : 'sdk origin is not accepted (approval.allowSdk is off)'
  if (o.kind === 'adapter') {
    const a = cfg.adapters[o.name ?? ''] as { grants?: string[] } | undefined, tok = (await h.secret.read()).token
    return a?.grants?.includes('commands') && tok && o.token === tok ? null : `adapter ${o.name} is not granted commands or the session token is wrong`
  }
  return `origin ${o.kind} is not human`
}
export async function newToken(h: Host): Promise<string> {   // session start and `adapter token`; shown by toast only (UI-26)
  const token = h.rand(8); await h.secret.update(s => ({ ...s, token })); h.toast(`cadre session token: ${token}`); return token
}
const needsHuman = (c: Command): boolean => ['approve', 'reject', 'resolve', 'release', 'init', 'adapter'].includes(c.cmd) || (c.cmd === 'config' && c.args[0] === 'set') || (c.cmd === 'sync' && c.args[0] === 'add') || (c.cmd === 'drive' && c.args[0] !== 'status')

// ---- init confirm code (DESIGN 10.1): nonce-salted, never a hash of the diff alone; burned on every attempt ----
export async function initPropose(h: Host, stage: number, diff: string): Promise<string> {
  const n = h.rand(8), code = fnv1a64(n + diff).slice(0, 8)
  await h.secret.update(s => ({ ...s, initNonce: n, initConfirm: { stage, code } })); return code
}
export async function initConfirm(h: Host, stage: number, code: string): Promise<boolean> {
  let ok = false
  await h.secret.update(s => { ok = s.initConfirm?.stage === stage && s.initConfirm.code === code; const { initConfirm: _c, ...r } = s; return { ...r, initNonce: h.rand(8) } })
  return ok
}

// ---- approve / reject ----
const refuse = (why: string): Out => ({ text: `refused: ${why}` })
async function approve(h: Host, c: Command): Promise<Out> {
  const [planId, code] = (c.args[0] ?? '').split('@'), store = await storeOf(h), reg = await registryOf(h)
  const s = await h.board.read(), sec = await h.secret.read(), drafts = await draftsOf(store, s.epic)
  const why = !s.plan || s.plan.id !== planId ? `no draft plan ${planId}` : !sec.nonce || sec.approval?.planId !== planId || sec.approval.code8 !== code || code8Of(sec.nonce, drafts) !== code ? 'token mismatch: use the code on the band or in the pane' : ''
  const mission = s.plan?.slug === 'mission'
  const missing = why || mission ? [] : missingList(drafts, reg)
  if (why || missing.length) { await redraw(h, store, reg); return refuse(why || `incomplete, missing: ${missing.join('; ')}`) }   // burn on use
  const plan = s.plan!, epic = await store.get(plan.id), at = await h.now()
  if (mission) {
    await store.record('mission', epic.title, epic.description); await store.dropDrafts([plan.id])
    await h.board.update(b => ({ ...b, mission: epic.title, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] } }))
    await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r)
    return { text: `Mission "${epic.title}" approved and recorded.` }
  }
  const ids = drafts.map(t => t.id), first = !plan.approvedAt
  await store.approve(ids)
  await mirror(h, store, reg)   // tasks the board lost (after /clear) come back as drafts; the machine then approves them
  const pipe = pipeOf(reg)
  for (const id of ids) await apply(h, { kind: 'approve', id, at, actor: 'human' }, pipe)
  await store.record('decision', `Approved plan ${plan.id}: ${epic.title}`, drafts.map(t => `- ${t.id} ${t.title} (${t.type})`).join('\n'), plan.id)
  await h.board.update(b => ({ ...b, plan: b.plan && { ...b.plan, state: 'approved', approvedAt: b.plan.approvedAt ?? at }, approval: { planId: null, missing: [] } }))
  await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r)
  let note = ''
  if (first) try { await cutEpic(h, plan.id); note = `; epic branch ${plan.epicBranch} cut` } catch (e) { note = `; epic branch cut failed: ${(e as Error).message}` }
  return { text: `Plan ${plan.id} approved: ${ids.length} task${ids.length === 1 ? '' : 's'} ready${note}.` }
}
async function reject(h: Host, c: Command): Promise<Out> {
  const [planId, ...why] = c.args, store = await storeOf(h), reg = await registryOf(h), s = await h.board.read()
  if (!s.plan || s.plan.id !== planId) return refuse(`no draft plan ${planId}`)
  const drafts = await draftsOf(store, s.epic), fresh = s.plan.state === 'draft'
  await store.dropDrafts([...drafts.map(t => t.id), ...(fresh ? [s.plan.id] : [])])
  await store.record('decision', `Rejected plan ${planId}`, why.join(' ') || 'no reason given', fresh ? undefined : planId)
  if (fresh) await h.board.update(b => ({ ...b, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] } }))
  else await mirror(h, store, reg)
  await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r)
  return { text: `Plan ${planId}: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} dropped.` }
}

// route = the handler for everything else (commands/cadre.ts); a human-only command from a non-human origin is refused before it
export async function dispatch(h: Host, c: Command, route: Route): Promise<Out> {
  if (c.schemaVersion !== 1) return refuse('unsupported command schemaVersion')
  if (needsHuman(c)) {
    const why = await isHuman(h, c.origin)
    if (why) {
      if (c.cmd === 'approve' && c.args[0]?.includes('@')) await redraw(h, await storeOf(h), await registryOf(h)).catch(() => {})
      if (c.cmd === 'init' && c.args[0] === 'confirm') await h.secret.update(({ initConfirm: _c, ...r }) => ({ ...r, initNonce: h.rand(8) }))
      return refuse(why)
    }
  }
  if (c.cmd === 'approve' && c.args[0]?.includes('@')) return approve(h, c)
  if (c.cmd === 'reject') return reject(h, c)
  if (c.cmd === 'adapter' && c.args[0] === 'token') { await newToken(h); return { text: 'New session token drawn; it is shown by toast only.' } }
  return route(h, c)
}
