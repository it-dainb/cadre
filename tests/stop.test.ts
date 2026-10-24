// Stop causes (ADR 0024 §2.6 invariant 4): a drive stop names its cause {taskId, flag} or a usage limit's resetAt; resolving the cause lifts the stop, and the run
// goes on by the one path: kick -> queueBrief -> main's turn end -> the spawner. No dialog answer, press or timer starts an agent itself.
import { describe, expect, test } from 'claude-code/testing'
import { world, type World } from './fixtures/replay/world'
import { arm, kick, stop, tally, watchdog } from '../core/drive'
import { emit } from '../core/events'
import { defaults } from '../config/index'
import { stopped } from '../core/close'
import { decide } from '../commands/cadre'
import { ROUTES } from '../core/dispatch'
import { budgetOf } from '../core/lifecycle'
import { check } from '../config/index'

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
  test('settings: limits.limitWaitMinutes is at least 1 (0 would lift a limit with no reported reset at once)', () => {
    expect(check('limits.limitWaitMinutes', 0)).toBe('expected a number from 1 to 300'); expect(check('limits.limitWaitMinutes', 1)).toBeNull()
  })
  test('settings: limits.limitWaitMinutes 1 waits until a later reported reset', async () => {
    const w = await world(); w.cfg.limits.limitWaitMinutes = 1; await arm(w.h, 'auto'); await w.turn(); const now = await w.h.now()
    Object.assign(w.h, { usage: async () => ({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(now + 90_000).toISOString() }] }) })
    await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error', answer: 'API Error' })
    expect((await w.h.board.read()).drive.cause!.resetAt).toBe(now + 90_000)
  })
  test('or on the band\'s press (drive resume), by the same path', async () => {
    const { w } = await limit(), calls = watch(w)
    const press = { ...w.h, spawnAgent: undefined } as any   // a press is no frame to start agents from
    expect((await ROUTES.drive!(press, { schemaVersion: 1, cmd: 'drive', args: ['resume'], origin: { kind: 'press' } } as any)).text).toBe('drive resumed')
    expect(calls).toEqual([]); expect((await w.h.ui.read()).goal).toBeDefined()
    await w.turn(); expect(calls).toHaveLength(1)
  })
})

describe('review fixes: one cause, one stop', () => {
  test('a usage limit seen by a session whose board is not stopped yet keeps the record\'s cause; its reset does not lift the other stop', async () => {
    const w = await redStopped(), [id] = w.ids, w2 = await world({ store: w.store, kv: w.kv, session: 's2' })
    await w2.h.board.update(b => ({ ...b, epic: w.epic, plan: (b as any).plan ?? { id: w.epic, slug: 'service', state: 'approved', epicBranch: 'epic/p1-service', mode: 'yolo' }, drive: { ...b.drive, on: true, epicId: w.epic, mode: 'yolo' } }))
    await stop(w2.h, 'usage limit until 00:15 UTC', { flag: 'limit', resetAt: 1 })   // the record already holds the red stop
    expect((await w2.h.board.read()).drive).toMatchObject({ stopped: `blocked ${id}`, cause: { taskId: id, flag: 'red' } })
  })
  test('another session lifted the record already: this session\'s board follows and is no longer stopped', async () => {
    const w = await redStopped(), [id] = w.ids, w2 = await world({ store: w.store, kv: w.kv, session: 's2' }), cause = { taskId: id, flag: 'red' }
    await w2.h.board.update(b => ({ ...b, epic: w.epic, plan: (b as any).plan ?? { id: w.epic, slug: 'service', state: 'approved', epicBranch: 'epic/p1-service', mode: 'yolo' }, drive: { ...b.drive, on: true, epicId: w.epic, mode: 'yolo', stopped: `blocked ${id}`, cause } }))
    await retry(w, id); expect((await w.h.board.read()).drive.stopped).toBeUndefined()   // session 1 lifts the record
    await kick(w2.h); expect((await w2.h.board.read()).drive).toMatchObject({ stopped: undefined, cause: undefined })
  })
  test('a cause with no flag never lifts by itself (no stop-resume churn)', async () => {
    const w = await world(), [id] = w.ids; await arm(w.h, 'yolo')
    await stop(w.h, `${id} is blocked with no question to answer`, { taskId: id } as any); await kick(w.h); await kick(w.h)
    expect((await w.h.board.read()).drive.stopped).toBe(`${id} is blocked with no question to answer`)
    expect(Object.values((await w.h.events.read()).epics).flat().filter(e => e.type === 'drive.status' && e.data.state === 'resumed')).toEqual([])
  })
})

describe('the no-progress count', () => {
  test('progress seen by a tally that charges no turn still resets it: the next turn is not the third idle one', async () => {
    const w = await world(); await arm(w.h, 'auto'); const cfg = defaults(), [id] = w.ids
    for (let i = 0; i < 3; i++) await tally(w.h, cfg, undefined, 1)   // turn 1 (fresh) + two idle ones: count 2 of 3
    await emit(w.h, 'task.transitioned', { taskId: id, from: 'active', to: 'blocked' }, { taskId: id })
    await tally(w.h, cfg, undefined, 0)   // progress, no turn charged (a spawner pass with nothing to start)
    expect(await tally(w.h, cfg, undefined, 1)).toBe(true); expect((await w.h.board.read()).drive.stopped).toBeUndefined()
  })
})

describe('a step back: the store and the words', () => {
  test('the red Retry leaves the store at the tester step: a rebuilt board does not start the worker', async () => {
    const w = await redStopped(), [id] = w.ids
    const st = await w.h.taskStore!(); await st.setMeta(id, { 'cadre.step': 'worker' }, 'x')   // what an earlier pass left in the store (a tester's done advanced it)
    await retry(w, id); expect((await st.get(id)).meta['cadre.step']).toBe('tester')
  })
})
