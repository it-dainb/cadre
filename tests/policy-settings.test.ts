import { expect, test } from 'claude-code/testing'
import { apply, deepMerge, diff, plan } from '../policy/settings'
import { assess, contain } from '../policy/containment'
import { fakeHost } from './support'
import STAGE5 from './fixtures/settings/stage5'

const mem = (files: Record<string, string>) => ({ readText: async (p: string) => files[p] ?? null, writeText: async (p: string, t: string) => { files[p] = t } })

test('deep-merge: objects merge, arrays union, scalars patch-wins', () => {
  expect(deepMerge({ a: { b: 1, l: ['x'] }, k: 1 }, { a: { c: 2, l: ['x', 'y'] }, k: 2 })).toEqual({ a: { b: 1, c: 2, l: ['x', 'y'] }, k: 2 })
  expect(diff({ a: { l: ['x'], k: 1 } }, { a: { l: ['x', 'y'], k: 2, n: true } })).toEqual(['+ a.l[]: "y"', '~ a.k: 1 -> 2', '+ a.n: true'])
})
test('apply: writes .bak of old bytes, merged file, idempotent second run', async () => {
  const files: Record<string, string> = { '/r/.claude/settings.local.json': '{"permissions":{"allow":["Read"]}}' }
  const r = await apply(mem(files), '/r/.claude/settings.local.json', STAGE5)
  expect(r.lines.length).toBeGreaterThan(5)
  expect(files['/r/.claude/settings.local.json.bak']).toBe('{"permissions":{"allow":["Read"]}}')
  expect(JSON.parse(files['/r/.claude/settings.local.json'])).toMatchObject({ permissions: { allow: ['Read'] }, sandbox: { enabled: true } })
  expect((await apply(mem(files), '/r/.claude/settings.local.json', STAGE5)).lines).toEqual([])
})
test('plan refuses invalid JSON instead of overwriting', async () => { await expect(plan(mem({ '/s': '{nope' }), '/s', {})).rejects.toThrow('not valid JSON') })

test('containment: stage-5 settings -> contained; each gap -> degraded; excludedCommands counted', async () => {
  expect(assess(STAGE5, '/x/repo', '/wt/repo')).toMatchObject({ state: 'contained', unsandboxed: 0 })
  expect(assess({ ...STAGE5, sandbox: { ...STAGE5.sandbox, enabled: false } }, '/x/repo', '/wt/repo').state).toBe('degraded')
  expect(assess(STAGE5, '/other', '/wt/repo').state).toBe('degraded')
  expect(assess({ sandbox: { ...STAGE5.sandbox, network: { allowLocalBinding: true } } }, '/x/repo', '/wt/repo').state).toBe('degraded')
  expect(assess({ sandbox: { ...STAGE5.sandbox, excludedCommands: ['docker', 'git'] } }, '/x/repo', '/wt/repo')).toMatchObject({ state: 'contained', unsandboxed: 2 })
})
test('contain(): commits the band state and toasts when degraded', async () => {
  const h = fakeHost(); await h.store.set('policy', { repo: '/x/repo', wtRoot: '/wt/repo' })
  h.settings = async () => STAGE5
  await contain(h); expect((await h.board.read()).containment).toEqual({ state: 'contained', unsandboxed: 0 }); expect(h.toasts).toEqual([])
  h.settings = async () => ({}); await contain(h)
  expect((await h.board.read()).containment.state).toBe('degraded'); expect(h.toasts[0]).toContain('degraded')
  h.settings = async () => { throw new Error('x') }; await contain(h); expect((await h.board.read()).containment.state).toBe('unknown')
})
