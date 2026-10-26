// Liveness: a human dialog answer that leaves work ready to start (Retry, Already holds, Keep, shape Retry) must lead to a spawn: in mod mode only a turn end
// starts agents, so the answer queues main's one short turn (core/drive.kick) or the idle watchdog does, whatever else is bound.
import { describe, expect, test } from 'claude-code/testing'
import { world } from './fixtures/replay/world'
import { arm, idle, watchdog, IDLE } from '../core/drive'
import { decide } from '../commands/cadre'
import { ROUTES } from '../core/dispatch'

const RED_PKG = { root: '.', checks: { compile: ['tsc'] }, tdd: { paths: ['test/**'] } }
const TESTS = [{ path: 'test/a.test.js', name: 'S1: answers', scenario: 'S1' }]
// auto mode, one task red-blocked (its dialog pending), main's last turn already ended
async function redWorld() {
  const w = await world({ n: 1, type: 'feature', pkg: RED_PKG, drive: 'auto' }); await arm(w.h, 'auto'); const [id] = w.ids
  await w.at('ag1', id, 'tester'); await w.rep('ag1', { role: 'tester', outcome: 'done', summary: 's', tests: TESTS }); await w.turn()
  return { w, id }
}
const answer = async (w: any, id: string) => { const d = (await w.h.board.read()).decisions.find((x: any) => x.id === `flag:${id}:red`); return (await decide(w.h, d.id, 'r', d.hash)).text }
const blocked = (w: any, id: string, flag: string) => w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, state: 'blocked', flags: [flag] } : t)) })).then(() => w.store.move(id, 'blocked', w.dep.actor))
const resolve = async (w: any, ...args: string[]) => (await ROUTES.resolve!(w.h, { cmd: 'resolve', args } as any)).text
describe('a dialog answer that unblocks a task starts it', () => {
  // live (milestone-planners): c-75-1's tester ended on its malformed reports (shape block); its run stayed `running` and bound. The answers (shape Retry, then the red Retry
  // of c-242-1) left work to start, but idle() counted the dead run as running: no brief, no spawn, zero requests until the budget ended.
  test('an unblock ends the dead runs of its task: the fallback is idle and the next turn end starts both testers', async () => {
    const w = await world({ n: 2, type: 'feature', pkg: RED_PKG, drive: 'auto' }); await arm(w.h, 'auto'); const [a, b] = w.ids
    await w.at('ag1', a, 'tester'); await w.at('ag2', b, 'tester'); await w.rep('ag2', { role: 'tester', outcome: 'done', summary: 's', tests: TESTS })
    await blocked(w, a, 'shape'); await w.stop('ag1')   // its turn ended on the blocked task: nothing ended the run
    await w.turn()
    expect(await resolve(w, a, 'retry')).toContain('its agent starts again'); expect(await answer(w, b)).toContain('back to the tester')
    const u: any = await w.h.ui.read(); expect(u.runs.ag1.state.state).toBe('ended'); expect(Object.keys(await w.h.bind.read())).toEqual([])
    expect(await idle(w.h)).toBe(true)
    await w.h.ui.update((x: any) => ({ ...x, goal: undefined })); await watchdog(w.h); w.clock.now += 125_000; await watchdog(w.h); expect((await w.h.ui.read()).goal).toBe(IDLE)   // main may have gone quiet: the watchdog queues the turn
    w.spawned.length = 0; await w.turn(); expect(w.spawned.map(x => x[2]).sort()).toEqual(['cadre:tester', 'cadre:tester'])
  })
})
