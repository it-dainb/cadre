import { describe, expect, test } from 'claude-code/testing'
import { makerOf, typeOr, firstType, active, catOf, enter, gateAt, kindOf, locksAt, merges, next, onFail, pipeOf, producer, roleAt, setProfile, spent, typeOf, verdictAt, workspaceAt, covers, fill, sandboxEnv } from '../core/pipeline'
import { transition } from '../core/machine'
import { profile as DEFAULT, types } from '../profiles/default'
import { BUILTIN } from '../core/profile'
import { task } from './support'
import { emptySnapshot } from '../core/board'
import type { Category } from '../types'

// 1.0.1's STEP_CAT and producer (task-management/registry + core/machine at d0f4cc0): the derivations must give the same answers for every default pipeline
const STEP_CAT: Record<string, Category> = { tester: 'active', red: 'active', worker: 'active', green: 'active', explorer: 'active', report: 'active', reviewer: 'review', merge: 'review' }
const producerOld = (p: readonly string[], i: number) => [...p.slice(0, i)].reverse().find(x => x === 'worker' || x === 'tester') ?? p[0]
const TYPES = ['feature', 'bug', 'refactor', 'docs', 'test', 'spike']

describe('the pipeline interpreter over the default profile', () => {
  test('category and producer derived from the profile equal 1.0.1\'s for every step of the six pipelines (and the lite ones)', () => {
    for (const t of TYPES) for (const lane of [undefined, 'lite']) { const p = pipeOf(t, lane); for (const [i, s] of p.entries()) { expect([t, s, catOf(s)]).toEqual([t, s, STEP_CAT[s]]); expect([t, s, producer(p, i)]).toEqual([t, s, producerOld(p, i)]) } }
  })
  test('TypeSpec.lite picks the alternate pipeline for the lite lane; a type without one keeps its own; an unknown type has none', () => {
    expect(pipeOf('bug', 'lite')).toEqual(['worker', 'green', 'reviewer', 'merge']); expect(pipeOf('bug')).toEqual(['tester', 'red', 'worker', 'green', 'reviewer', 'merge']); expect(pipeOf('bug', 'full')).toEqual(pipeOf('bug'))
    expect(pipeOf('docs', 'lite')).toEqual(pipeOf('docs')); expect(pipeOf('test', 'lite')).toEqual(['tester', 'reviewer', 'merge']); expect(pipeOf('nope', 'lite')).toEqual([]); expect(pipeOf('bug', 'lite+tdd')).toEqual(pipeOf('bug'))   // B12
  })
  test('enter and next walk the pipeline; kind and merges come from the steps (a read-only pipeline reads, an answer never lands)', () => {
    expect([enter('bug'), enter('bug', 'lite'), enter('spike'), next('bug', undefined, 'tester'), next('bug', undefined, 'merge'), next('bug', undefined, 'nope')]).toEqual(['tester', 'worker', 'explorer', 'red', undefined, undefined])
    expect(TYPES.map(t => [kindOf(t), merges(t)])).toEqual([['code', true], ['code', true], ['code', true], ['code', true], ['code', true], ['spike', false]])
    expect(['tester', 'worker', 'reviewer', 'explorer'].map(workspaceAt)).toEqual(['view', 'worktree', 'none', 'none']); expect(['red', 'merge'].map(workspaceAt)).toEqual([undefined, undefined])
  })
  test('a gate runs against an earlier step of the same pipeline: red on tester, green on worker, merge on reviewer, report on explorer', () => {
    for (const t of TYPES) for (const list of [pipeOf(t), pipeOf(t, 'lite')]) for (const [i, s] of list.entries()) { const st = active().steps[s]; if ('gate' in st) expect(list.indexOf(st.on), `${t} ${s}`).toBeLessThan(i) }
    expect(['red', 'green', 'merge', 'report'].map(gateAt)).toEqual(['test', 'test', 'integrate', 'report']); expect(['tester', 'worker', 'reviewer', 'explorer'].map(roleAt)).toEqual(['tester', 'worker', 'reviewer', 'explorer'])
    expect(['tester', 'worker', 'reviewer', 'explorer', 'merge'].map(verdictAt)).toEqual([false, false, true, false, false])
  })
  test('onFail: the red step waits for the human at its 3rd failed round; the reviewer goes back 3 times and is raised on the 4th (1.0.1\'s rounds); green has no count', () => {
    expect([1, 2, 3].map(n => spent('red', n))).toEqual([false, false, true]); expect([1, 2, 3, 4].map(n => spent('reviewer', n))).toEqual([false, false, false, true])
    expect([onFail('red')?.retry, onFail('reviewer')?.retry, onFail('green'), onFail('merge')]).toEqual([3, 3, undefined, undefined]); expect(spent('green', 99)).toBe(false)
    expect(onFail('reviewer')?.then).toEqual({ back: 'worker' }); expect(onFail('red')?.then).toBe('human')
  })
  test('locks: the tester acquires what it wrote, the worker may not edit it; no other step locks', () => {
    expect(['tester', 'worker', 'reviewer', 'explorer'].map(s => locksAt(s))).toEqual([{ acquire: 'out' }, { enforce: 'in' }, undefined, undefined])
  })
  test('covers: the types that need a test or a coverage entry; a spike and an unknown type need none', () => {
    expect([...TYPES, 'nope'].map(covers)).toEqual([true, true, true, true, true, false, false])
    expect(typeOf('docs')?.acceptance.cover).toBe('report'); expect(types.feature.acceptance.cover).toBe('results')
  })
  test('sandbox.env: ${WT} and ${PATH} fill in; a name nobody gave is empty; the closed set is checked at load', () => {
    expect(fill('${WT}/.venv/bin:${PATH}', { WT: '/w', PATH: '/bin' })).toBe('/w/.venv/bin:/bin'); expect(fill('a${NOPE}b', {})).toBe('ab'); expect(fill('no names', {})).toBe('no names'); expect(fill('open ${WT', { WT: 'x' })).toBe('open ${WT')
    expect(sandboxEnv({ WT: '/w', PATH: '/bin' })).toEqual({ PATH: '/w/.venv/bin:/bin' })
  })
})

