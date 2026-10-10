import { describe, expect, test } from 'claude-code/testing'
import { AdapterError, call } from '../task-management/protocol'
import { hash, merge } from '../task-management/sync-engine/merge'
import { fakeHost, task } from './support'
import { BdStore } from '../task-management/adapters/beads/store'
import { EVENTS_TAIL } from './fixtures/bd/events-tail'
import { apply } from '../core/machine'
import { setState, syncAdd } from '../task-management/sync-engine/loop'
import { initPropose } from '../core/dispatch'

// kit side of the adapter protocol: spawn is a stub; real one-shot spawns against the fake adapter run in tests/protocol (node --test)
const host = (reply: (req: any) => { exitCode?: number; stdout: string }, seen: any[] = []) =>
  Object.assign(fakeHost(), { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), spawn: async (a: any) => { const req = JSON.parse(a.input); seen.push({ argv: a.argv, req }); return { exitCode: 0, stderr: '', ...reply(req) } } })
const A = { command: ['adapter', '--x'], grants: ['sync', 'events'] as any }

describe('adapter protocol client', () => {
  test('frames {protocol, v, method, params} on stdin and returns result', async () => {
    const seen: any[] = [], h = host(() => ({ stdout: '{"v":1,"ok":true,"result":{"pong":true}}' }), seen)
    expect(await call(h, 'a', A, 'ping')).toEqual({ pong: true })
    expect(seen[0].req).toEqual({ protocol: 'cadre-adapter', v: 1, method: 'ping', params: {} }); expect(seen[0].argv).toEqual(['adapter', '--x'])
  })
  test('grants are enforced before any process starts', async () => {
    const seen: any[] = [], h = host(() => ({ stdout: '' }), seen)
    for (const m of ['push', 'pull', 'describeSchema', 'listProjects', 'validateAccess']) { try { await call(h, 'a', { ...A, grants: ['events'] }, m); expect(true).toBe(false) } catch (e) { expect((e as AdapterError).code).toBe('Unsupported') } }
    try { await call(h, 'a', { ...A, grants: ['sync'] }, 'deliver'); expect(true).toBe(false) } catch (e) { expect((e as AdapterError).code).toBe('Unsupported') }
    expect(seen).toHaveLength(0)
  })
  test('error frames map to codes; unknown codes and versions are Invalid; non-zero exit is Offline', async () => {
    const code = async (stdout: string, exitCode = 0) => { try { await call(host(() => ({ stdout, exitCode })), 'a', A, 'ping') } catch (e) { return (e as AdapterError).code + ((e as AdapterError).retryAfterMs ?? '') } }
    expect(await code('{"v":1,"ok":false,"error":{"code":"RateLimited","message":"m","retryAfterMs":7}}')).toBe('RateLimited7')
    expect(await code('{"v":1,"ok":false,"error":{"code":"Nope","message":"m"}}')).toBe('Invalid')
    expect(await code('{"v":2,"ok":true,"result":1}')).toBe('Invalid')
    expect(await code('', 2)).toBe('Offline')
  })
})

describe('3-way merge', () => {
  const base = { l: { title: hash('a'), status: hash('todo') }, r: { title: hash('a'), status: hash('todo') } }
  test('remote-only change is pulled; both changed -> conflict (beads wins); status change -> drift + resend', () => {
    expect(merge({ title: 'a' }, { title: 'b' }, base).pull).toEqual({ title: 'b' })
    expect(merge({ title: 'x' }, { title: 'b' }, base).conflict).toEqual(['title'])
    const d = merge({ title: 'a', status: 'todo' }, { status: 'Closed' }, base); expect(d.drift).toBe(true); expect(d.next.l.status).toBeUndefined()
    expect(merge({ title: 'a' }, { title: 'a' }, base).pull).toEqual({})
  })
})

describe('bd journal -> events (real bd 1.3.1 records)', () => {
  test('status and assignee come from the issue snapshot; ops are create|update|close', async () => {
    const s = new BdStore({ run: async () => ({ exitCode: 0, stdout: EVENTS_TAIL, stderr: '' }), cwd: '/r', actor: 'a' }); (s as any).journal = true
    const ev = (await s.events('0'))!.events
    expect(ev.map(e => [e.op, e.actor, e.status, e.assignee])).toEqual([['create', 'it-dainb', 'open', undefined], ['update', 'jira', 'open', undefined], ['update', 'jira', 'in_progress', undefined], ['update', 'jira', 'in_progress', 'bob'], ['update', 'jira', 'in_progress', 'bob'], ['update', 'jira', 'in_progress', 'bob'], ['close', 'jira', 'closed', 'bob']])
  })
})

describe('sync flags gate transitions (11.4: external / drift)', () => {
  const pipe = () => ['worker', 'green', 'reviewer', 'merge']
  const world = async (flag: string, strictness?: string) => {
    const h = fakeHost({ options: { strictness } }); await h.board.update(b => ({ ...b, epic: 'e', tasks: [task('a', { state: 'todo', flags: [flag] })] })); return h
  }
  test('strict refuses claim until resolved; advisory allows; release stays possible', async () => {
    for (const f of ['external', 'drift']) {
      const h = await world(f); const r = await apply(h, { kind: 'claim', id: 'a', at: 1, owner: 's' } as any, pipe)
      expect(r.ok).toBe(false); expect((r as any).error).toContain(`flag ${f}`)
    }
    expect((await apply(await world('drift', 'advisory'), { kind: 'claim', id: 'a', at: 1, owner: 's' } as any, pipe)).ok).toBe(true)
    expect((await apply(await world('edited'), { kind: 'claim', id: 'a', at: 1, owner: 's' } as any, pipe)).ok).toBe(true)
  })
})

describe('fx-data: sync events and confirm stage', () => {
  test('sync.state_changed carries pending and conflicts (tasks flagged drift/external) when non-zero', async () => {
    const h = fakeHost(); await h.board.update(s => ({ ...s, tasks: [task('a', { flags: ['drift:pm:status'] }), task('b', { flags: ['external'] }), task('c')] }))
    await setState(h, 'pm', 'offline', 4); await setState(h, 'pm', 'ok', 0)
    const evs = (await h.events.read()).epics[''].filter(e => e.type === 'sync.state_changed')
    expect(evs.map(e => e.data)).toEqual([expect.objectContaining({ state: 'offline', pending: 4, conflicts: 2 }), expect.objectContaining({ state: 'ok', conflicts: 2 })])
    expect('pending' in evs[1].data).toBe(false)
  })
  test('sync add has its own confirm stage: an init stage-8 code does not confirm it', async () => {
    const h = Object.assign(fakeHost(), { config: async () => ({ adapters: { pm: A } }) }) as any
    await h.store.set('sync.add:pm', { n: 1, d: {}, pending: { n: 1, args: [], text: 't' } })
    const code = await initPropose(h, 8, 'd')
    expect(await syncAdd(h, 'pm', ['confirm', code])).toContain('wrong code')
  })
})
