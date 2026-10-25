import { describe, expect, test } from 'claude-code/testing'
import { charge, step } from '../core/lifecycle'
import { admitWith, beat } from '../core/admission'
import { leaseLive } from '../core/board'
import type { Deps } from '../core/admission'
import { defaults, resolve } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { agentsOf } from '../core/board'
import { idsIn } from '../core/briefs'
import { repoKeyOf } from '../commands/init'
import { ofEpic } from '../core/events'
import { fakeHost, task } from './support'
import type { Host, SnapTask } from '../types'

const T0 = 1_700_000_000_000
// One world = one MemoryStore + a git script. `session(n)` = one more session over the same store (own board, bindings, $.state).
function world(types: Record<string, string> = {}) {
  const clock = { now: T0 }, numstat = { out: '' }, store = new MemoryStore(() => clock.now), calls: string[][] = [], refs = new Set(['epic/p1-x', 'dev']), dirs = new Set<string>()
  const run = async (argv: readonly string[]) => {
    calls.push([...argv]); const a = argv.slice(3), out = (stdout = '', exitCode = 0) => ({ exitCode, stdout, stderr: '' })
    if (a[0] === 'rev-parse') return a.includes('--quiet') ? out('', refs.has(a[a.length - 1].replace('^{commit}', '')) ? 0 : 1) : out('abc1234\n')
    if (a[0] === 'worktree' && a[1] === 'add') { dirs.add(a.includes('-b') ? a[4] : a[2]); if (a.includes('-b')) refs.add(a[3]) }
    if (a[0] === 'worktree' && a[1] === 'remove') dirs.delete(a[a.length - 1])
    if (a[0] === 'diff' && a[1] === '--numstat') return out(numstat.out)
    if (a[0] === 'diff' && a[1] === '--stat') return out(' a.ts | 1 +\n')
    return out()
  }
  const mk = async (n: string) => {
    const h: Host & { logs: string[] } = { ...fakeHost({ t0: T0 }), now: async () => clock.now, run, stat: async (p: string) => (dirs.has(p) ? { kind: 'dir' } : undefined) } as any
    h.rand = (k = 16) => `${n}${'0'.repeat(k * 2)}`.slice(0, k * 2)
    const d: Deps = { store, cfg: defaults(), reg: defaults().types as any, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'repo-1', actor: 'cadre/u/aaaaaa', session: `s-${n}` }
    return { h, d }
  }
  const plan = async (...specs: { type?: string; deps?: { id: string; type: any }[] }[]) => {
    await store.init({ types: {} as any, journal: true }); const epic = await store.createEpic('E', 'goal'), ids: string[] = []
    for (const [i, s] of specs.entries()) ids.push((await store.createDraft({ title: `task ${i}`, description: 'd', acceptance: 'S1: Given x When y Then z', design: JSON.stringify({ symbols: [{ name: 'f', kind: 'fn', params: 'a', returns: 'b', status: 'new' }] }), type: s.type ?? 'feature', parent: epic, deps: s.deps?.map(x => ({ id: ids[+x.id], type: x.type })), meta: { 'cadre.package': '.' } })).id)
    await store.approve([epic, ...ids]); return { epic, ids }
  }
  const board = async (h: Host, epic: string, ids: string[], over: Partial<SnapTask>[] = []) => {
    const ts = await Promise.all(ids.map(async (id, i) => { const t = await store.get(id); return task(id, { title: t.title, type: t.type, deps: t.deps.filter(x => ['blocks', 'waits-for', 'conditional-blocks'].includes(x.type)) as any, ...over[i] }) }))
    await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: 'p1', slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: ts }))
  }
  return { clock, numstat, store, calls, refs, dirs, mk, plan, board }
}
const spawn = (prompt: string, o: object = {}) => ({ prompt, description: 'd', subagentType: 'general-purpose', background: true, fork: false, ...o })
const ok = (agentId = 'ag1') => { const seen: any[] = []; const next = async (e: any) => (seen.push(e), { model: 'sonnet', agentId }); return { next, seen } }

