// Test world for native/dispatch tests: fakeHost + MemoryStore + a recording git `run` + a counter for rand (fakeHost's is constant).
import type { Host } from '../../../types'
import { MemoryStore } from '../../../task-management/adapters/memory/store'
import { defaults } from '../../../task-management/registry'
import { fakeHost } from '../../support'
import { dispatch } from '../../../core/dispatch'
import { answer } from '../../../native/tasks'

export const SCEN = ['S1: Given a user When they log in Then a session exists']
export const CONTRACT = { symbols: [{ name: 'login', kind: 'function', params: ['email: string'], returns: 'Session', status: 'new' }] }
export const FULL = { type: 'feature', package: '.', scenarios: SCEN, changelog: { category: 'Added', entry: 'Login' }, interface: CONTRACT }

export async function world(o: { env?: Record<string, string>; config?: unknown } = {}) {
  const store = new MemoryStore(() => 1_700_000_000_000); await store.init({ types: defaults(), journal: false })
  const calls: string[][] = []; let n = 0
  const h = Object.assign(fakeHost({ env: o.env }), {
    taskStore: async () => store, ...(o.config ? { config: async () => o.config } : {}),
    rand: (k = 16) => (++n).toString(16).padStart(k * 2, '0'),
    run: async (argv: readonly string[]) => { calls.push([...argv]); return { exitCode: 0, stdout: 'sha1\n', stderr: '' } },
  }) as Host & { logs: string[]; toasts: string[] }
  const call = (tool: string, input: Record<string, unknown>, agentId?: string) => answer(h, { tool, tool_use_id: 'u', ...(agentId ? { agentId } : {}), ...input }, async () => 'NEXT') as Promise<any>
  const text = (c: { cmd: string; args: string[]; origin?: any }) => dispatch(h, { schemaVersion: 1, origin: { kind: 'press' }, ...c }, async () => ({ text: 'routed' }))
  return { h, store, calls, call, text }
}
// plan + one complete task; returns ids
export async function plan(w: Awaited<ReturnType<typeof world>>, meta: Record<string, unknown> = FULL) {
  const p = await w.call('TaskCreate', { subject: 'Auth login', description: 'goal', metadata: { kind: 'plan' } })
  const t = await w.call('TaskCreate', { subject: 'Add login', description: 'impl', metadata: meta })
  return { plan: p.result.task.id as string, task: t.result.task.id as string }
}
