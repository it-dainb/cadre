import { describe, expect, test } from 'claude-code/testing'
import { landed, ledger, metricsOf, metricsText, meter } from '../core/reuse'
import { charge, prune } from '../core/lifecycle'
import { scoped } from '../commands/init'
import { parse, route, run } from '../commands/cadre'
import { defaults } from '../config/index'
import { fakeHost } from './support'

const B = (taskId: string) => ({ taskId, role: 'worker', step: 'worker', worktree: '/wt', sessionId: 's', ctxTokens: 0, startedAt: 0 })
const use = (h: any, agentId: string, n: number) => { const g = meter(h, { agentId }, async function* () { return { usage: { input_tokens: n, output_tokens: 0 } } } as any); return g.next().then(async function f(r: any): Promise<void> { if (!r.done) return f(await g.next()) }) }
const key = (h: any) => scoped(h, 'metrics')
const mk = () => Object.assign(fakeHost(), { cwd: async () => '/repo' }) as any

describe('H12 per-repo metrics', () => {
  test('agent 1 is unbound before agent 2 runs: the record holds both costs', async () => {
    const h = mk(); await h.bind.update(() => ({ a1: B('t1') })); await use(h, 'a1', 100)
    await h.bind.update(() => ({})); await h.bind.update(() => ({ a2: B('t1') })); await use(h, 'a2', 50)
    await landed(h, defaults(), 't1')
    const [r] = await metricsOf(h); expect(r.tokens).toBe(150); expect(r.task).toBe('t1'); expect(r.end).toBeGreaterThanOrEqual(r.start)
  })
  test('the record survives prune while the Budget is gone; firstTry only at zero rework', async () => {
    const h = mk(); await use(h, 'x', 1)   // unbound: no task total
    await charge(h, 't1', 'rework'); await landed(h, defaults(), 't1'); await landed(h, defaults(), 't2')
    await prune(h, 't1', []); await prune(h, 't2', [])
    expect((await metricsOf(h)).map(r => [r.task, r.rework, r.firstTry])).toEqual([['t1', 1, false], ['t2', 0, true]])
    expect(await h.store.get('cadre:cost:x')).toBeDefined()
  })
  test('an empty repo renders empty, not NaN; the text is per-task averages', async () => {
    expect(metricsText([])).toBe('metrics: no landed tasks yet')
    const t = metricsText([{ tokens: 10, rework: 0, firstTry: true, start: 0, end: 120000 }, { tokens: 30, rework: 2, firstTry: false, start: 0, end: 240000 }])
    expect(t).toBe('2 landed · 20 tokens/task · first-try 50% · rework 1.0/task · 3 min/task'); expect(t).not.toContain('NaN')
  })
  test('the 501st record evicts the oldest', async () => {
    const h = mk(); for (let i = 0; i < 501; i++) await landed(h, defaults(), `t${i}`)
    const rs = await metricsOf(h); expect(rs.length).toBe(500); expect(rs[0].task).toBe('t1'); expect(rs[499].task).toBe('t500'); expect((await h.store.get(await key(h)) as unknown[]).length).toBe(500)
  })
  test('/cadre timeline: registered, the human types it, writes a project-relative export', async () => {
    expect(parse('timeline')).toEqual({ cmd: 'timeline', args: [] })
    const h = mk(), files: Record<string, string> = {}; h.write = async (p: string, t: string) => { files[p] = t }
    await h.board.update((s: any) => ({ ...s, plan: undefined })); await landed(h, defaults(), 't1')
    const cmd = (kind: string) => route(h, { schemaVersion: 1, cmd: 'timeline', args: [], origin: { kind } } as any)
    expect((await cmd('model')).text).toMatch(/^refused:/); expect((await cmd('unclassified')).text).toMatch(/^refused:/); expect(Object.keys(files)).toEqual([])
    expect((await run(h, { args: 'timeline', origin: { kind: 'composer' } }, () => ({}))).text).toContain('exported to .cadre/tmp/timeline.json')   // typed: through run(), as the human does it
    const out = await cmd('press'); expect(out.text).toContain('1 landed'); expect(out.text).toContain('exported to .cadre/tmp/timeline.json'); expect(out.text).not.toContain('/repo')
    expect(Object.keys(files)).toEqual(['/repo/.cadre/tmp/timeline.json']); expect(JSON.parse(files['/repo/.cadre/tmp/timeline.json'])[0].task).toBe('t1')
  })
  test('the start time is the first metered usage and survives the ledger fold', async () => {
    const h = mk(); let t = 0; h.now = async () => t; await h.bind.update(() => ({ a1: B('t1') })); await use(h, 'a1', 10)
    t = 60000; await h.bind.update(() => ({})); await use(h, 'a1', 5); t = 120000; await h.bind.update(() => ({ a1: B('t1') })); await use(h, 'a1', 5)
    await ledger(h, { setMeta: async () => {} } as any, 'cadre', defaults(), 'a1', 't1')   // the turn.complete fold keeps t0
    await landed(h, defaults(), 't1'); const [r] = await metricsOf(h); expect(r.start).toBe(0); expect(r.end).toBe(120000)
  })
  test('a task id that repeats in another repo keeps its own cost', async () => {
    const a = mk(), b = Object.assign(a, {}); await a.bind.update(() => ({ a1: B('t1') })); await use(a, 'a1', 100)
    const k1 = await scoped(a, 'cost:task:t1'); a.cwd = async () => '/other'; const k2 = await scoped(a, 'cost:task:t1')
    expect(k1).not.toBe(k2); await landed(b, defaults(), 't1'); expect((await metricsOf(b))[0].tokens).toBe(0)
  })
})
