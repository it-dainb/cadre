// The red dialog's "Already holds": offered only when a test passes at red for named scenarios; choosing it records the holds amendment (ledger, original kept) and sends the task back to its tester.
import { describe, expect, test } from 'claude-code/testing'
import { world, ACCEPT } from './fixtures/replay/world'
import { ROUTES } from '../core/dispatch'
import { holdsOf } from '../core/validate'
import { arm } from '../core/drive'
import { redAsk } from '../core/close'

const ACC2 = `${ACCEPT}\nS2: Given x When y Then z`
const red = async (passing?: string[]) => {
  const w = await world({ type: 'feature' }), [id] = w.ids; await w.store.update(id, { acceptance: ACC2 } as any, w.dep.actor); await arm(w.h, 'auto'); await w.at('ag1', id, 'tester')
  const g = { ok: false, why: 'test "S2 x" passed at red; it must fail', card: 'red ✗', passing }
  return { w, id, g }
}
describe('red dialog: Already holds', () => {
  test('offered only with named passing scenarios; the option labels stay unique per key', async () => {
    const { w, id } = await red(), opts = async (p?: string[]) => { await redAsk(w.h, w.dep, id, 'why', p); return ((await w.h.board.read()).decisions ?? []).find((d: any) => d.id === `flag:${id}:red`)!.options.map((o: any) => o.label) }
    expect(await opts()).toEqual(['Retry', 'Cancel task']); expect(await opts(['S2'])).toEqual(['Retry', 'Already holds', 'Cancel task'])
  })
  test('choosing it records the amendment, keeps the original, and the task goes back to the tester', async () => {
    const { w, id } = await red(); await w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, state: 'blocked', flags: ['red'] } : t)) })); await w.store.move(id, 'blocked', w.dep.actor)
    expect(await ROUTES.resolve!(w.h, { cmd: 'resolve', args: [id, 'holds', 'S9'] } as any)).toEqual({ text: expect.stringContaining('not a scenario') })   // an id the task has not is refused
    const r = await ROUTES.resolve!(w.h, { cmd: 'resolve', args: [id, 'holds', 'S2'] } as any)
    const t = await w.store.get(id), led = JSON.parse(t.meta['cadre.amendments']); expect(holdsOf(t)).toEqual(['S2']); expect(led).toHaveLength(1); expect(led[0]).toMatchObject({ criterion: 'holds', original: '(none)' }); expect(t.acceptance).toBe(ACC2)
    expect(r.text).toContain('back to the tester')
  })
})
