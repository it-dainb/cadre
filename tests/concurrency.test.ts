// core/queue: the one slot count. A slot belongs to the task; model and provider keys count running runs; FIFO per key with skip-ahead; heads before new claims.
import { describe, expect, test } from 'claude-code/testing'
import { defaults } from '../config/index'
import { clamped, drop, grant, hold, limitOf, providerOf, running, tasksFull, unitCap, type Want } from '../core/queue'
import { fakeHost } from './support'
import { arm } from '../core/drive'
import { world } from './fixtures/replay/world'

const cfg = (c: Partial<ReturnType<typeof defaults>['concurrency']> = {}, units: unknown[] = []) => { const d = defaults(); d.concurrency = { ...d.concurrency, ...c }; d.units = units as any; return d }
const claim = (id: string, model: string, unit?: string): Want => ({ id, role: 'claim', model, unit })
const ids = (g: Want[]) => g.map(w => w.id)
const board = (...active: string[]) => ({ tasks: active.map(id => ({ id, state: 'active' })) })

describe('queue', () => {
  test('a task in review (the worker reported, the reviewer runs or the merge waits) still holds its slot at concurrency.default', () => {
    const c = cfg({ default: 1 }), s = { tasks: [{ id: 'a', state: 'review' }] }
    expect(ids(grant(c, 'anthropic', s, [], [claim('b', 'haiku')]))).toEqual([]); expect(tasksFull(c, s)).toBe(true)
  })
  test('settings: concurrency.models: FIFO per key, skip-ahead across keys', () => {
    const c = cfg({ default: 9, models: { haiku: 1 } }), ws = [claim('a', 'haiku'), claim('b', 'haiku'), claim('c', 'sonnet'), claim('d', 'haiku')]
    expect(ids(grant(c, 'anthropic', board(), [], ws))).toEqual(['a', 'c'])   // b waits behind a; c skips ahead; d never passes b
    expect(ids(grant(c, 'anthropic', board('a'), ['haiku'], ws.slice(1)))).toEqual(['c'])   // a runs: b still waits
    expect(ids(grant(c, 'anthropic', board('c'), ['sonnet'], ws.slice(1, 2)))).toEqual(['b'])   // a ended: b goes first
    expect(ids(grant(cfg({ default: 9, models: { haiku: 1 } }), 'anthropic', board(), [], [claim('x', 'haiku[1m]'), claim('y', 'haiku')]))).toEqual(['x'])   // [1m] is the same key
  })
  test('settings: concurrency.providers: one cap over every model of the provider; a model key beats it', () => {
    const c = cfg({ default: 9, providers: { bedrock: 1 }, models: { opus: 2 } })
    expect(ids(grant(c, 'bedrock', board(), [], [claim('a', 'haiku'), claim('b', 'sonnet')]))).toEqual(['a'])
    expect(ids(grant(c, 'bedrock', board(), [], [claim('a', 'opus'), claim('b', 'opus'), claim('c', 'opus')]))).toEqual(['a', 'b'])
    expect(ids(grant(c, 'anthropic', board(), [], [claim('a', 'haiku'), claim('b', 'sonnet')]))).toEqual(['a', 'b'])   // another provider: no key, the task count only
  })
  test('the limit of a model: its key, else its provider, else the task count', () => {
    const c = cfg({ default: 4, models: { haiku: 1 }, providers: { anthropic: 2 } }).concurrency
    expect([limitOf(c, 'haiku', 'anthropic'), limitOf(c, 'opus', 'anthropic'), limitOf(c, 'opus', 'vertex')]).toEqual([{ by: 'model', n: 1 }, { by: 'provider', n: 2 }, { by: 'default', n: 4 }])
    expect([providerOf({}), providerOf({ CLAUDE_CODE_USE_BEDROCK: '1' }), providerOf({ CLAUDE_CODE_USE_VERTEX: '1' })]).toEqual(['anthropic', 'bedrock', 'vertex'])
  })
  test('the task count: default counts tasks, a claim still starting counts, 0 is no cap', () => {
    const c = cfg({ default: 2 }), ws = [claim('a', 'haiku'), claim('b', 'haiku'), claim('c', 'haiku')]
    expect(ids(grant(c, 'anthropic', board('x'), [], ws))).toEqual(['a'])
    hold(ws[0]); try { expect(ids(grant(c, 'anthropic', board('x'), [], ws.slice(1)))).toEqual([]) } finally { drop('a', 'claim') }
    expect(ids(grant(cfg({ default: 0 }), 'anthropic', board('x', 'y', 'z'), [], ws))).toEqual(['a', 'b', 'c'])
  })
  test('a resume or a next step goes before a new claim of its model; a waiting run is never counted', async () => {
    const c = cfg({ default: 1, models: { haiku: 1 } }), step: Want = { id: 'a', role: 'worker', model: 'haiku', head: true }
    expect(ids(grant(c, 'anthropic', board(), [], [claim('b', 'haiku'), step]))).toEqual(['a'])   // the claim waits behind the step
    expect(ids(grant(c, 'anthropic', board('a'), [], [claim('b', 'sonnet'), { id: 'a', role: 'helper', model: 'haiku', head: true }]))).toEqual(['a'])   // default 1: the task holds the slot, its helper needs none
    const h = fakeHost(); await h.bind.update(() => ({ w: { taskId: 'a' }, v: { taskId: 'b' }, u: { taskId: 'c' } } as any))
    await h.ui.update(u => ({ ...u, runs: { w: { state: { state: 'waiting', on: 'need' }, model: 'haiku' }, v: { state: { state: 'running' }, model: 'sonnet' }, u: { state: { state: 'ended', cause: 'done' }, model: 'opus' } } }))
    expect(await running(h)).toEqual(['sonnet'])
  })
  test('a unit cap above the global one is clamped, and caps the unit', () => {
    const u = [{ root: 'a', concurrency: 5 }, { root: 'b', concurrency: 1 }], c = cfg({ default: 2 }, u)
    expect([unitCap(c.concurrency, u[0]), unitCap(c.concurrency, u[1]), unitCap(cfg({ default: 0 }).concurrency, u[0])]).toEqual([2, 1, 5])
    expect(clamped(c)).toEqual(['unit a: concurrency 5 is held to 2 (concurrency.default)'])
    expect(ids(grant(c, 'anthropic', { tasks: [{ id: 'x', state: 'active' }] }, [], [claim('p', 'haiku', 'b'), claim('q', 'haiku', 'a')], { x: 'b' }))).toEqual(['q'])   // b is at its cap of 1
  })
  const REQ = { role: 'worker', outcome: 'request', summary: 'need a look', request: { helper: 'explore', ask: 'where is the parser?', why: 'I change it' } }
  test('default=1: worker -> needs explore -> helper -> resume -> lands on the one slot, also with models.haiku=1 and a haiku helper (a waiting run is not counted)', async () => {
    for (const models of [{}, { haiku: 1 }]) {
      const w = await world(); w.cfg.concurrency = { default: 1, models, providers: {} }; w.cfg.roles.worker.byRisk = Object.fromEntries(Object.entries(w.cfg.roles.worker.byRisk).map(([k, v]) => [k, { ...v, model: 'haiku' }])) as any
      await arm(w.h, 'auto'); await w.turn(); await w.rep('ag1', REQ); await w.turn(); expect(w.spawned.map(x => x[2])).toEqual(['cadre:worker', 'cadre:explorer'])
      await w.rep('ag2', { role: 'explorer', answer: 'in src/parse.ts', citations: [] }); await w.stop('ag2'); expect(w.sent.map(x => x[0])).toEqual(['ag1'])
      await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn(); await w.rep('ag3', { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', test: 'test/a.test.js', ok: true }], contractStatus: [] }); await w.turn()
      expect((await w.h.board.read()).tasks[0].state).toBe('done')   // it lands
    }
  })
})