describe('known-id matcher goldens (4.6)', () => {
  const known = ['bd-a1', 'bd-a1.1', 'bd-a1.10', 'bd-a2']
  test('.1 vs .10, sentence end, prefix glue, suffix glue, TASK- prefix', async () => {
    expect(idsIn('do bd-a1.10 now', known)).toEqual(['bd-a1.10'])
    expect(idsIn('do bd-a1.1 now', known)).toEqual(['bd-a1.1'])
    expect(idsIn('Work on bd-a1.', known)).toEqual(['bd-a1'])
    expect(idsIn('see xbd-a1 and bd-a1-x', known)).toEqual([])
    expect(idsIn('TASK-bd-a2, then bd-a1 (bd-a2)', known)).toEqual(['bd-a2', 'bd-a1'])
    expect(idsIn('bd-a1.10.', known)).toEqual(['bd-a1.10'])
  })
})

describe('claim (3.4)', () => {
  test('Notes: the spawner\'s bare TASK-<id> adds no Notes section; main\'s own words stay (a leading id stripped)', async () => {
    for (const [said, want] of [[(id: string) => `TASK-${id}`, null], [(id: string) => `  ${id}  `, null], [(id: string) => `TASK-${id}: start with the happy path`, 'start with the happy path']] as const) {
      const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
      const { next, seen } = ok(); await admitWith(h, d, spawn(said(ids[0])), next)
      const b = String(seen[0].prompt); if (want) expect(b.endsWith(`## Notes\n${want}`)).toBe(true); else expect(b).not.toContain('## Notes\n')
    }
  })
  test("a unit's routing override wins over the risk cell, and the Activity line names it (H7)", async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    d.cfg = { ...d.cfg, units: [{ root: '.', kind: 'service', checks: { test: ['t'] }, routing: { worker: { model: 'opus', effort: 'low' } } }] } as any
    const { next, seen } = ok(); await admitWith(h, d, spawn(`TASK-${ids[0]}`), next)
    expect(seen[0]).toMatchObject({ subagentType: 'cadre:worker', model: 'opus' })
    expect(ofEpic(await h.events.read(), epic).find(e => e.type === 'agent.bound')?.data).toMatchObject({ model: 'opus', setting: 'units .: routing.worker' })
  })
  test('happy path: reserve -> store.claim -> worktree -> brief -> retype -> model -> cwd -> bind', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    const { next, seen } = ok(); const r = await admitWith(h, d, spawn(`please do TASK-${ids[0]} carefully`), next)
    expect(r).toEqual({ model: 'sonnet', agentId: 'ag1' }); expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ subagentType: 'cadre:worker', model: 'haiku', cwd: `/wt/repo-1/${ids[0]}` })
    expect(seen[0].prompt).toContain(`# TASK-${ids[0]} task 0 (feature)`); expect(seen[0].prompt).toContain('S1: Given x When y Then z'); expect(seen[0].prompt).toContain('## Notes')
    expect((await h.board.read()).tasks[0]).toMatchObject({ state: 'active', step: 'worker', owner: 'cadre/u/aaaaaa' })   // tester/red skipped until M5
    expect(await w.store.get(ids[0])).toMatchObject({ category: 'active', assignee: 'cadre/u/aaaaaa' })
    expect((await w.store.get(ids[0])).meta).toMatchObject({ 'cadre.step': 'worker', 'cadre.base': 'abc1234', 'cadre.worktree': `/wt/repo-1/${ids[0]}` })
    expect(w.calls.some(c => c.join(' ').includes(`worktree add -b feat/${ids[0]}-task-0 /wt/repo-1/${ids[0]} abc1234`))).toBe(true)
    expect((await h.bind.read()).ag1).toMatchObject({ taskId: ids[0], role: 'worker', step: 'worker', sessionId: 's-a' }); expect(Object.keys(await h.bind.read())).toEqual(['ag1'])
    expect(ofEpic(await h.events.read(), epic).map(e => e.type)).toContain('agent.bound')
    expect(((await (await (h as any).taskStore()).control()).doc.board as any)?.bind?.ag1).toMatchObject({ taskId: ids[0], role: 'worker' })   // S22: the pointer carries the new binding before any main turn ends
  })
  test('S2: two spawns racing for one id -> exactly one wins, the other is denied', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    const a = ok('ag1'), b = ok('ag2')
    const [x, y] = await Promise.all([admitWith(h, d, spawn(ids[0]), a.next), admitWith(h, d, spawn(ids[0]), b.next)])
    expect([x, y].filter((r: any) => r.deny)).toHaveLength(1); expect(a.seen.length + b.seen.length).toBe(1)
  })
  test('one-id rule: two ids, fork with an id, teammate, workflow are refused; nothing is claimed', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}, {}); await w.board(h, epic, ids)
    const { next, seen } = ok()
    expect(((await admitWith(h, d, spawn(`${ids[0]} and ${ids[1]}`), next)) as any).deny).toContain('one agent takes one task')
    expect(((await admitWith(h, d, spawn(ids[0], { fork: true }), next)) as any).deny).toContain('cannot be a fork')
    expect(((await admitWith(h, d, spawn(ids[0], { isTeammate: true }), next)) as any).deny).toContain('agent teams')
    expect(((await admitWith(h, d, spawn(ids[0], { workflow: { runId: 'r', agentIndex: 0 } }), next)) as any).deny).toContain('workflow')
    expect(seen).toEqual([]); expect((await w.store.get(ids[0])).category).toBe('todo'); expect((await h.board.read()).tasks.map(t => t.state)).toEqual(['todo', 'todo'])
  })
  test('marker-less: retyped to the explorer; a fork passes untouched', async () => {
    const w = world(), { h, d } = await w.mk('a'), { next, seen } = ok()
    await admitWith(h, d, spawn('where is the parser?'), next)
    expect(seen[0]).toMatchObject({ subagentType: 'cadre:explorer', model: 'haiku' }); expect(seen[0].prompt).toContain('# QUESTION\nwhere is the parser?')
    await admitWith(h, d, spawn('x', { fork: true }), next); expect(seen[1].subagentType).toBe('general-purpose')
  })
  test('a denied explorer spawn is no explorer: no ask card is recorded for it', async () => {
    const w = world(), { h, d } = await w.mk('a')
    await admitWith(h, d, spawn('where is the parser?'), async () => ({ deny: 'no' })); expect((await h.ui.read()).asks ?? {}).toEqual({})
    await admitWith(h, d, spawn('where is the parser?'), ok('ag9').next); expect(Object.keys((await h.ui.read()).asks as object)).toEqual(['ag9'])
  })
  test('the task limit, not-ready (blocking dep), flags, and a type that needs the tester step are refused', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}, { deps: [{ id: '0', type: 'blocks' }] }, { type: 'test' }, {}); await w.board(h, epic, ids)
    const { next, seen } = ok()
    expect(((await admitWith(h, d, spawn(ids[1]), next)) as any).deny).toContain('not ready')
    expect(((await admitWith(h, d, spawn(ids[2]), next)) as any).deny).toContain('not available')
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === ids[3] ? { ...t, condition: { on: ids[0], state: 'not-met' as const } } : t)) })); expect(((await admitWith(h, d, spawn(ids[3]), next)) as any).deny).toContain('never runs')
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === ids[3] ? { ...t, flags: ['git:dev'] } : t)) })); expect(((await admitWith(h, d, spawn(ids[3]), next)) as any).deny).toContain('flag git:dev')
    await h.board.update(s => ({ ...s, tasks: s.tasks.map((t, i) => (i === 3 ? { ...t, flags: [], condition: undefined } : i === 0 ? { ...t, state: 'active' } : { ...t, state: i === 1 ? 'active' : t.state }) as SnapTask) })); d.cfg.concurrency.default = 2
    expect(((await admitWith(h, d, spawn(ids[3]), next)) as any).deny).toContain('limit 2'); expect(seen).toEqual([])
    d.cfg.concurrency.default = 0; expect(((await admitWith(h, d, spawn(ids[3]), next)) as any)?.deny ?? '').not.toContain('limit')   // 0 = no cap (setup preferences)
  })
  test('a rejected spawn ({deny}) or a thrown next releases the claim and the board, removes the new worktree; a throw is rethrown', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    const r: any = await admitWith(h, d, spawn(ids[0]), async () => ({ deny: 'engine says no' })); expect(r.deny).toBe('engine says no')
    expect(await w.store.get(ids[0])).toMatchObject({ category: 'todo' }); expect((await w.store.get(ids[0])).assignee).toBeUndefined(); expect((await h.board.read()).tasks[0]).toMatchObject({ state: 'todo', owner: undefined })
    expect(w.calls.some(c => c.join(' ').includes('worktree remove'))).toBe(true); expect(await h.bind.read()).toEqual({})
    await expect(admitWith(h, d, spawn(ids[0]), async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await w.store.get(ids[0])).toMatchObject({ category: 'todo' }); expect((await h.board.read()).tasks[0].state).toBe('todo')
    expect(((await admitWith(h, d, spawn(ids[0]), ok().next)) as any).agentId).toBe('ag1')   // and it can be claimed again
  })
  test('a spike has no worktree: explorer at the repo root, no branch', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({ type: 'spike' }); await w.board(h, epic, ids); const { next, seen } = ok()
    await admitWith(h, d, spawn(ids[0]), next); expect(seen[0]).toMatchObject({ subagentType: 'cadre:explorer', cwd: '/repo' }); expect(w.calls.some(c => c.includes('worktree'))).toBe(false)
  })
  test('the setup argv of the package runs in the writable jail; a failing setup releases the claim', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    d.cfg.units = [{ root: '.', setup: ['npm', 'ci'] }] as any
    await admitWith(h, d, spawn(ids[0]), ok().next); const j = w.calls.find(c => c[0] === 'bwrap')!
    expect(j).toContain('--bind'); expect(j.slice(j.indexOf('--') + 1)).toEqual(['npm', 'ci']); expect(j).not.toContain('--unshare-net')
  })
})

