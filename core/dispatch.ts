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
import { ask, settle, settleIf } from './decide'
import { scoped } from '../commands/init'
import { apply, epicNext } from './machine'
import { missingList } from './validate'
import { cutEpic } from './branches'
import * as G from './git'

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

// the recorded mission (stage 3 / approve of a mission draft): the newest open milestone. A new session's board is cold, beads is the truth.
export async function missionOf(store: TaskStore): Promise<string | null> {
  const ms = (await store.list({})).filter(t => t.type === 'milestone' && t.category !== 'done' && t.category !== 'cancelled').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return ms[0]?.title ?? null
}

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
  if (!planId || missing.length) await settleIf(h, 'plan:')   // nothing to approve yet
  else {
    const sc = (t: Task) => (t.acceptance ?? '').split('\n').filter(Boolean).length, m = s.plan?.slug === 'mission' ? await store.get(planId).catch(() => null) : null   // a mission card shows the mission itself
    await ask(h, { id: `plan:${planId}`, kind: 'plan', title: m ? `approve the mission · ${m.title}` : `approve plan ${planId} · ${drafts.length} tasks`, short: m ? 'approve the mission' : `approve ${planId} (${drafts.length} tasks)`, tab: m ? 'epic' : 'plan', fallback: `/cadre approve ${planId}@{code}`, hash: fnv1a64(canon(drafts.map(pick)) + (m ? m.title + m.description : '')),
      lines: m ? (m.description || m.title).split('\n').filter(Boolean).slice(0, 8) : [`${drafts.length} tasks · ${drafts.reduce((n, t) => n + sc(t), 0)} scenarios`, ...drafts.slice(0, 5).map(t => `  ${t.id} ${t.type} ${t.title} · ${sc(t)} scenarios`), ...(drafts.length > 5 ? [`  +${drafts.length - 5} more (open the Plan tab)`] : [])],
      options: [{ key: 'a', label: 'Approve', verb: 'approve', run: `approve ${planId}@{code}` }, { key: 'x', label: 'Reject', verb: 'reject', run: `reject ${planId} rejected in the pane` }, { key: 'c', label: 'Change', verb: 'change', fill: `Change ${planId}: ` }] }, code8Of(nonce, drafts))
  }
  return missing
}
// the approval sheet data ui/ draws (UI-DESIGN 5.3), on the human view as `board.sheet`; `before` = the prior accepted contract of a changed symbol (closed tasks' design), else absent
const sig = (s: any) => `${s.name}(${(s.params ?? []).join(', ')}) -> ${s.returns}`
async function sheetOf(store: TaskStore, drafts: Task[], reg: TypeRegistry) {
  const rows = drafts.map(t => ({ t, d: t.design ? JSON.parse(t.design) : null })), prior = new Map<string, string>()
  if (rows.some(r => r.d?.symbols?.some((x: any) => x.status === 'changed'))) for (const c of await store.list({})) if (c.category === 'done' && c.design) for (const x of JSON.parse(c.design).symbols ?? []) prior.set(x.name, sig(x))
  return rows.map(({ t, d }) => {
    const cl = t.meta['cadre.changelog'] ? JSON.parse(t.meta['cadre.changelog']) : null
    return { id: t.id, title: t.title, type: t.type, scope: t.meta['cadre.scope'] || undefined, package: t.meta['cadre.package'] || undefined, tdd: reg[t.type]?.pipeline.includes('red') ? 'required' : 'off',
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
  if (s.plan) await stamp(h, (await emit(h, 'approval.pending', { planId: s.plan.id, missing })).seq)
  return missing
}

// ---- origin ----
// null = human; else the refusal reason. composer (CC-07) | sdk under approval.allowSdk | adapter:<name> with a `commands` grant (user config) + the current session token
export async function isHuman(h: Host, o: Origin): Promise<string | null> {
  if (o.kind === 'composer' || o.kind === 'press') return null   // a Button press cannot be synthesized by code or a model (UI-17); commands/cadre.run never lets an engine origin claim it (ADR 0008)
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
// agent-run setup/init (commands/agentrun fills these at load; core never imports commands/agentrun: a load cycle)
export const RUN: { recheck?(h: Host): Promise<string>; cancel?(h: Host, kind: string): Promise<void> } = {}
const needsHuman = (c: Command): boolean => ['approve', 'reject', 'resolve', 'release', 'restore', 'init', 'setup', 'adapter'].includes(c.cmd) || (c.cmd === 'config' && c.args[0] === 'set') || (c.cmd === 'sync' && c.args[0] === 'add') || (c.cmd === 'drive' && c.args[0] !== 'status')

// ---- init confirm code (DESIGN 10.1): nonce-salted, never a hash of the diff alone; burned on every attempt ----
// `d` (optional) is what the human sees: sub = the command the buttons run (`init`, `setup`, `sync add <name>`); `change` = the re-plan command (none: no Cancel/Change, e.g. sync add)
export async function initPropose(h: Host, stage: number, diff: string, d?: { title: string; short?: string; lines: string[]; sub: string; change?: string }): Promise<string> {
  const n = h.rand(8), code = fnv1a64(n + diff).slice(0, 8)
  await h.secret.update(s => ({ ...s, initNonce: n, initConfirm: { stage, code } }))
  if (d) await ask(h, { id: `init:${stage}`, kind: 'init', title: d.title, short: d.short, lines: d.lines, hash: fnv1a64(diff), tab: 'epic', fallback: `/cadre ${d.sub} confirm {code}`,
    options: [{ key: 'a', label: 'Confirm', verb: 'approve', run: `${d.sub} confirm {code}` }, ...(d.change ? [{ key: 'x', label: 'Cancel', verb: 'reject', run: `${d.sub} cancel` }, { key: 'c', label: 'Change', verb: 'change', run: d.change }] : [])] }, code)
  return code
}
export async function initConfirm(h: Host, stage: number, code: string): Promise<boolean> {
  let ok = false
  await h.secret.update(s => { ok = s.initConfirm?.stage === stage && s.initConfirm.code === code; const { initConfirm: _c, ...r } = s; return { ...r, initNonce: h.rand(8) } })
  await settle(h, `init:${stage}`); return ok
}

// ---- approve / reject ----
const refuse = (why: string): Out => ({ text: `refused: ${why}` })
// human gates (3.3): an open `gate` child of the epic is approved like a plan: its own nonce-salted code, burned on every attempt
export const gateOf = async (store: TaskStore, id: string): Promise<Task | null> => { const g = await store.get(id).catch(() => null); return g && g.type === 'gate' && !['done', 'cancelled'].includes(g.category) ? g : null }
export async function gateDraw(h: Host, g: Task): Promise<void> {
  const nonce = h.rand(8)
  await h.secret.update(x => ({ ...x, nonce, approval: { planId: g.id, code8: code8Of(nonce, [g]) } })); await h.board.update(b => ({ ...b, approval: { planId: g.id, missing: [] } }))
  await ask(h, { id: `gate:${g.id}`, kind: 'gate', title: `approve gate ${g.id} · ${g.title}`, short: `approve gate ${g.id}`, tab: 'epic', sel: g.id, fallback: `/cadre approve ${g.id}@{code}`, hash: fnv1a64(g.title + (g.description ?? '')),
    lines: [g.title, ...(g.description ?? '').split('\n').filter(Boolean).slice(0, 4), 'a human gate: the work after it waits for you'],
    options: [{ key: 'a', label: 'Approve', verb: 'approve', run: `approve ${g.id}@{code}` }, { key: 'c', label: 'Change', verb: 'change', fill: `Change ${g.id}: ` }] }, code8Of(nonce, [g]))
}
async function approveGate(h: Host, store: TaskStore, reg: TypeRegistry, g: Task, code: string): Promise<Out> {
  const sec = await h.secret.read()
  if (!sec.nonce || sec.approval?.planId !== g.id || sec.approval.code8 !== code || code8Of(sec.nonce, [g]) !== code) { await gateDraw(h, g); return refuse('token mismatch: use the code on the band or in the pane') }
  await store.resolveGate(g.id, 'approved by the human')
  await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r); await h.board.update(b => ({ ...b, approval: { planId: null, missing: [] } }))
  await settle(h, `gate:${g.id}`); await mirror(h, store, reg); return { text: `Gate ${g.id} approved.` }
}
async function approve(h: Host, c: Command): Promise<Out> {
  const [planId, code] = (c.args[0] ?? '').split('@'), store = await storeOf(h), reg = await registryOf(h)
  const gate = (await h.board.read()).plan?.id === planId ? null : await gateOf(store, planId); if (gate) return approveGate(h, store, reg, gate, code)
  const s = await h.board.read(), sec = await h.secret.read(), drafts = await draftsOf(store, s.epic)
  const why = !s.plan || s.plan.id !== planId ? `no draft plan ${planId}` : !sec.nonce || sec.approval?.planId !== planId || sec.approval.code8 !== code || code8Of(sec.nonce, drafts) !== code ? 'token mismatch: use the code on the band or in the pane' : ''
  const mission = s.plan?.slug === 'mission'
  const missing = why || mission ? [] : missingList(drafts, reg)
  if (why || missing.length) { await redraw(h, store, reg); return refuse(why || `incomplete, missing: ${missing.join('; ')}`) }   // burn on use
  const plan = s.plan!, epic = await store.get(plan.id), at = await h.now()
  if (mission) {
    await store.record('mission', epic.title, epic.description); await store.dropDrafts([plan.id])
    await h.board.update(b => ({ ...b, mission: epic.title, plan: null, epic: null, tasks: [], approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
    await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r); await settleIf(h, 'plan:')
    const more = await (RUN.recheck?.(h) ?? Promise.resolve('')).then(t => t && ` · ${t}`)   // an init run: re-check now (done, or a follow-up for main)
    return { text: `Mission "${epic.title}" approved and recorded${more || '.'}` }
  }
  const ids = drafts.map(t => t.id), first = !plan.approvedAt
  await store.approve(ids)
  for (const t of drafts) if (t.meta['cadre.amended']) await store.setMeta(t.id, { 'cadre.amended': '' }, 'human')
  await mirror(h, store, reg)   // tasks the board lost (after /clear) come back as drafts; the machine then approves them
  const pipe = pipeOf(reg)
  for (const id of ids) await apply(h, { kind: 'approve', id, at, actor: 'human' }, pipe)
  await store.record('decision', `Approved plan ${plan.id}: ${epic.title}`, drafts.map(t => `- ${t.id} ${t.title} (${t.type})`).join('\n'), plan.id)
  await h.board.update(b => ({ ...b, plan: b.plan && { ...b.plan, state: 'approved', approvedAt: b.plan.approvedAt ?? at }, approval: { planId: null, missing: [] }, sheet: [] }) as typeof b)
  await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r); await settleIf(h, 'plan:')
  let note = ''
  if (first) try { await cutEpic(h, plan.id, (await cfgOf(h)).branches.dev); note = `; epic branch ${plan.epicBranch} cut` } catch (e) { note = `; epic branch cut failed: ${(e as Error).message}` }
  return { text: `Plan ${plan.id} approved: ${ids.length} task${ids.length === 1 ? '' : 's'} ready${note}.` }
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
  await h.secret.update(({ approval: _a, nonce: _n, ...r }) => r); await settleIf(h, 'plan:')
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

// route = the handler for everything else (commands/cadre.ts); a human-only command from a non-human origin is refused before it
export async function dispatch(h: Host, c: Command, route: Route): Promise<Out> {
  if (c.schemaVersion !== 1) return refuse('unsupported command schemaVersion')
  if (needsHuman(c)) {
    const why = await isHuman(h, c.origin)
    if (why) {
      if (c.cmd === 'approve' && c.args[0]?.includes('@')) await redraw(h, await storeOf(h), await registryOf(h)).catch(() => {})
      if ((c.cmd === 'init' || c.cmd === 'setup') && c.args[0] === 'confirm') { await h.secret.update(({ initConfirm: _c, ...r }) => ({ ...r, initNonce: h.rand(8) })); await settleIf(h, 'init:') }
      return refuse(why)
    }
  }
  if ((c.cmd === 'init' || c.cmd === 'setup') && c.args[0] === 'cancel') { await h.secret.update(({ initConfirm: _c, ...r }) => ({ ...r, initNonce: h.rand(8) })); await settleIf(h, 'init:'); await RUN.cancel?.(h, c.cmd); return { text: `${c.cmd}: cancelled` } }   // the card's Cancel: burns the code, ends the run and its lease
  if (c.cmd === 'approve' && c.args[0]?.includes('@')) return approve(h, c)
  if (c.cmd === 'reject') return reject(h, c)
  if (c.cmd === 'adapter' && c.args[0] === 'token') { await newToken(h); return { text: 'New session token drawn; it is shown by toast only.' } }
  return route(h, c)
}
