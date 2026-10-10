import { describe, expect, test } from 'claude-code/testing'
import { CAP, TABLE, emit, ofEpic, rebuild, subscribe } from '../core/events'
import { GOLDEN, SAMPLE } from './fixtures/events/golden'
import { fakeHost } from './support'
import type { EventType } from '../types'

describe('event envelope golden (DESIGN 2.5)', () => {
  test('the set of types is pinned', async () => { expect(Object.keys(TABLE).sort()).toEqual(Object.keys(GOLDEN).sort()) })
  test('every type: envelope, actor/severity/needsHuman from the table, required data keys', async () => {
    const h = fakeHost({ t0: 100 })
    let seq = 0
    for (const type of Object.keys(GOLDEN) as EventType[]) {
      const ev = await emit(h, type, SAMPLE[type], { taskId: 't1', agentId: 'ag1' })
      const g = GOLDEN[type]
      expect(ev).toEqual({ schemaVersion: 1, seq: ++seq, at: 100 + seq * 10, type, taskId: 't1', agentId: 'ag1', actor: g.actor, severity: g.severity, needsHuman: g.needsHuman, data: SAMPLE[type] })
      expect(g.keys.every(k => k in SAMPLE[type])).toBe(true)
    }
    const ring = await h.events.read(); expect(ring.seq).toBe(seq); expect(ofEpic(ring, '')).toHaveLength(seq)
  })
  test('JSON shape of one event (golden bytes)', async () => {
    const ev = await emit(fakeHost({ t0: 0 }), 'agent.unbound', { agentId: 'a1', reason: 'answer' }, { agentId: 'a1' })
    expect(JSON.stringify(ev)).toBe('{"schemaVersion":1,"seq":1,"at":10,"type":"agent.unbound","agentId":"a1","actor":"mod","severity":"info","needsHuman":false,"data":{"agentId":"a1","reason":"answer"}}')
  })
  test('an emit site may override actor / severity / needsHuman; the attention level is never stored', async () => {
    const ev = await emit(fakeHost(), 'sync.state_changed', { target: 'pm', state: 'offline', at: 1 }, { severity: 'warn', needsHuman: false, actor: 'sync' })
    expect(ev).toMatchObject({ severity: 'warn', needsHuman: false, actor: 'sync' }); expect('level' in ev).toBe(false)
  })
  test('missing data keys, unknown types and code-bearing keys are refused', async () => {
    const h = fakeHost()
    await expect(emit(h, 'task.skipped', { taskId: 'a' })).rejects.toThrow('task.skipped: missing on')
    await expect(emit(h, 'nope' as EventType, {})).rejects.toThrow('unknown event type')
    for (const k of ['code8', 'code', 'nonce', 'token', 'initConfirm']) await expect(emit(h, 'init.stage', { stage: 1, state: 'x', [k]: 'ab12cd34' })).rejects.toThrow('must not ride an event')
    expect((await h.events.read()).seq).toBe(0)
  })
})

describe('ring + bus', () => {
  test('500 per epic, oldest dropped, epics isolated; seq is global and monotonic', async () => {
    const h = fakeHost()
    await h.board.update(s => ({ ...s, epic: 'e1' }))
    for (let i = 0; i < CAP + 20; i++) await emit(h, 'cost.updated', { tokens: i })
    await h.board.update(s => ({ ...s, epic: 'e2' })); await emit(h, 'cost.updated', { tokens: -1 })
    const r = await h.events.read()
    expect(ofEpic(r, 'e1')).toHaveLength(CAP); expect(ofEpic(r, 'e1')[0].seq).toBe(21); expect(ofEpic(r, 'e1')[CAP - 1].seq).toBe(CAP + 20)
    expect(ofEpic(r, 'e2').map(e => e.seq)).toEqual([CAP + 21]); expect(r.seq).toBe(CAP + 21)
  })
  test('subscribers see each event; a failing subscriber is logged and never breaks emit', async () => {
    const h = fakeHost(), seen: string[] = []
    subscribe((_h, ev) => { seen.push(ev.type) })
    subscribe(() => { throw new Error('boom') })
    await emit(h, 'drive.status', { state: 'armed' })
    expect(seen).toEqual(['drive.status']); expect(h.logs[0]).toContain('subscriber failed on drive.status')
  })
  test('rebuild: sorted by at, fresh seqs after the current seq, capped, other epics untouched; returns the first seq', async () => {
    const h = fakeHost()
    await h.board.update(s => ({ ...s, epic: 'e1' })); await emit(h, 'cost.updated', { tokens: 1 })
    const evs = [{ at: 30, type: 'task.skipped' as const, data: { taskId: 'a', on: 'b' }, taskId: 'a' }, { at: 10, type: 'agent.bound' as const, data: { agentId: 'x', taskId: 'a', role: 'worker' } }, { at: 20, type: 'agent.unbound' as const, data: { agentId: 'x', reason: 'answer' } }]
    expect(await rebuild(h, 'e2', evs)).toBe(2)
    const r = await h.events.read()
    expect(ofEpic(r, 'e2').map(e => [e.seq, e.at, e.type])).toEqual([[2, 10, 'agent.bound'], [3, 20, 'agent.unbound'], [4, 30, 'task.skipped']])
    expect(ofEpic(r, 'e1')).toHaveLength(1); expect(r.seq).toBe(4)
    const many = Array.from({ length: CAP + 5 }, (_, i) => ({ at: i, type: 'cost.updated' as const, data: { tokens: i } }))
    await rebuild(h, 'e2', many); expect(ofEpic(await h.events.read(), 'e2')).toHaveLength(CAP)
    expect(ofEpic(await h.events.read(), 'e2')[0].at).toBe(5)
  })
})
