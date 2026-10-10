import { describe, expect, test } from 'claude-code/testing'
import { AdapterError, call } from '../task-management/protocol'
import { hash, merge } from '../task-management/sync-engine/merge'
import { fakeHost } from './support'

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