describe('next step / rebind (lease staleness, 8.4)', () => {
  const active = async (w: ReturnType<typeof world>, h: Host, d: Deps, opts: { step?: string } = {}) => {
    const { epic, ids } = await w.plan({}); await w.board(h, epic, ids); await admitWith(h, d, spawn(ids[0]), ok().next)
    if (opts.step) await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, step: opts.step! })) }))
    return ids[0]
  }
  test('a live lease with a live same-role agent: denied ("resumed automatically"); another session with a live lease: denied', async () => {
    const w = world(), a = await w.mk('a'), b = await w.mk('b'), id = await active(w, a.h, a.d)
    expect(((await admitWith(a.h, a.d, spawn(id), ok('x').next)) as any).deny).toContain('wait for its result')
    const { epic } = { epic: (await a.h.board.read()).epic! }; await w.board(b.h, epic, [id], [{ state: 'active', step: 'worker' }])
    expect(((await admitWith(b.h, b.d, spawn(id), ok('y').next)) as any).deny).toContain('another session')
  })
  test('live lease but the bound agent is retired (core/reuse: fresh over resume) -> rebind with a handoff, unbound(rebind)', async () => {
    const w = world(), { h, d } = await w.mk('a'), id = await active(w, h, d)
    await h.bind.update(b => ({ ...b, ag1: { ...b.ag1, retired: true } }))
    const rr: any = await admitWith(h, d, spawn(id), ok('ag2').next); expect(rr.agentId).toBe('ag2')
    expect(Object.keys(await h.bind.read())).toEqual(['ag2'])
    expect(ofEpic(await h.events.read(), (await h.board.read()).epic!).find(e => e.type === 'agent.unbound')?.data).toEqual({ agentId: 'ag1', reason: 'rebind' })
  })
  test('expired lease: stale -> rebind: unbound(stale), same actor + worktree, computed handoff, new agent bound', async () => {
    const w = world(), { h, d } = await w.mk('a'), id = await active(w, h, d)
    w.clock.now += 6 * 60_000; expect(leaseLive(await w.store.get(id), w.clock.now)).toBe(false)
    const { next, seen } = ok('ag2'); const rr: any = await admitWith(h, d, spawn(id), next); expect(rr.deny ?? rr.agentId).toBe('ag2')
    expect(seen[0].cwd).toBe(`/wt/repo-1/${id}`); expect(seen[0].prompt).toContain('## Handoff'); expect(seen[0].prompt).toContain('checkpoint abc1234')
    const b = await h.bind.read(); expect(Object.keys(b)).toEqual(['ag2']); expect(agentsOf(b, id)).toEqual(['ag2'])
    expect(ofEpic(await h.events.read(), (await h.board.read()).epic!).find(e => e.type === 'agent.unbound')?.data).toEqual({ agentId: 'ag1', reason: 'stale' })
    expect(w.calls.some(c => c.join(' ').includes('commit') && c.join(' ').includes(`wip(${id}): checkpoint`))).toBe(false)   // clean tree: nothing to checkpoint
  })
  test('a step that needs a new role is legal under a live lease (red check -> worker)', async () => {
    const w = world(), { h, d } = await w.mk('a'), id = await active(w, h, d)
    await h.bind.update(t => ({ ...t, ag1: { ...t.ag1, role: 'tester' } }))
    expect(((await admitWith(h, d, spawn(id), ok('ag3').next)) as any).agentId).toBe('ag3'); expect(Object.keys(await h.bind.read())).toEqual(['ag3'])
  })
  test('mod-run steps (green) and merge have no agent', async () => {
    const w = world(), { h, d } = await w.mk('a'), id = await active(w, h, d, { step: 'green' })
    expect(((await admitWith(h, d, spawn(id), ok().next)) as any).deny).toContain('runs without an agent')
  })
  test('recovery: worktree dir gone but branch present -> prune + re-add; branch gone -> lost-wip, released; epic branch gone -> lost-epic', async () => {
    const w = world(), { h, d } = await w.mk('a'), id = await active(w, h, d); w.clock.now += 6 * 60_000
    w.dirs.clear(); expect(((await admitWith(h, d, spawn(id), ok('ag2').next)) as any).agentId).toBe('ag2')
    expect(w.calls.some(c => c.slice(3).join(' ') === 'worktree prune')).toBe(true); expect(w.calls.some(c => c.slice(3, 6).join(' ') === `worktree add /wt/repo-1/${id}`)).toBe(true)
    w.clock.now += 6 * 60_000; w.dirs.clear(); w.refs.delete(`feat/${id}-task-0`)
    expect(((await admitWith(h, d, spawn(id), ok('ag3').next)) as any).deny).toContain('branch is gone')
    expect((await w.store.get(id)).category).toBe('todo'); expect((await h.board.read()).tasks[0].state).toBe('todo')
    expect(ofEpic(await h.events.read(), (await h.board.read()).epic!).some(e => e.type === 'flag.raised' && e.data.flag === 'lost-wip')).toBe(true)
    w.refs.delete('epic/p1-x'); expect(((await admitWith(h, d, spawn(id), ok('ag4').next)) as any).deny).toContain('recreate it from dev'); expect((await h.board.read()).plan!.state).toBe('blocked')
  })
})

