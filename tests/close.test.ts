import { describe, expect, test } from 'claude-code/testing'
import { SPECS, TOOLS, handle, handleWith } from '../tools/index'
import { followups, observeWith, report } from '../core/close'
import { LIFECYCLE } from '../core/plantools'
import { ROUTES } from '../core/dispatch'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fakeHost, task } from './support'

const deps = (store: MemoryStore) => ({ store, cfg: defaults(), reg: defaults().types as any, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' })

describe('MCP tool specs (5.2)', () => {
  test('three tools, never deferred, strict schemas, report requires schemaVersion', () => {
    expect(SPECS.map(s => s.name)).toEqual([...TOOLS])
    for (const s of SPECS) { expect(s.isDeferred).toBe(false); expect((s.inputSchema as any).additionalProperties).toBe(false); expect((s.inputSchema as any).properties.schemaVersion).toEqual({ type: 'integer', enum: [1] }) }
    expect((SPECS[0].inputSchema as any).required).toEqual(['schemaVersion', 'role'])
  })
  test('handle passes other tools through; lifecycle + resolve are registered', async () => {
    expect(await handle(fakeHost(), { tool: 'Read' }, (e: any) => `next:${e.tool}`)).toBe('next:Read')
    expect(await handle(fakeHost(), { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker' } }, () => { throw new Error('answered') })).toEqual({ deny: 'error: only a spawned agent reports' })   // a refusal is an error result
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

describe('discovered work (3.1)', () => {
  test('followups (≤5, titled) become drafts in one lazily created cadre-backlog epic, discovered-from the task', async () => {
    const store = new MemoryStore(); await store.init({ types: {} as any, journal: false }); const d = deps(store) as any
    const epic = await store.createEpic('E', 'g'), t = (await store.createDraft({ title: 't', description: 'd', type: 'feature', parent: epic })).id
    await followups(d, t, [{ title: 'a', description: 'x' }, { description: 'no title' }, ...Array.from({ length: 6 }, (_, i) => ({ title: `b${i}` }))])
    await followups(d, t, [{ title: 'c' }]); await followups(d, t, undefined)
    const all = await store.list({}), bl = all.filter(x => x.title === 'cadre-backlog'), ds = all.filter(x => x.parent === bl[0].id)
    expect(bl.length).toBe(1); expect(ds.map(x => x.title)).toEqual(['a', 'b0', 'b1', 'b2', 'c'])
    expect(ds.every(x => x.category === 'draft' && x.deps.some(y => y.type === 'discovered-from' && y.id === t))).toBe(true)
  })
})

// ---- S4: a run's end follows its role's spec (core/close.endedRun, RoleSpec.onSilent: S0 gap G1), not the role's name ----
import { world, PASS } from './fixtures/replay/world'
import { roles } from '../profiles/default'
import { setRoles } from '../core/roles'
import { budgetOf, runOf } from '../core/lifecycle'
import { arm } from '../core/drive'

describe('endedRun: onSilent nudge | block | retry', () => {
  const as = async (onSilent: 'nudge' | 'block' | 'retry', f: () => Promise<void>) => { setRoles({ ...roles, worker: { ...roles.worker, onSilent } }); try { await f() } finally { setRoles(roles) } }
  const flags = async (w: any, id: string) => (await w.h.board.read()).tasks.find((t: any) => t.id === id)
  test('nudge: nudged limits.nudges times with the role\'s own text, then blocked with no-report', () => as('nudge', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.stop('ag1'); expect(w.sent).toEqual([['ag1', roles.worker.nudge!]]); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'silent', n: 1 })
    await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'blocked' }); expect(await flags(w, id)).toMatchObject({ state: 'blocked', flags: ['no-report'] })
  }))
  test('block: no nudge, the first silent end blocks the task', () => as('block', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.stop('ag1'); expect(w.sent).toEqual([]); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'blocked' }); expect(await flags(w, id)).toMatchObject({ state: 'blocked', flags: ['no-report'] })
  }))
  test('retry: nudged, then the run ends released: no flag, no silentRuns charge, the task is given back (the role name is not what decides)', () => as('retry', async () => {
    const w = await world(), [id] = w.ids; await w.at('ag1', id, 'worker')
    await w.stop('ag1'); expect(w.sent.length).toBe(1)
    await w.stop('ag1'); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'ended', cause: 'released' })
    expect((await flags(w, id)).flags).toEqual([]); expect((await budgetOf(w.h, id)).silentRuns ?? 0).toBe(0); expect((await flags(w, id)).owner).toBeUndefined()
  }))
  test('the built-in reviewer is a retry role: a silent reviewer is released, never blocked (1.0.1)', () => { expect(roles.reviewer.onSilent).toBe('retry'); expect(['worker', 'tester', 'explorer'].map(r => roles[r].onSilent)).toEqual(['nudge', 'nudge', 'nudge']) })
})

describe('a reviewer pass that misses coverage is refused (acceptance cover:\'report\': the reviewer\'s own coverage, ADR 0022)', () => {
  test('a scenario the reviewer did not mark ok is refused with the scenario named; marked ok it passes', async () => {
    const w = await world({ n: 1, drive: 'auto' }); await arm(w.h, 'auto'); await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn()
    expect(await w.rep('ag2', { ...PASS, coverage: [{ scenario: 'S1', ok: false }] })).toContain('scenario S1 is not covered by a test that checks it')
    expect(await w.rep('ag2', PASS)).not.toContain('is not covered')
  })
})
