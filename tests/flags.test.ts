// S3: the flag table (plan 2.5). Every row exists and its effects equal the table; the dialogs equal tests/fixtures/flags-golden.ts (recorded before the table: no wording drift);
// an answer runs the option's effects, and flag.resolved is emitted once per flag that left (B17).
import { describe, expect, test } from 'claude-code/testing'
import { flags } from '../profiles/default'
import { FLAGS_GOLDEN, NO_DECISION } from './fixtures/flags-golden'
import { flagDecision, holds, kindOf, pick, specOf, yoloMain } from '../core/flags'
import { resolveFlag } from '../core/close'
import { world } from './fixtures/replay/world'

const eff = (kind: string, key: string) => specOf(kind)!.options.find(o => o.key === key)!.effect
const dos = (kind: string, key: string) => eff(kind, key).map(e => e.do)
const RED = ['rewind', 'retry', 'clear', 'dropNeed', 'endAgent']
const resolved = async (w: Awaited<ReturnType<typeof world>>) => Object.values((await w.h.events.read()).epics).flat().filter(e => e.type === 'flag.resolved').map(e => e.data.flag)
const flag = async (w: Awaited<ReturnType<typeof world>>, id: string, fl: string[], state: 'blocked' | 'active' = 'active') => w.h.board.update(b => ({ ...b, tasks: b.tasks.map(t => (t.id === id ? { ...t, state, flags: fl } : t)) }))

describe('the table', () => {
  test('kinds: the text before the first colon; rework:2/3 and git:dev find their rows', async () => {
    expect([kindOf('rework:2/3'), kindOf('git:dev:agent'), kindOf('quarantine:x'), kindOf('red')]).toEqual(['rework', 'git', 'quarantine', 'red'])
    expect(specOf('rework:2/3')).toBe(flags.rework); expect(specOf('nope')).toBeUndefined(); expect(holds('nope')).toBe(false)
  })
  test('every dialog equals the golden recorded from 1.0.1: labels and order, and the generic line', async () => {
    const CALL: Record<string, [string, object?]> = { 'red (own dialog)': ['red'], 'red (own dialog, with passing ids)': ['red', { ids: ['S1'] }], 'conflict (rebase cap dialog)': ['conflict', { keys: ['r', 'x'] }], 'spec_change (cannot be accepted)': ['spec_change', { keys: ['x', 'c'] }], 'stopped (own dialog)': ['stopped'] }
    for (const [name, g] of Object.entries(FLAGS_GOLDEN)) {
      const [fl, o] = CALL[name] ?? [name], d = flagDecision('a2', fl, 'Title', o)!
      expect(d.options.map(x => [x.key, x.label])).toEqual(g.options); if (g.why) expect(d.lines.at(-1)).toBe(g.why)
    }
    for (const k of NO_DECISION) expect(flagDecision('a2', k)).toBeNull(); expect(flags['lost-wip'].options).toEqual([])   // options: [] = no decision
  })
  test('the effects of every row equal the plan table', async () => {
    expect(eff('git', 'r')).toEqual([{ do: 'restore' }]); expect(eff('git', 'k')).toEqual([{ do: 'clear', how: 'keep' }]); expect(dos('quarantine', 'k')).toEqual(['clear'])
    expect(eff('stopped', 'r')).toEqual([{ do: 'resume' }]); expect(eff('integration-failed', 'k')).toEqual([{ do: 'clear' }]); expect(flags['integration-failed'].options).toHaveLength(1)   // no Cancel
    expect(eff('conflict', 'r')).toEqual([{ do: 'retry', counter: 'rebase', more: 1 }, { do: 'clear', kinds: ['conflict', 'merge-red'] }, { do: 'rework', kind: 'conflict' }])
    expect(dos('red', 'r')).toEqual(RED); expect(dos('red', 'h')).toEqual(['amend', ...RED]); expect(specOf('red')!.options.find(o => o.key === 'h')!.needs).toBe('ids')
    expect(eff('red', 'r')[1]).toEqual({ do: 'retry', counter: 'red' }); expect(eff('red', 'r')[0]).toEqual({ do: 'rewind', to: 'tester' })
    expect(dos('gate-error', 'r')).toEqual(RED); expect(specOf('gate-error')!.options.map(o => o.key)).toEqual(['r', 'x'])
    expect(eff('shape', 'r').map(e => [e.do, e.counter])).toEqual([['retry', 'shapeRefusals'], ['unblock', undefined]]); expect(eff('shape', 'r')[1].note).toContain('report again')
    for (const k of ['attempts', 'no-report', 'stagnant', 'stale', 'loop']) expect(eff(k, 'k').map(e => [e.do, e.counter])).toEqual([['retry', 'silentRuns'], ['reset', 'nudges'], ['unblock', undefined]])
    expect(eff('blocked', 'k')).toEqual([{ do: 'wait' }]); expect(dos('blocked', 'x')).toEqual(['cancel'])
    expect(eff('spec_change', 'a')).toEqual([{ do: 'spec', how: 'accept' }, { do: 'clear', kinds: ['spec_change'] }]); expect(eff('spec_change', 'x')).toEqual([{ do: 'spec', how: 'reject' }, { do: 'clear', kinds: ['spec_change'] }])
    expect(dos('conflict', 'a')).toEqual(['adopt', 'clear']); expect(dos('drift', 'a')).toEqual(['adopt', 'clear'])
    expect(dos('lost-epic', 'r')).toEqual(['recut']); expect(dos('lost-epic', 'x')).toEqual(['cancel']); expect(dos('external', 'k')).toEqual(['clear'])
    expect(eff('external', 'k')[0].kinds).toBeUndefined()   // plain clear: every flag of the target except git:
  })
  test('holds and yolo: the rows drive holds on, and the two main decides', async () => {
    expect(Object.entries(flags).filter(([, s]) => s.holds).map(([k]) => k).sort()).toEqual(['conflict', 'drift', 'external', 'gate-error', 'git', 'hook-failed', 'integration-failed', 'lost-epic', 'lost-wip', 'quarantine', 'red', 'rework'])
    expect(Object.entries(flags).filter(([, s]) => s.yolo === 'main').map(([k]) => k).sort()).toEqual(['blocked', 'spec_change']); expect(yoloMain('spec_change')).toBe(true); expect(yoloMain('red')).toBe(false)
  })
  test('needs ids: the option is absent without ids; needs keys: only when named', async () => {
    expect(flagDecision('a2', 'red')!.options.map(o => o.key)).toEqual(['r', 'x']); expect(flagDecision('a2', 'red', undefined, { ids: ['S1'] })!.options.map(o => o.key)).toEqual(['r', 'h', 'x'])
    expect(flagDecision('a2', 'conflict')!.options.map(o => o.key)).toEqual(['a', 'k', 'x']); expect(flagDecision('a2', 'conflict', undefined, { keys: ['r', 'x'] })!.options.map(o => o.key)).toEqual(['r', 'x'])
    expect(flagDecision('a2', 'red', undefined, { ids: ['S1', 'S2'] })!.options[1].run).toBe('resolve a2 h S1,S2'); expect(flagDecision('', 'git:dev')!.options.map(o => o.run)).toEqual(['resolve git r git:dev', 'resolve git k git:dev'])
  })
  test('pick: a key, or the first word of the label; nothing else', async () => {
    const os = specOf('spec_change')!.options
    expect([pick(os, 'a')?.key, pick(os, 'accept')?.key, pick(os, 'reject')?.key, pick(os, 'x')?.key, pick(os, 'maybe'), pick(os, 'accept: do it')]).toEqual(['a', 'a', 'x', 'x', undefined, undefined])
  })
})

