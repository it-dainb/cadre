import { describe, expect, test } from 'claude-code/testing'
import { apply, epicNext, pendingSkips, transition } from '../core/machine'
import type { MEvent, MKind } from '../core/machine'
import { defaults, pipeOf } from '../task-management/registry'
import { emptySnapshot } from '../core/board'
import { fakeHost, task } from './support'
import type { Category, Snapshot } from '../types'

const pipe = pipeOf(defaults())
const board = (...tasks: ReturnType<typeof task>[]): Snapshot => ({ ...emptySnapshot('r'), tasks })
const step = (s: Snapshot, id: string, kind: MKind, o: Partial<MEvent> = {}) => {
  const r = transition(s, { kind, id, at: 5, ...o }, pipe)
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('pipeline walk', () => {
  test('feature: draft to done through every step, one phase_changed per step', async () => {
    let s = board(task('a', { state: 'draft' }))
    const seen: string[] = []
    const go = (kind: MKind, o: Partial<MEvent> = {}) => { const r = step(s, 'a', kind, o); s = r.board; r.events.forEach(e => e.type === 'task.phase_changed' && seen.push(`${e.data.from || '-'}>${e.data.to}`)) }
    go('approve'); go('claim', { owner: 'cadre/u/x' })
    expect(s.tasks[0]).toMatchObject({ state: 'active', step: 'tester', owner: 'cadre/u/x' })
    go('advance'); go('advance'); go('advance')
    expect(s.tasks[0]).toMatchObject({ state: 'active', step: 'green' })
    go('advance')
    expect(s.tasks[0]).toMatchObject({ state: 'review', step: 'reviewer' })
    go('verdict', { verdict: 'pass' })
    expect(s.tasks[0]).toMatchObject({ state: 'review', step: 'merge' })
    go('close')
    expect(s.tasks[0].state).toBe('done')
    expect(seen).toEqual(['->tester', 'tester>red', 'red>worker', 'worker>green', 'green>reviewer', 'reviewer>merge'])
  })
  test('rework returns to the producing step: worker for feature, tester for test', async () => {
    const f = step(board(task('a', { state: 'review', step: 'reviewer' })), 'a', 'verdict', { verdict: 'changes' })
    expect(f.board.tasks[0]).toMatchObject({ state: 'active', step: 'worker' })
    const t = step(board(task('b', { type: 'test', state: 'review', step: 'reviewer' })), 'b', 'verdict', { verdict: 'changes' })
    expect(t.board.tasks[0]).toMatchObject({ state: 'active', step: 'tester' })
  })
  test('spike: explorer -> report -> done, never merges', async () => {
    let s = step(board(task('s', { type: 'spike', kind: 'spike', merges: false })), 's', 'claim', { owner: 'o' }).board
    expect(s.tasks[0].step).toBe('explorer')
    s = step(s, 's', 'advance').board
    expect(s.tasks[0]).toMatchObject({ state: 'active', step: 'report' })
    expect(step(s, 's', 'close').board.tasks[0].state).toBe('done')
  })
  test('phaseSince moves only when the step moves', async () => {
    const s = board(task('a', { state: 'active', step: 'worker', phaseSince: 1 }))
    expect(step(s, 'a', 'block', { at: 99 }).board.tasks[0].phaseSince).toBe(1)
    expect(step(s, 'a', 'advance', { at: 99 }).board.tasks[0].phaseSince).toBe(99)
  })
})

describe('legal-from table', () => {
  const FROM: Record<MKind, Category[]> = {
    approve: ['draft'], amend: ['todo', 'blocked'], claim: ['todo'], advance: ['active'], verdict: ['review'], close: ['review', 'active'],
    block: ['active', 'review'], unblock: ['blocked'], release: ['active', 'review', 'blocked'], skip: ['todo'], cancel: ['draft', 'todo', 'active', 'review', 'blocked'],
  }
  const ALL: Category[] = ['draft', 'todo', 'active', 'review', 'blocked', 'done', 'cancelled']
  for (const kind of Object.keys(FROM) as MKind[]) {
    test(`${kind}: refused from every state outside its legal-from set`, async () => {
      for (const from of ALL.filter(c => !FROM[kind].includes(c))) {
        const r = transition(board(task('a', { state: from, step: 'worker' })), { kind, id: 'a', at: 1, verdict: 'pass' }, pipe)
        expect(r.ok).toBe(false)
      }
    })
  }
  test('close needs review pass (or a spike report); verdict needs the reviewer step', async () => {
    expect(transition(board(task('a', { state: 'review', step: 'reviewer' })), { kind: 'close', id: 'a', at: 1 }, pipe).ok).toBe(false)
    expect(transition(board(task('a', { state: 'active', step: 'worker' })), { kind: 'close', id: 'a', at: 1 }, pipe).ok).toBe(false)
    expect(transition(board(task('a', { state: 'review', step: 'merge' })), { kind: 'verdict', id: 'a', at: 1, verdict: 'pass' }, pipe).ok).toBe(false)
  })
  test('unknown task and an empty pipeline refuse with a reason', async () => {
    expect(transition(board(), { kind: 'approve', id: 'zz', at: 1 }, pipe)).toEqual({ ok: false, error: 'unknown task zz' })
    const r = transition(board(task('a', { type: 'nope' })), { kind: 'claim', id: 'a', at: 1 }, pipe)
    expect(r.ok === false && r.error).toContain('no pipeline')
  })
})

describe('block / release / skip', () => {
  test('unblock returns to the category of the step it blocked in', async () => {
    const b = step(board(task('a', { state: 'review', step: 'merge' })), 'a', 'block').board
    expect(b.tasks[0].state).toBe('blocked')
    expect(step(b, 'a', 'unblock').board.tasks[0]).toMatchObject({ state: 'review', step: 'merge' })
    const w = step(board(task('w', { state: 'active', step: 'worker' })), 'w', 'block').board
    expect(step(w, 'w', 'unblock').board.tasks[0].state).toBe('active')
  })
  test('release clears the owner and keeps the step', async () => {
    const r = step(board(task('a', { state: 'active', step: 'worker', owner: 'x' })), 'a', 'release').board.tasks[0]
    expect(r).toMatchObject({ state: 'todo', step: 'worker' }); expect(r.owner).toBeUndefined()
  })
  test('conditional-blocks: upstream done -> not-met -> skip emits task.skipped; upstream cancelled -> met', async () => {
    const mk = (up: Category) => board(task('up', { state: up, step: 'worker' }), task('fix', { state: 'todo', deps: [{ id: 'up', type: 'conditional-blocks' }] }))
    const done = step(mk('active'), 'up', 'advance').board   // any transition recomputes conditions
    expect(done.tasks[1].condition).toEqual({ on: 'up', state: 'pending' })
    const closed = step(board(task('up', { state: 'review', step: 'merge' }), task('fix', { deps: [{ id: 'up', type: 'conditional-blocks' }] })), 'up', 'close').board
    expect(closed.tasks[1].condition).toEqual({ on: 'up', state: 'not-met' })
    expect(pendingSkips(closed)).toEqual([{ id: 'fix', on: 'up' }])
    const sk = step(closed, 'fix', 'skip', { on: 'up' })
    expect(sk.board.tasks[1].state).toBe('cancelled')
    expect(sk.events.map(e => e.type)).toEqual(['task.transitioned', 'task.skipped'])
    const failed = step(board(task('up', { state: 'active', step: 'worker' }), task('fix', { deps: [{ id: 'up', type: 'conditional-blocks' }] })), 'up', 'cancel').board
    expect(failed.tasks[1].condition?.state).toBe('met')
  })
})

describe('apply (commit + emit + stamp seq)', () => {
  test('commits the board, emits events into the ring, syncs board.seq', async () => {
    const h = fakeHost()
    await h.board.update(s => ({ ...s, epic: 'e1', tasks: [task('a', { state: 'draft' })] }))
    const r = await apply(h, { kind: 'approve', id: 'a', at: 1, actor: 'human' }, pipe)
    expect(r.ok).toBe(true)
    const b = await h.board.read(), ring = await h.events.read()
    expect(b.tasks[0].state).toBe('todo')
    expect(ring.epics['e1'].map(e => e.type)).toEqual(['task.transitioned'])
    expect(ring.epics['e1'][0]).toMatchObject({ actor: 'human', taskId: 'a', data: { taskId: 'a', from: 'draft', to: 'todo' } })
    expect(b.seq).toBe(ring.seq)
  })
  test('H6: closing a conditional-blocks upstream done skips its dependant (board cancelled + task.skipped)', async () => {
    const h = fakeHost()
    await h.board.update(s => ({ ...s, epic: 'e1', tasks: [task('up', { state: 'review', step: 'merge' }), task('fix', { deps: [{ id: 'up', type: 'conditional-blocks' }] })] }))
    expect((await apply(h, { kind: 'close', id: 'up', at: 1, actor: 'mod' }, pipe)).ok).toBe(true)
    expect((await h.board.read()).tasks.map(t => t.state)).toEqual(['done', 'cancelled'])
    expect((await h.events.read()).epics['e1'].some(e => e.type === 'task.skipped' && e.taskId === 'fix')).toBe(true)
  })
  test('H5: releasing a review-step task returns it to the producing step, claimable again', async () => {
    for (const st of ['reviewer', 'merge']) {
      const r = step(board(task('a', { state: 'review', step: st, owner: 'x' })), 'a', 'release')
      expect(r.board.tasks[0]).toMatchObject({ state: 'todo', step: 'worker', owner: undefined })
      expect(step(r.board, 'a', 'claim', { owner: 'y' }).board.tasks[0]).toMatchObject({ state: 'active', step: 'worker' })
    }
  })
  test('an illegal transition changes nothing and emits nothing', async () => {
    const h = fakeHost()
    await h.board.update(s => ({ ...s, tasks: [task('a', { state: 'done' })] }))
    const r = await apply(h, { kind: 'claim', id: 'a', at: 1 }, pipe)
    expect(r.ok).toBe(false)
    expect((await h.events.read()).seq).toBe(0); expect((await h.board.read()).seq).toBe(0)
  })
})

test('epic states: approved -> integrating -> done-on-dev -> released; failure returns to approved', async () => {
  expect(epicNext('draft', 'approve')).toBe('approved')
  expect(epicNext('approved', 'integrate')).toBe('integrating')
  expect(epicNext('integrating', 'land')).toBe('done-on-dev')
  expect(epicNext('integrating', 'fail')).toBe('approved')
  expect(epicNext('done-on-dev', 'release')).toBe('released')
  expect(epicNext('approved', 'release')).toBeUndefined()
  expect(epicNext('integrating', 'lost')).toBe('blocked'); expect(epicNext('blocked', 'recut')).toBe('approved')
})

describe('fx-data: spike done carries cites', () => {
  test('close with cites puts it on task.transitioned; without, the key is absent', async () => {
    const b = board(task('a', { state: 'active', step: 'report', type: 'spike' }))
    expect((step(b, 'a', 'close', { cites: 3 }).events[0].data)).toEqual({ taskId: 'a', from: 'active', to: 'done', cites: 3 })
    expect('cites' in step(b, 'a', 'close').events[0].data).toBe(false)
  })
})