describe('review spawn', () => {
  const inReview = async (step: string) => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids, [{ state: 'review', step }])
    await w.store.claim(ids[0], d.actor); await w.store.setMeta(ids[0], { 'cadre.sourceCommit': 'deadbee', 'cadre.base': 'abc1234', 'cadre.worktree': `/wt/repo-1/${ids[0]}` }, d.actor); await w.store.update(ids[0], { labels: ['security'] }, d.actor)
    return { w, h, d, id: ids[0] }
  }
  test('a review task gets a fresh reviewer (deep tier by label), reserved by CAS; a bound reviewer is not duplicated', async () => {
    const { h, d, id } = await inReview('reviewer'), { next, seen } = ok('rv1')
    expect(((await admitWith(h, d, spawn(id), next)) as any).agentId).toBe('rv1')
    expect(seen[0]).toMatchObject({ subagentType: 'cadre:reviewer', model: 'opus', cwd: `/wt/repo-1/${id}` }); expect(seen[0].prompt).toContain('# REVIEW TASK'); expect(seen[0].prompt).toContain('deadbee'); expect(seen[0].prompt).toContain('a.ts | 1 +')
    expect(((await admitWith(h, d, spawn(id), ok('rv2').next)) as any).deny).toContain('has a reviewer'); expect(Object.keys(await h.bind.read())).toEqual(['rv1'])
  })
  test('risk-sized reviewer: tiny change is light (sonnet), mid is standard (sonnet), large or risky is thorough (opus); recorded on the task and the bound event', async () => {
    for (const [stat, tier, model, labels] of [['1\t1\tsrc/a.ts\n', 'light', 'sonnet', []], ['60\t50\tsrc/a.ts\n', 'standard', 'sonnet', []], ['1\t1\tsrc/auth/x.ts\n', 'thorough', 'opus', []], ['1\t1\tsrc/a.ts\n', 'thorough', 'opus', ['security']]] as const) {
      const { w, h, d, id } = await inReview('reviewer'); await w.store.update(id, { labels: [...labels] }, d.actor); w.numstat.out = stat
      const { next, seen } = ok('rv1'); await admitWith(h, d, spawn(id), next)
      expect(seen[0].model).toBe(model); expect((await w.store.get(id)).meta['cadre.reviewTier']).toBe(tier)
      expect(ofEpic(await h.events.read(), (await h.board.read()).epic!).some(e => e.type === 'agent.bound' && e.data.tier === tier)).toBe(true)
      expect(/\b(light|thorough|tier)\b/i.test(seen[0].prompt.replace(/Small change|Large or sensitive change/g, ''))).toBe(false)
    }
  })
  test('env overrides beat every cell and are recorded as forced', async () => {
    const { w, h, d, id } = await inReview('reviewer'); await w.store.update(id, { labels: [] }, d.actor); w.numstat.out = '1\t1\tsrc/a.ts\n'; (h as any).env = async () => ({ CLAUDE_CODE_EFFORT_LEVEL: 'low' })
    await admitWith(h, d, spawn(id), ok('rv3').next); expect(JSON.parse((await w.store.get(id)).meta['cadre.runs']).at(-1)).toMatchObject({ effort: 'low', forced: '/low' })
  })
  test('the reviewer may not be set to haiku (allowed values: the old floor, explicit now)', async () => {
    expect(resolve([{ name: 'u', trust: 'user', value: { roles: { reviewer: { byRisk: { light: { model: 'haiku' } } } } } }]).diagnostics).toEqual(['u: roles.reviewer.byRisk.light.model: the reviewer may not run on haiku'])
  })
  // ADR 0019: every role x risk cell, and its escalation, is exactly what the spawned agent gets; the bound event names the setting
  for (const role of ['worker', 'tester', 'reviewer'] as const) for (const risk of ['light', 'standard', 'thorough', 'core'] as const) test(`routing cell roles.${role}.byRisk.${risk} (+ escalate)`, async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}), id = ids[0], rv = role === 'reviewer'
    await w.board(h, epic, ids, rv ? [{ state: 'review', step: 'reviewer' }] : [])
    if (role === 'tester') { d.view = async (_h, _d, t) => `/wt/repo-1.views/${t.id}`; d.cfg.units = [{ root: '.', tdd: { paths: ['test/**'] } }] as any }
    if (rv) { await w.store.claim(id, d.actor); await w.store.setMeta(id, { 'cadre.sourceCommit': 'deadbee', 'cadre.base': 'abc1234', 'cadre.worktree': `/wt/repo-1/${id}` }, d.actor); w.numstat.out = risk === 'standard' ? '60\t50\tsrc/a.ts\n' : '1\t1\tsrc/a.ts\n' }
    else await w.store.setMeta(id, { 'cadre.paths': JSON.stringify(risk === 'standard' ? ['a', 'b', 'c'] : ['src/a.ts']) }, d.actor)
    if (risk === 'thorough') await w.store.update(id, { labels: ['security'] }, d.actor)
    if (risk === 'core') await w.store.setMeta(id, { 'cadre.core': 'true' }, d.actor)
    Object.assign(d.cfg.roles[role].byRisk[risk], { model: 'fable', effort: 'max', escalate: { after: 1, model: 'opus', effort: 'xhigh' } })
    const bound = async () => ofEpic(await h.events.read(), epic).filter(e => e.type === 'agent.bound').at(-1)!.data
    const a = ok('ag1'); await admitWith(h, d, spawn(id), a.next)
    expect([a.seen[0].model, (await h.bind.read()).ag1.effort]).toEqual(['fable', 'max'])
    expect(await bound()).toMatchObject({ model: 'fable', effort: 'max', setting: `roles.${role}.byRisk.${risk}` })
    await h.bind.update(() => ({})); await charge(h, id, 'rework')   // one review round (the task budget)
    if (!rv) { await w.store.release(id, d.actor, 'test'); await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, state: 'todo', owner: undefined })) })) }
    const b = ok('ag2'); await admitWith(h, d, spawn(id), b.next)
    expect([b.seen[0].model, (await h.bind.read()).ag2?.effort]).toEqual(['opus', 'xhigh'])
    expect(await bound()).toMatchObject({ model: 'opus', effort: 'xhigh', escalated: true, setting: `roles.${role}.byRisk.${risk}.escalate` })
  })
  test('a tester hears only the spec change decision, once; a stale decision never reaches it', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}), id = ids[0]
    await w.board(h, epic, ids); d.view = async (_h, _d, t) => `/wt/repo-1.views/${t.id}`; d.cfg.units = [{ root: '.', tdd: { paths: ['test/**'] } }] as any
    await admitWith(h, d, spawn(id), ok('tt0').next)   // the first tester; its claim stays, as after a spec change Accept rewinds the task to the tester
    await h.bind.update(() => ({})); await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, state: 'active', step: 'tester' })) }))
    await w.store.setMeta(id, { 'cadre.decision': 'use bcrypt (an old answer)', 'cadre.specDecision': 'The spec change was accepted: amend S5.' }, d.actor)
    const a = ok('tt1'); await admitWith(h, d, spawn(id), a.next)
    const p = String(a.seen[0].prompt); expect(p).toContain('The spec change was accepted: amend S5.'); expect(p).not.toContain('bcrypt')
    expect((await w.store.get(id)).meta['cadre.specDecision']).toBe('')   // delivered once
  })
  test('settings: review.deepLabels sends a labelled change to the thorough review; only CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 overrides the model (ADR 0019)', async () => {
    const { w, h, d, id } = await inReview('reviewer'); await w.store.update(id, { labels: ['ux'] }, d.actor); w.numstat.out = '1\t1\tsrc/a.ts\n'
    const a = ok('rv1'); await admitWith(h, d, spawn(id), a.next); expect(a.seen[0].model).toBe('sonnet')
    await h.bind.update(() => ({})); d.cfg.review.deepLabels = ['ux']
    const b = ok('rv2'); await admitWith(h, d, spawn(id), b.next); expect(b.seen[0].model).toBe('opus'); expect((await w.store.get(id)).meta['cadre.reviewTier']).toBe('thorough')
    await h.bind.update(() => ({})); (h as any).env = async () => ({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' })
    await admitWith(h, d, spawn(id), ok('rv3').next); expect(JSON.parse((await w.store.get(id)).meta['cadre.runs']).at(-1)).toMatchObject({ model: 'opus' }); expect('forced' in JSON.parse((await w.store.get(id)).meta['cadre.runs']).at(-1)).toBe(false)
    await h.bind.update(() => ({})); (h as any).env = async () => ({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
    await admitWith(h, d, spawn(id), ok('rv4').next); expect(JSON.parse((await w.store.get(id)).meta['cadre.runs']).at(-1)).toMatchObject({ model: 'haiku', forced: 'haiku/' })
  })
  test('review-passed (merge) is main\'s to complete; no sourceCommit yet is refused', async () => {
    const m = await inReview('merge'); expect(((await admitWith(m.h, m.d, spawn(m.id), ok().next)) as any).deny).toContain('status set completed')
    const r = await inReview('reviewer'); await r.w.store.setMeta(r.id, { 'cadre.sourceCommit': '' }, r.d.actor); expect(((await admitWith(r.h, r.d, spawn(r.id), ok().next)) as any).deny).toContain('no commit to review')
  })
  test('a rejected review spawn drops its reservation', async () => {
    const { h, d, id } = await inReview('reviewer'); await admitWith(h, d, spawn(id), async () => ({ deny: 'no' })); expect(await h.bind.read()).toEqual({})
  })
  test('a reviewer launch that returns no agent id leaves no owner: the next step is still "spawn the reviewer"', async () => {
    const { h, d, id } = await inReview('reviewer'); await admitWith(h, d, spawn(id), async () => ({ model: 'sonnet' }))
    expect(await h.bind.read()).toEqual({}); expect((await h.board.read()).tasks.find(t => t.id === id)!.owner).toBeUndefined()
  })
})

describe('multi-session leases (two hosts, one store)', () => {
  test('B cannot claim what A claimed (store AlreadyClaimed): denied, B\'s board reverted; after A\'s lease expires B rebinds', async () => {
    const w = world(), a = await w.mk('a'), b = await w.mk('b'), { epic, ids } = await w.plan({}); await w.board(a.h, epic, ids); await w.board(b.h, epic, ids)
    await admitWith(a.h, a.d, spawn(ids[0]), ok('ag1').next)
    const r: any = await admitWith(b.h, b.d, spawn(ids[0]), ok('bg1').next); expect(r.deny).toBeDefined(); expect((await b.h.board.read()).tasks[0].state).toBe('todo')
    await b.h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, state: 'active', step: 'worker', owner: 'cadre/u/aaaaaa' }) as SnapTask) }))
    expect(((await admitWith(b.h, b.d, spawn(ids[0]), ok('bg1').next)) as any).deny).toContain('another session')
    w.clock.now += 6 * 60_000; expect(((await admitWith(b.h, b.d, spawn(ids[0]), ok('bg1').next)) as any).agentId).toBe('bg1')
    expect((await b.h.bind.read()).bg1.sessionId).toBe('s-b'); expect((await a.h.bind.read()).ag1.sessionId).toBe('s-a')
  })
  test('heartbeat: only this session\'s bindings, once per interval', async () => {
    const w = world(), a = await w.mk('a'), b = await w.mk('b'), { epic, ids } = await w.plan({}, {}); await w.board(a.h, epic, ids)
    await admitWith(a.h, a.d, spawn(ids[0]), ok('ag1').next); await step(a.h, 'other', { type: 'spawn.ok', bind: { taskId: ids[1], role: 'worker', step: 'worker', worktree: '/x', sessionId: 's-b', ctxTokens: 0, startedAt: 0 } })
    const beats: string[] = []; const spy = (d: Deps): Deps => ({ ...d, store: Object.assign(Object.create(d.store), { heartbeat: async (id: string) => { beats.push(id) } }) })
    await beat(a.h, spy(a.d)); await beat(a.h, spy(a.d)); expect(beats).toEqual([ids[0]])
    w.clock.now += 121_000; await beat(a.h, spy(a.d)); expect(beats).toEqual([ids[0], ids[0]]); await beat(b.h, spy(b.d)); expect(beats).toHaveLength(2)
    await a.h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === ids[0] ? { ...t, state: 'review', step: 'reviewer' } : t)) }))   // in review: no lease to renew (bd refuses it every tick)
    w.clock.now += 121_000; await beat(a.h, spy(a.d)); expect(beats).toHaveLength(2)
  })
})

