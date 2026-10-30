// Liveness: a human dialog answer that leaves work ready to start (Retry, Already holds, Keep, shape Retry) must lead to a spawn: in mod mode only a turn end
// starts agents, so the answer queues main's one short turn (core/drive.kick) or the idle watchdog does, whatever else is bound.
import { describe, expect, test } from 'claude-code/testing'
import { world } from './fixtures/replay/world'
import { arm, idle, watchdog, IDLE } from '../core/drive'
import { decide } from '../commands/cadre'
import { ROUTES } from '../core/dispatch'
import { LIFECYCLE } from '../core/plantools'

const RED_PKG = { root: '.', checks: { compile: ['tsc'] }, tdd: { paths: ['test/**'] } }
const TESTS = [{ path: 'test/a.test.js', name: 'S1: answers', ids: ['S1'] }]
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
    await blocked(w, a, 'shape')   // a run no stop ended (a missed turn end): the unblock still ends it
    await w.turn()
    expect(await resolve(w, a, 'retry')).toContain('its agent starts again'); expect(await answer(w, b)).toContain('back to the tester')
    const u: any = await w.h.ui.read(); expect(u.runs.ag1.state.state).toBe('ended'); expect(Object.keys(await w.h.bind.read())).toEqual([])
    expect(await idle(w.h)).toBe(true)
    await w.h.ui.update((x: any) => ({ ...x, goal: undefined })); await watchdog(w.h); w.clock.now += 125_000; await watchdog(w.h); expect((await w.h.ui.read()).goal).toBe(IDLE)   // main may have gone quiet: the watchdog queues the turn
    w.spawned.length = 0; await w.turn(); expect(w.spawned.map(x => x[2]).sort()).toEqual(['cadre:tester', 'cadre:tester'])
  })
  // live: main's AskUserQuestion answer reached `status {decision}` after the dialog's Retry had resumed the task: the refusal must say so
  test('a decision for a task the dialog already resumed says it went on', async () => {
    const { w, id } = await redWorld(); await answer(w, id)
    const r = await LIFECYCLE.decision!(w.h, id, { metadata: { decision: 'go' } })
    expect(r).toContain('already answered its dialog'); expect(r).toContain('went on')
  })
  test('a finished tester on a blocked task is ended at its stop: the fallback is idle for another ready task before any answer', async () => {
    const w = await world({ n: 2, type: 'feature', pkg: RED_PKG, drive: 'auto' }); await arm(w.h, 'auto'); const [a] = w.ids
    await w.at('ag1', a, 'tester'); await blocked(w, a, 'shape'); await w.stop('ag1')   // task B stays ready to start
    expect(((await w.h.ui.read()) as any).runs.ag1.state.state).toBe('ended'); expect(await idle(w.h)).toBe(true)
    await w.h.ui.update((x: any) => ({ ...x, goal: undefined })); await watchdog(w.h); w.clock.now += 125_000; await watchdog(w.h); expect((await w.h.ui.read()).goal).toBe(IDLE)
  })
  test('a decision for a task that is not blocked: resumed says the dialog won; done or cancelled is neutral', async () => {
    const { w, id } = await redWorld(); await answer(w, id)
    expect(await LIFECYCLE.decision!(w.h, id, { metadata: { decision: 'go' } })).toContain('already answered its dialog')
    await w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, state: 'done' } : t)) }))
    expect(await LIFECYCLE.decision!(w.h, id, { metadata: { decision: 'go' } })).toBe(`${id} is done; nothing to decide`)
  })
  test('cancelling a task ends every run bound to it', async () => {
    const w = await world({ n: 1, type: 'feature', pkg: RED_PKG, drive: 'auto' }); await arm(w.h, 'auto'); const [a] = w.ids
    await w.at('ag1', a, 'tester'); expect(await LIFECYCLE.deleted!(w.h, a, { metadata: { reason: 'x' } })).toBeNull()
    expect(Object.keys(await w.h.bind.read())).toEqual([])
  })
  // live (milestone-planners): c-280-1's reviewer sent 6 malformed reports (shape block at review·reviewer); Retry resumed the bound WORKER, which had nothing to report there; its run stayed bound and `running`, no reviewer spawned
  test('a shape block at the reviewer step: Retry does not resume the bound worker; a fresh reviewer spawns', async () => {
    const w = await world({ n: 1, drive: 'auto' }); await arm(w.h, 'auto'); const [a] = w.ids
    await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn(); await blocked(w, a, 'shape');; await w.stop('ag2')   // the worker stays bound; the reviewer's reports were malformed
    expect(await resolve(w, a, 'retry')).toContain('its agent starts again')
    expect(w.sent.filter(x => x[0] === 'ag1')).toEqual([]); expect(((await w.h.ui.read()) as any).runs.ag1.state.state).toBe('idle-bound')   // not resumed
    w.spawned.length = 0; await w.turn(); expect(w.spawned.map(x => x[2])).toEqual(['cadre:reviewer'])
  })
  test('a worker whose turn ends while its task is at another step: its run ends', async () => {
    const w = await world({ n: 1, type: 'feature', pkg: RED_PKG, drive: 'auto' }); await arm(w.h, 'auto'); const [a] = w.ids
    await w.at('ag1', a, 'worker')
    await w.h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'review', step: 'reviewer' } : t)) })); await w.stop('ag1')
    expect(((await w.h.ui.read()) as any).runs.ag1.state.state).toBe('ended')
  })
  test('Keep on a no-report block at the reviewer step: the worker is not resumed; a fresh reviewer spawns', async () => {
    const w = await world({ n: 1, drive: 'auto' }); await arm(w.h, 'auto'); const [a] = w.ids
    await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.turn(); await blocked(w, a, 'no-report'); await w.stop('ag2')
    expect(await resolve(w, a, 'keep')).toContain('continues from the last checkpoint')
    expect(w.sent.filter(x => x[0] === 'ag1')).toEqual([])
    w.spawned.length = 0; await w.turn(); expect(w.spawned.map(x => x[2])).toEqual(['cadre:reviewer'])
  })
  test('rework: the worker that reported and stopped is resumed by the reviewer\'s changes verdict', async () => {
    const w = await world({ n: 1, drive: 'auto' }); await arm(w.h, 'auto')
    await w.turn(); await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await w.stop('ag1'); await w.turn()
    expect(await w.rep('ag2', { role: 'reviewer', verdict: 'changes', summary: 'fix it', findings: [{ severity: 'major', file: 'src/a.ts', issue: 'wrong answer' }], coverage: [{ scenario: 'S1', ok: false }], contractStatus: [] })).toContain('changes (1/'); await w.turn()
    expect(w.sent.map(x => x[0])).toContain('ag1'); expect(((await w.h.ui.read()) as any).runs.ag1.state.state).toBe('running')
  })
})
