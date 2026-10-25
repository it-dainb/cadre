import { describe, expect, test } from 'claude-code/testing'
import { defaults, kindOf, merges, pipeOf, validate, validatePipeline } from '../task-management/registry'

describe('type registry defaults (DESIGN 3.1 table)', () => {
  test('golden: commit type, changelog category, pipeline, contract per type', async () => {
    const d = defaults()
    expect(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [v.commit, v.changelog, v.pipeline.join('>'), v.contract]]))).toEqual({
      feature: ['feat', 'Added', 'tester>red>worker>green>reviewer>merge', 'required'],
      bug: ['fix', 'Fixed', 'tester>red>worker>green>reviewer>merge', 'required'],
      refactor: ['refactor', null, 'worker>green>reviewer>merge', 'required'],
      docs: ['docs', null, 'worker>reviewer>merge', 'none'],
      test: ['test', null, 'tester>reviewer>merge', 'none'],
      spike: [null, null, 'explorer>report', 'none'],
    })
    expect(validate(d)).toEqual([])
  })
  test('kind: docs -> docs, spike -> spike, else code; a custom type may declare it; merges false for spikes', async () => {
    const d = defaults()
    expect(['feature', 'bug', 'refactor', 'docs', 'test', 'spike'].map(t => kindOf(d[t]))).toEqual(['code', 'code', 'code', 'docs', 'code', 'spike'])
    expect(kindOf({ ...d.docs, kind: 'code' })).toBe('code')
    expect(merges(d.spike)).toBe(false); expect(merges(d.feature)).toBe(true)
  })
  test('pipeOf: unknown type has no pipeline', async () => {
    expect(pipeOf(defaults())('bug')).toHaveLength(6); expect(pipeOf(defaults())('nope')).toEqual([])
  })
})

describe('pipeline validation: every illegal order is refused', () => {
  const bad: [string[], string][] = [
    [[], 'empty'],
    [['worker', 'lint'], 'unknown step "lint"'],
    [['worker', 'worker'], 'twice'],
    [['red', 'worker'], '"red" must come directly after "tester"'],
    [['tester', 'worker', 'red'], '"red" must come directly after "tester"'],
    [['green', 'worker'], '"green" must come directly after "worker"'],
    [['tester', 'green', 'reviewer'], '"green" must come directly after "worker"'],
    [['worker', 'reviewer', 'green'], '"green" must come directly after "worker"'],
    [['worker', 'merge'], '"merge" must be last and after "reviewer"'],
    [['merge', 'reviewer'], '"merge" must be last and after "reviewer"'],
    [['worker', 'report'], 'stand alone'],
    [['explorer'], 'stand alone'],
    [['report', 'explorer'], 'stand alone'],
    [['worker', 'explorer', 'report'], 'stand alone'],
  ]
  for (const [p, why] of bad) test(`refuses ${p.join('>') || '(empty)'}`, async () => { expect(validatePipeline(p)).toContain(why) })
  test('legal orders pass', async () => {
    for (const p of [['worker'], ['tester'], ['worker', 'reviewer'], ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], ['explorer', 'report'], ['tester', 'reviewer', 'merge']]) expect(validatePipeline(p)).toBeNull()
  })
  test('validate(registry) names the offending type', async () => {
    expect(validate({ ...defaults(), nope: { commit: 'x', changelog: null, pipeline: ['merge'], contract: 'none' } })).toEqual(['types.nope: "merge" must be last and after "reviewer"'])
  })
  test('a test-first type with a worker keeps tester and red; the built-ins load unchanged', async () => {
    expect(validate(defaults())).toEqual([])
    expect(Object.entries(defaults()).filter(([, s]) => s.tdd).map(([t]) => t).sort()).toEqual(['bug', 'feature'])
    const f = defaults().feature
    expect(validate({ feature: { ...f, pipeline: ['worker', 'reviewer', 'merge'] } })).toEqual(['types.feature: a test-first type ("tdd": true) with a worker keeps "tester" and "red"'])
    expect(validate({ feature: { ...f, pipeline: ['tester', 'worker', 'reviewer', 'merge'] } })).toHaveLength(1)
    const { tdd: _t, ...noTdd } = f
    expect(validate({ feature: { ...noTdd, pipeline: ['worker', 'reviewer', 'merge'] } })).toEqual(['types.feature: a test-first type ("tdd": true) with a worker keeps "tester" and "red"'])
    expect(validate({ feature: { ...f, tdd: false } })).toEqual(['types.feature: test-first is fixed for this type'])
    expect(validate({ feature: { ...f, tdd: false, pipeline: ['worker', 'reviewer', 'merge'] } })).toEqual(['types.feature: test-first is fixed for this type'])
    expect(validate({ chore: { ...noTdd, pipeline: ['worker', 'reviewer', 'merge'] } })).toEqual([])
    expect(validate({ x: { ...f, pipeline: ['tester', 'reviewer', 'merge'] } })).toEqual([])
  })
  test('the per-task lite drop still works', async () => {
    expect(pipeOf(defaults())('feature', 'lite')).not.toContain('red')
  })
})