describe('tester step with a spec view (3.5)', () => {
  test('claim: tester agent, cwd = the view and the binding\'s root = the view; the worker waits for a red record, then sees the locked tests', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}), id = ids[0], view = `/wt/repo-1.views/${id}`; await w.board(h, epic, ids)
    d.view = async (_h, _d, t) => `/wt/repo-1.views/${t.id}`; d.cfg.units = [{ root: '.', tdd: { paths: ['test/**'] } }] as any
    const a = ok('tt1'); await admitWith(h, d, spawn(id), a.next)
    expect(a.seen[0]).toMatchObject({ subagentType: 'cadre:tester', cwd: view }); expect(a.seen[0].prompt).toContain('# SPEC TASK'); expect(a.seen[0].prompt).toContain('test/**')
    expect((await h.bind.read()).tt1.worktree).toBe(view)
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, step: 'worker' })) }))   // red✓ happened (tdd.testerDone advances), but no specCommit recorded
    expect(((await admitWith(h, d, spawn(id), ok('wk1').next)) as any).deny).toContain('spec tests are not recorded')
    await w.store.setMeta(id, { 'cadre.specCommit': 'abc1234', 'cadre.locked': JSON.stringify(['test/s.json']), 'cadre.red': 'red ✓ 1 failing' }, d.actor)
    const b = ok('wk1'); await admitWith(h, d, spawn(id), b.next)
    expect(b.seen[0]).toMatchObject({ subagentType: 'cadre:worker', cwd: `/wt/repo-1/${id}` }); expect(b.seen[0].prompt).toContain('test/s.json'); expect(b.seen[0].prompt).toContain('red ✓ 1 failing')
  })
  test('testerView:full = the tester works in the worktree; author:same = the worker agent with the tester brief', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    d.view = async () => { throw new Error('no view expected') }; d.cfg.roles.testerView = 'full'; d.cfg.roles.tdd.author = 'same'
    const a = ok('tt1'); await admitWith(h, d, spawn(ids[0]), a.next)
    expect(a.seen[0]).toMatchObject({ subagentType: 'cadre:worker', cwd: `/wt/repo-1/${ids[0]}` }); expect(a.seen[0].prompt).toContain('# SPEC TASK')
  })
  test('author:same with testerView:view: the tester step still works in the worktree (3.5), so the red -> worker resume needs no cwd change', async () => {
    const w = world(), { h, d } = await w.mk('a'), { epic, ids } = await w.plan({}); await w.board(h, epic, ids)
    d.view = async () => { throw new Error('no view expected') }; d.cfg.roles.tdd.author = 'same'
    const a = ok('tt1'); await admitWith(h, d, spawn(ids[0]), a.next)
    expect(a.seen[0]).toMatchObject({ subagentType: 'cadre:worker', cwd: `/wt/repo-1/${ids[0]}` })
    expect((await h.bind.read()).tt1).toMatchObject({ role: 'worker', step: 'tester', worktree: `/wt/repo-1/${ids[0]}` })
  })
})
