// Test world for native/dispatch tests: fakeHost + MemoryStore + a recording git `run` + a counter for rand (fakeHost's is constant).
import type { Host } from '../../../types'
import { MemoryStore } from '../../../task-management/adapters/memory/store'
import { types as defaults } from '../../support'
import { fakeHost } from '../../support'
import { dispatch, storeOf } from '../../../core/dispatch'
import { viaEngine } from '../engine'

export const SCEN = [{ id: 'S1', text: 'Given a user When they log in Then a session exists' }]
export const CONTRACT = { items: [{ name: 'login', kind: 'function', params: ['email: string'], returns: 'Session', status: 'new' }] }
export const FULL = { type: 'feature', package: '.', acceptance: SCEN, changelog: { category: 'Added', entry: 'Login' }, contract: CONTRACT, paths: ['src/login.ts'] }

export async function world(o: { env?: Record<string, string>; config?: unknown } = {}) {
  const store = new MemoryStore(() => 1_700_000_000_000); await store.init({ types: defaults(), journal: false })
  const calls: string[][] = []; let n = 0
  const h = Object.assign(fakeHost({ env: o.env }), {
    taskStore: async () => store, ...(o.config ? { config: async () => o.config } : {}),
    rand: (k = 16) => (++n).toString(16).padStart(k * 2, '0'),
    run: async (argv: readonly string[]) => { calls.push([...argv]); return { exitCode: 0, stdout: 'sha1\n', stderr: '' } },
  }) as Host & { logs: string[]; toasts: string[] }
  const call = (tool: string, input: Record<string, any>, agentId?: string) => viaTools(h, tool, input, agentId)
  const text = (c: { cmd: string; args: string[]; origin?: any }) => dispatch(h, { schemaVersion: 1, origin: { kind: 'press' }, ...c }, async () => ({ text: 'routed' }))
  return { h, store, calls, call, text }
}
// plan + one complete task; returns ids
export async function plan(w: Awaited<ReturnType<typeof world>>, meta: Record<string, unknown> = FULL) {
  const p = await w.call('TaskCreate', { subject: 'Auth login', description: 'goal', metadata: { kind: 'plan' } })
  const t = await w.call('TaskCreate', { subject: 'Add login', description: 'impl', metadata: meta })
  return { plan: p.result.task.id as string, task: t.result.task.id as string }
}

// The plan tools driven in the shape older tests were written in (TaskCreate/TaskUpdate/TaskList/TaskGet): every call goes through main's tool as the engine sees it (tests/fixtures/engine.viaEngine),
// and its answer comes back in that shape ({deny} / {result:{task}} / {result:{success, error?}}). An amendment of an approved task gives a reason and evidence.
export async function viaTools(h: Host, tool: string, i: Record<string, any>, agentId?: string): Promise<any> {
  const t = (name: string, a: Record<string, unknown>) => viaEngine(h, { tool: `mcp__cadre__${name}`, tool_use_id: 'u', ...(agentId ? { agentId } : {}), ...a }) as Promise<any>
  const err = (r: any) => (typeof r.result === 'string' && r.result.startsWith('error: ') ? r.result.slice(7) : null), ctx = (r: any) => (r.context ? { context: r.context } : {})
  const m = { ...(i.metadata ?? {}) }, plan = (await h.board.read()).plan
  if (tool === 'TaskCreate') {
    const r = m.kind === 'clarity' ? await t('ask', { clarity: Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'kind')) }) : m.kind === 'preferences' ? await t('preferences', Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'kind')))
      : m.kind ? await t('plan', { title: i.subject, description: i.description, ...m }) : m.size !== undefined && plan && plan.state === 'draft' ? await t('epic', { title: i.subject, goal: i.description, ...m }) : await t('task', { title: i.subject, description: i.description, ...m })
    const e = err(r); return e !== null ? { deny: e } : m.kind === 'clarity' || m.kind === 'preferences' ? r : { result: { task: { id: r.result.id, subject: i.subject } }, ...ctx(r) }
  }
  if (tool === 'TaskList') { const r = await t('status', {}); return { result: { tasks: r.result.tasks.map((x: any) => ({ id: x.id, subject: x.title, status: x.status, ...(x.owner ? { owner: x.owner } : {}), blockedBy: x.after })) } } }
  if (tool === 'TaskGet') { const r = await t('status', { id: i.taskId }), x = r.result; if (err(r)) return { result: { task: null } }; return { result: { task: { ...x, subject: x.subject ?? x.title, blockedBy: x.blockedBy ?? x.after } } } }
  const id = String(i.taskId), out = (r: any) => { const e = err(r); return { result: { success: e === null, taskId: id, updatedFields: [], ...(e !== null ? { error: e } : {}) }, ...ctx(r) } }
  if (i.status === 'completed' || i.status === 'pending' || i.status === 'deleted') return out(await t('status', { id, set: i.status, ...(m.reason ? { reason: m.reason } : {}) }))
  if (m.choice !== undefined || m.args !== undefined) return out(await t('status', JSON.parse(JSON.stringify({ id, choice: m.choice, args: m.args, reason: m.reason }))))
  if (m.planned !== undefined) return out(await t('epic', { id, planned: m.planned }))
  if (i.addBlocks?.length) for (const b of i.addBlocks) { const r = await viaTools(h, 'TaskUpdate', { taskId: b, addBlockedBy: [id] }, agentId); if (!r.result.success) return { ...r, result: { ...r.result, taskId: id } } }
  const { amend, ...f } = m, rev = plan ? Number((await (await storeOf(h)).get(plan.id)).meta['cadre.rev'] ?? 0) : 0, edits = { ...(i.subject !== undefined ? { title: i.subject } : {}), ...(i.description !== undefined ? { description: i.description } : {}), ...f, ...(i.addBlockedBy?.length ? { after: i.addBlockedBy } : {}) }
  if (!Object.keys(edits).length) return out({ result: { id } })
  return out(await t('amend', { id, expectedRevision: rev, ...edits, ...(amend ? { reason: 'the test amends it', evidence: 'the test' } : {}) }))
}
export const taskCall = (h: Host, e: Record<string, any>, _next?: unknown) => viaTools(h, e.tool, e, e.agentId)
