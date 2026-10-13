// Mod mode (ADR 0018), main's side: the digest rides main's next prompt once; a task-notification of an agent cadre started never reaches main.
import { describe, expect, test } from 'claude-code/testing'
import { context } from '../core/briefs'
import { submit } from '../core/reuse'
import { told } from '../core/spawner'
import { fakeHost } from './support'

describe('main in mod mode', () => {
  test('the digest is context on main\'s next prompt, once, even when the board line did not change', async () => {
    const h = fakeHost(), seen: any[] = [], next = async (e: any) => (seen.push(e), { text: e.text })
    await told(h, 'm-2 "Add login" landed'); await told(h, 'plan m-1 completed')
    await context(h, { text: 'hi' }, next)
    expect(seen[0].context).toEqual(['Landed since your last turn: m-2 "Add login" landed; plan m-1 completed'])
    await context(h, { text: 'again' }, next); expect(seen[1].context).toBeUndefined()
  })
  test('a task-notification of an agent the spawner started is dropped; main\'s own agents pass', async () => {
    const h = fakeHost(), seen: any[] = [], next = async (e: any) => (seen.push(e), { text: e.text })
    await h.ui.update(u => ({ ...u, own: ['ag7'] }))
    const note = (id: string) => ({ text: `<task-notification><task-id>${id}</task-id><status>completed</status></task-notification>`, origin: { kind: 'task-notification' } })
    expect(await submit(h, note('ag7'), next)).toEqual({ drop: 'cadre handled this agent' }); expect(seen).toEqual([])
    await submit(h, note('ag8'), next); expect(seen.length).toBe(1)
  })
})