describe('an answer', () => {
  test('an unknown choice is refused with the legal keys and changes nothing', async () => {
    const w = await world({ type: 'docs' }), [id] = w.ids; await flag(w, id, ['spec_change'], 'blocked')
    const r = await resolveFlag(w.h, id, 'maybe'); expect(r.ok).toBe(false); expect(r.text).toBe(`${id}: no such choice; use one of a (Accept), x (Reject), c (Cancel task)`)
    expect((await w.h.board.read()).tasks[0].flags).toEqual(['spec_change']); expect(await resolved(w)).toEqual([])
    expect((await resolveFlag(w.h, id, 'reason: accept', '', { reason: 'x' })).ok).toBe(false)   // the reason is never the key
    expect((await resolveFlag(w.h, 'zz', 'k')).text).toBe('no open flag on zz')
  })
  test('plain clear removes the task\'s flags and never git:; flag.resolved once per flag that left (B17)', async () => {
    const w = await world({ type: 'docs' }), [id] = w.ids; await flag(w, id, ['external', 'git:keepme', 'locked-dirty'])
    expect((await resolveFlag(w.h, id, 'k')).ok).toBe(true)
    expect((await w.h.board.read()).tasks[0].flags).toEqual(['git:keepme']); expect(await resolved(w)).toEqual(['external', 'locked-dirty'])   // one event per flag that left; git: stays
  })
  test('wait removes nothing and emits nothing; a refusal stops the rest of the effects', async () => {
    const w = await world({ type: 'docs' }), [id] = w.ids; await flag(w, id, ['blocked'], 'blocked')
    expect((await resolveFlag(w.h, id, 'k')).text).toContain('still waiting for your answer'); expect((await w.h.board.read()).tasks[0].flags).toEqual(['blocked']); expect(await resolved(w)).toEqual([])
    await flag(w, id, ['red'], 'blocked'); const r = await resolveFlag(w.h, id, 'h', 'S9'); expect(r.ok).toBe(false); expect((await w.h.board.read()).tasks[0].flags).toEqual(['red'])   // amend refuses: no rewind, no clear
    expect((await resolveFlag(w.h, id, 'h')).text).toContain('needs the scenario ids')
  })
  test('cancel ends the task and its flags leave with it', async () => {
    const w = await world({ type: 'docs' }), [id] = w.ids; await flag(w, id, ['holds'], 'blocked')
    expect((await resolveFlag(w.h, id, 'cancel')).ok).toBe(true); expect((await w.h.board.read()).tasks.find(t => t.id === id)?.state).toBe('cancelled'); expect(await resolved(w)).toEqual(['holds'])
  })
})