describe('the machine reads the profile: a docs-style profile moves a task writer -> critic -> land with no step named in the machine', () => {
  const docs = { ...DEFAULT, types: { doc: { pipeline: ['write', 'review', 'land'], acceptance: { format: 'x', cover: 'none' as const }, contract: 'none' as const } }, steps: {
    write: { role: 'writer', workspace: 'worktree' as const, brief: [] }, review: { role: 'critic', workspace: 'none' as const, brief: [] }, land: { gate: 'integrate', expect: 'pass' as const, on: 'review' } },
    roles: { writer: DEFAULT.roles.worker, critic: DEFAULT.roles.reviewer } }
  const B = (t: Parameters<typeof task>[1]) => ({ ...emptySnapshot('repo'), tasks: [task('a', { type: 'doc', ...t })] })
  test('claim enters the first step, advance goes to the review step (category review), a pass goes to the landing gate, a change goes back to the producing step, close needs the gate', () => {
    try {
      setProfile(docs)
      const ok = (s: any, m: any) => { const r = transition(s, { id: 'a', at: 1, ...m }); if (!r.ok) throw new Error(r.error); return r.board.tasks[0] }
      let t = ok(B({ state: 'todo' }), { kind: 'claim', owner: 'w' }); expect([t.state, t.step]).toEqual(['active', 'write'])
      t = ok({ ...B({}), tasks: [t] }, { kind: 'advance' }); expect([t.state, t.step]).toEqual(['review', 'review'])
      const pass = ok({ ...B({}), tasks: [t] }, { kind: 'verdict', verdict: 'pass' }); expect([pass.state, pass.step]).toEqual(['review', 'land'])
      const back = ok({ ...B({}), tasks: [t] }, { kind: 'verdict', verdict: 'changes' }); expect([back.state, back.step]).toEqual(['active', 'write'])
      expect(ok({ ...B({}), tasks: [pass] }, { kind: 'close' }).state).toBe('done')
      expect(transition({ ...B({}), tasks: [{ ...t, step: 'write', state: 'active' }] }, { kind: 'close', id: 'a', at: 1 }).ok).toBe(false)   // not at the landing gate
      expect(transition({ ...B({}), tasks: [{ ...t, step: 'write', state: 'active' }] }, { kind: 'verdict', id: 'a', at: 1, verdict: 'pass' }).ok).toBe(false)   // not under review
    } finally { setProfile(DEFAULT) }
  })
})

// a moved plan sends a task back to the step that made its change, and cadre's own tasks take a type the profile has: never the default's names on another profile
test('makerOf and typeOr follow the active profile: worker/feature on the default, write/doc on docs, work/analysis on analysis', () => {
  for (const t of ['feature', 'bug', 'refactor', 'docs']) expect(makerOf(t)).toBe('worker')
  expect(makerOf('feature', 'lite')).toBe('worker'); expect(typeOr('bug')).toBe('bug'); expect(firstType()).toBe('feature')
  for (const [k, ty, step] of [['docs', 'doc', 'write'], ['analysis', 'analysis', 'work']] as const) {
    try {
      setProfile({ ...DEFAULT, ...BUILTIN[k] } as typeof DEFAULT)
      expect(firstType()).toBe(ty); expect(typeOr('refactor')).toBe(ty); expect(typeOr('bug')).toBe(ty); expect(makerOf(ty)).toBe(step); expect(makerOf(ty, 'lite')).toBe(step)
    } finally { setProfile(DEFAULT) }
  }
})
