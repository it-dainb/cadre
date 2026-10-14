// Stop causes (ADR 0024 §2.6 invariant 4): a drive stop names its cause {taskId, flag} or a usage limit's resetAt; resolving the cause lifts the stop, and the run
// goes on by the one path: kick -> queueBrief -> main's turn end -> the spawner. No dialog answer, press or timer starts an agent itself.
import { describe, expect, test } from 'claude-code/testing'
import { world, type World } from './fixtures/replay/world'
import { arm, watchdog } from '../core/drive'
import { stopped } from '../core/close'
import { decide } from '../commands/cadre'
import { ROUTES } from '../core/dispatch'
import { budgetOf } from '../core/lifecycle'

const RED_PKG = { root: '.', checks: { compile: ['tsc'] }, tdd: { paths: ['test/**'] } }   // no check that runs the tests: red blocks with one dialog
const TESTS = [{ path: 'test/a.test.js', name: 'S1: answers', scenario: 'S1' }]
// yolo, every task's tester reported a red that cannot be made: each task blocked with flag red and its dialog; a turn end stops the run on the first
async function redStopped(n = 1) {
  const w = await world({ n, type: 'feature', pkg: RED_PKG, drive: 'yolo' }); await arm(w.h, 'yolo')
  for (const [i, id] of w.ids.entries()) { await w.at(`ag${i + 1}`, id, 'tester'); await w.rep(`ag${i + 1}`, { role: 'tester', outcome: 'done', summary: 's', tests: TESTS }) }
  await w.turn(); return w
}
// count spawnAgent calls made outside a turn end
const watch = (w: World) => { const calls: string[] = [], sp = w.h.spawnAgent; w.h.spawnAgent = (a: any) => (calls.push(a.prompt), sp(a)); return calls }
const retry = async (w: World, id: string) => { const d = (await w.h.board.read()).decisions!.find(x => x.id === `flag:${id}:red`)!; return (await decide(w.h, d.id, 'r', d.hash)).text }

describe('a stop names its cause; its answer lifts it', () => {
  test('yolo red stop: cause {task, red}; Retry clears it, main gets a turn, and its turn end starts the new tester', async () => {
    const w = await redStopped(), [id] = w.ids
    expect((await w.h.board.read()).drive).toMatchObject({ stopped: `blocked ${id}`, cause: { taskId: id, flag: 'red' } })
    const calls = watch(w); expect(await retry(w, id)).toContain('back to the tester')
    expect(calls).toEqual([])   // the dialog's answer is no frame to start an agent from
    expect((await w.h.board.read()).drive.stopped).toBeUndefined(); expect((await w.h.ui.read()).goal).toBeDefined()   // kick -> queueBrief: main's turn
    await w.turn(); expect(w.spawned.map(x => x[2])).toEqual(['cadre:tester']); expect(calls).toHaveLength(1)   // main's turn end: the spawner
    expect((await budgetOf(w.h, id)).red).toBe(0)   // human.retry{red}: only that counter
  })
  test('a stop for task A survives a Retry on task B', async () => {
    const w = await redStopped(2), [a, b] = w.ids
    expect((await w.h.board.read()).drive.cause).toEqual({ taskId: a, flag: 'red' })
    await retry(w, b)
    expect((await w.h.board.read()).drive).toMatchObject({ stopped: `blocked ${a}`, cause: { taskId: a, flag: 'red' } })
    await retry(w, a); expect((await w.h.board.read()).drive.stopped).toBeUndefined()
  })
})

describe('a usage limit: a stop with its reset time, no budget charged', () => {
  async function limit() {
    const w = await world(); await arm(w.h, 'auto'); await w.turn()
    Object.assign(w.h, { usage: async () => ({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(0).toISOString() }] }) })
    await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error', answer: 'API Error' })
    return { w, at: (await w.h.board.read()).drive.cause!.resetAt! }
  }
  test('the band shows when it resets; nothing starts before; the timer lifts it at resetAt and main\'s turn end starts the task again', async () => {
    const { w, at } = await limit(), [id] = w.ids, d = (await w.h.board.read()).drive
    expect(d.stopped).toMatch(/^usage limit until \d\d:\d\d UTC$/); expect(d.cause).toEqual({ flag: 'limit', resetAt: at })
    const { epoch: _e, ...charged } = await budgetOf(w.h, id); expect(Object.values(charged).every(v => v === 0)).toBe(true)
    const calls = watch(w); await watchdog(w.h); await w.turn(); expect(calls).toEqual([])   // before the reset: still stopped
    w.clock.now = at + 1000; await watchdog(w.h); expect(calls).toEqual([]); expect((await w.h.board.read()).drive.stopped).toBeUndefined()
    await w.turn(); expect(calls).toHaveLength(1); expect(w.spawned).toHaveLength(2)
  })
  test('or on the band\'s press (drive resume), by the same path', async () => {
    const { w } = await limit(), calls = watch(w)
    const press = { ...w.h, spawnAgent: undefined } as any   // a press is no frame to start agents from
    expect((await ROUTES.drive!(press, { schemaVersion: 1, cmd: 'drive', args: ['resume'], origin: { kind: 'press' } } as any)).text).toBe('drive resumed')
    expect(calls).toEqual([]); expect((await w.h.ui.read()).goal).toBeDefined()
    await w.turn(); expect(calls).toHaveLength(1)
  })
})
