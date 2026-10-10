import { describe, expect, test } from 'claude-code/testing'
import { SPECS, TOOLS, handle, handleWith } from '../tools/index'
import { observeWith, report } from '../core/close'
import { LIFECYCLE } from '../native/tasks'
import { ROUTES } from '../core/dispatch'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fakeHost, task } from './support'

const deps = (store: MemoryStore) => ({ store, cfg: defaults(), reg: defaults().types as any, root: '/repo', home: '/home/u', wtRoot: '/wt', key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' })

describe('MCP tool specs (5.2)', () => {
  test('three tools, never deferred, strict schemas, report requires schemaVersion', () => {
    expect(SPECS.map(s => s.name)).toEqual([...TOOLS])
    for (const s of SPECS) { expect(s.isDeferred).toBe(false); expect((s.inputSchema as any).additionalProperties).toBe(false); expect((s.inputSchema as any).properties.schemaVersion).toEqual({ type: 'integer', enum: [1] }) }
    expect((SPECS[0].inputSchema as any).required).toEqual(['schemaVersion', 'role'])
  })
  test('handle passes other tools through; lifecycle + resolve are registered', async () => {
    expect(await handle(fakeHost(), { tool: 'Read' }, (e: any) => `next:${e.tool}`)).toBe('next:Read')
    expect(Object.keys(LIFECYCLE).sort()).toEqual(['completed', 'decision', 'deleted', 'pending'])
    expect(typeof ROUTES.resolve).toBe('function')
  })
})

describe('report refusals (kit, no git)', () => {
  const w = async () => { const store = new MemoryStore(); await store.init({ types: {} as any, journal: false }); return { h: fakeHost(), d: deps(store) } }
  test('main and unbound agents cannot report; a bad envelope is refused with an example and counts retries', async () => {
    const { h, d } = await w(), call = (agentId: string | undefined, input: any) => handleWith(h, d as any, { tool: 'mcp__cadre__report', agentId, input }).then(r => r.result)
    expect(await call(undefined, { schemaVersion: 1, role: 'worker' })).toBe('error: only a spawned agent reports')
    expect(await call('a1', { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 's' })).toContain('no task is bound to this agent')
    expect(await call('a1', { schemaVersion: 2, role: 'worker' })).toContain('schemaVersion: expected 1, got 2 (attempt')
    await expect(report(h, d as any, 'a1', { role: 'worker' })).rejects.toThrow('no task is bound')
  })
  test('role mismatch and a step that already reported are refused', async () => {
    const { h, d } = await w(); await h.bind.update(b => ({ ...b, a1: { taskId: 't1', role: 'worker', step: 'worker', worktree: '/wt/t1', sessionId: 's1', ctxTokens: 0, startedAt: 0 } }))
    await h.board.update(s => ({ ...s, tasks: [task('t1', { state: 'review', step: 'reviewer' })] }))
    await expect(report(h, d as any, 'a1', { role: 'reviewer' })).rejects.toThrow('bound as worker')
    await expect(report(h, d as any, 'a1', { role: 'worker', outcome: 'done' })).rejects.toThrow('nothing to report at your step')
  })
})

describe('observe (#2)', () => {
  test('passes the event on; a main turn and an unbound agent do nothing', async () => {
    const store = new MemoryStore(); await store.init({ types: {} as any, journal: false }); const h = fakeHost()
    expect(await observeWith(h, deps(store) as any, { reason: 'answer' }, (e: any) => `n:${e.reason}`)).toBe('n:answer')
    expect(await observeWith(h, deps(store) as any, { agentId: 'zz', reason: 'answer' }, (e: any) => 'ok')).toBe('ok')
  })
})
