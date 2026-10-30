import { describe, expect, test } from 'claude-code/testing'
import { fakeHost, task } from './support'
import { apply } from '../core/machine'
import { setState, syncAdd } from '../core/syncrun'
import { initPropose } from '../core/dispatch'

const A = { command: ['adapter', '--x'], grants: ['sync', 'events'] as any }

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
  test('sync add has its own confirm stage: an init stage-8 card does not confirm it', async () => {
    const h = Object.assign(fakeHost(), { config: async () => ({ adapters: { pm: A } }) }) as any
    await h.store.set('sync.add:pm', { n: 1, d: {}, pending: { n: 1, args: [], text: 't' } })
    await initPropose(h, 8, 'd', { title: 't', lines: [], sub: 'init' })
    expect(await syncAdd(h, 'pm', ['confirm'])).toContain('nothing pending')
  })
})
