import { describe, expect, test } from 'claude-code/testing'
import { step } from '../core/lifecycle'
import { agentsOf, canon, commit, conditionOf, emptySnapshot, fnv1a64, humanView, isCold, modelView, stamp, viewHash, withConditions } from '../core/board'
import { emit } from '../core/events'
import { EMPTY_KEYS, EPIC } from './fixtures/readmodel/snapshot.golden'
import { GOLDEN, SAMPLE } from './fixtures/events/golden'
import { fakeHost } from './support'
import type { EventType, Snapshot } from '../types'

describe('snapshot schema golden (DESIGN 2.5)', () => {
  test('empty board: exact top-level keys, schemaVersion 1, cold', async () => {
    const s = emptySnapshot('r')
    expect(Object.keys(s).sort()).toEqual(EMPTY_KEYS)
    expect(s).toEqual({ schemaVersion: 1, seq: 0, repo: 'r', mission: null, epic: null, plan: null, tasks: [], approval: { planId: null, missing: [] },
      drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [] })
    expect(isCold(s)).toBe(true); expect(isCold(EPIC)).toBe(false)
  })
  test('v2.5 fields: task kind/merges/phaseSince/typed deps/condition; plan approvedAt/landed/released', async () => {
    const t = EPIC.tasks
    expect(t.map(x => [x.kind, x.merges])).toEqual([['code', true], ['docs', true], ['spike', false]])
    expect(t[2].deps[0]).toEqual({ id: 'a2', type: 'conditional-blocks' }); expect(t.every(x => typeof x.phaseSince === 'number')).toBe(true)
    expect(EPIC.plan).toMatchObject({ approvedAt: 1000, landed: { dev: 'dev', sha: '1a2b3c4', at: 2000 }, released: { version: '0.2.0', at: 3000 } })
  })
  test('condition is derived from typed deps + upstream state', async () => {
    const mk = (up: Snapshot['tasks'][0]['state']): Snapshot => ({ ...EPIC, tasks: [{ ...EPIC.tasks[1], state: up }, EPIC.tasks[2]] })
    expect(conditionOf(mk('active').tasks[1], mk('active').tasks)).toEqual({ on: 'a2', state: 'pending' })
    expect(withConditions(mk('done')).tasks[1].condition).toEqual({ on: 'a2', state: 'not-met' })
    expect(withConditions(mk('cancelled')).tasks[1].condition).toEqual({ on: 'a2', state: 'met' })
    expect(conditionOf(EPIC.tasks[0], EPIC.tasks)).toBeUndefined()
  })
})

describe('views', () => {
  test('human view = the full snapshot (a copy); model view drops volatile fields only', async () => {
    const h = humanView(EPIC); expect(h).toEqual(EPIC); expect(h).not.toBe(EPIC)
    const m = modelView(EPIC) as any
    expect(m.seq).toBeUndefined(); expect(m.cost).toBeUndefined()
    expect(m.tasks.every((t: any) => !('phaseSince' in t))).toBe(true); expect(m.sync[0]).not.toHaveProperty('at'); expect(m.sync[0]).toMatchObject({ target: 'pm', pending: 4 })
    expect(m.drive).toEqual({ on: true, level: 'epic', epicId: 'e-1', heldBy: 's1' }); expect(m.plan).toEqual(EPIC.plan)
    expect(EPIC.seq).toBe(41); expect(EPIC.tasks[0].phaseSince).toBe(1500)   // the source is untouched
  })
  test('viewHash: stable under volatile changes, moves on a real change', async () => {
    const base = viewHash(EPIC)
    expect(viewHash({ ...EPIC, seq: 99, cost: { tokens: 1 }, tasks: EPIC.tasks.map(t => ({ ...t, phaseSince: 7 })) })).toBe(base)
    expect(viewHash({ ...EPIC, tasks: EPIC.tasks.map(t => (t.id === 'a2' ? { ...t, state: 'review' as const } : t)) })).not.toBe(base)
    expect(base).toMatch(/^[0-9a-f]{16}$/)
  })
  test('canonical JSON sorts keys and fnv1a64 matches the reference vectors', async () => {
    expect(canon({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}]},"b":1}')
    expect(fnv1a64('')).toBe('cbf29ce484222325'); expect(fnv1a64('a')).toBe('af63dc4c8601ec8c'); expect(fnv1a64('foobar')).toBe('85944171f73967e8')
  })
})

describe('no code anywhere in views, events or the read model (D7)', () => {
  test('no approval secret exists (ADR 0012); views, model view and events carry no code, nonce or token key', async () => {
    const h = fakeHost()
    await h.board.update(() => ({ ...EPIC }))
    for (const type of Object.keys(GOLDEN) as EventType[]) await emit(h, type, SAMPLE[type], { taskId: 'a1' })
    const out = JSON.stringify([humanView(await h.board.read()), modelView(await h.board.read()), await h.events.read()])
    for (const bad of ['code8', 'initConfirm', 'nonce', '"token"', 'dcode', 'fallback']) expect(out.includes(bad)).toBe(false)
  })
  test('the snapshot type has no secret-bearing key at any depth', async () => {
    const keys = new Set<string>(); const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x) } }
    walk(EPIC); walk(emptySnapshot())
    for (const k of ['code8', 'code', 'initConfirm', 'nonce', 'token']) expect(keys.has(k)).toBe(false)
  })
})

describe('CAS + binding table', () => {
  test('commit applies a pure fn; stamp only moves seq forward', async () => {
    const h = fakeHost()
    await commit(h, s => ({ ...s, mission: 'm' })); await stamp(h, 5); await stamp(h, 3)
    expect(await h.board.read()).toMatchObject({ mission: 'm', seq: 5 })
  })
  test('bind / unbind / lookup; one agent = one task', async () => {   // bound and unbound through the lifecycle (core/lifecycle.step)
    const h = fakeHost(), b = { taskId: 't1', role: 'worker' as const, step: 'worker', worktree: '/wt/t1', sessionId: 's', ctxTokens: 0, startedAt: 1 }
    for (const [a, x] of [['ag1', b], ['ag2', { ...b, role: 'reviewer' as const, step: 'reviewer' }], ['ag3', { ...b, taskId: 't2' }]] as const) await step(h, a, { type: 'spawn.ok', bind: x })
    const t = await h.bind.read()
    expect(t.ag1).toEqual(b); expect(t.nope).toBeUndefined()
    expect(agentsOf(t, 't1').sort()).toEqual(['ag1', 'ag2'])
    await step(h, 'ag1', { type: 'end', cause: 'done', reason: 'answer' }); expect(Object.keys(await h.bind.read()).sort()).toEqual(['ag2', 'ag3'])
  })
})
