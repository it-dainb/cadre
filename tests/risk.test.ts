import { describe, expect, test } from 'claude-code/testing'
import { FOCUS, parseNumstat, riskOf, route } from '../core/risk'
import { brief } from '../core/briefs'
import { defaults, resolve } from '../config/index'
import { admitWith } from '../core/admission'

const R = defaults().review, c = R.tiers, reviewTier = (_c: unknown, s: { paths: string[]; lines: number }, deep: boolean, core: string[] = []) => riskOf(R, { ...s, labels: deep ? ['security'] : [], corePaths: core }), st = (n: number, lines: number, p = 'src/a') => ({ paths: Array.from({ length: n }, (_, i) => `${p}${i}.ts`), lines })
describe('risk-sized review (ADR 0016)', () => {
  test('numstat: lines, paths, renames, binary', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg.png\n2\t2\tsrc/{x => y}/b.ts\n')).toEqual({ paths: ['src/a.ts', 'img.png', 'src/y/b.ts'], lines: 8 })
  })
  test('light: few files, few lines, no risky path', () => { expect(reviewTier(c, st(4, 99), false)).toBe('light'); expect(reviewTier(c, st(0, 0), false)).toBe('light') })
  test('standard: at the light bounds or between', () => { expect(reviewTier(c, st(5, 10), false)).toBe('standard'); expect(reviewTier(c, st(2, 100), false)).toBe('standard'); expect(reviewTier(c, st(20, 500), false)).toBe('standard') })
  test('thorough: > 20 files, > 500 lines, risky path, core path, deep label', () => {
    expect(reviewTier(c, st(21, 30), false)).toBe('thorough'); expect(reviewTier(c, st(1, 501), false)).toBe('thorough')
    for (const p of ['lib/auth/login.ts', 'db/migrations/001.sql', '.github/workflows/ci.yml', 'web/package.json']) expect(reviewTier(c, { paths: [p], lines: 1 }, false)).toBe('thorough')
    expect(reviewTier(c, { paths: ['core/x.ts'], lines: 1 }, false, ['core/x.ts'])).toBe('thorough'); expect(reviewTier(c, st(1, 1), true)).toBe('thorough')
  })
  test('brief tells only what to check (no tier words); standard adds nothing', () => {
    const b = (t: 'light' | 'standard' | 'thorough' | 'core') => brief('reviewer', { id: 'a', title: 't', type: 'feature', focus: FOCUS[t] })
    expect(b('light')).toContain('## Check'); expect(b('thorough')).toContain('security'); expect(b('standard')).not.toContain('## Check')
    for (const t of ['light', 'thorough', 'core'] as const) expect(/tier|light|thorough|standard|\bcore risk/i.test(FOCUS[t].replace('Small change', '').replace('Large or sensitive change', ''))).toBe(false)
  })
  test('config: a repo may only tighten the thresholds and add risky paths', () => {
    const r = resolve([{ name: 'repo', trust: 'repo', value: { review: { tiers: { light: { files: 3, lines: 500 }, thorough: { files: 50, lines: 100 }, risky: ['billing/**'] } } } }]).config.review.tiers
    expect([r.light.files, r.light.lines, r.thorough.files, r.thorough.lines]).toEqual([3, 100, 20, 100]); expect(r.risky).toContain('billing/**'); expect(r.risky).toContain('**/auth/**')
    const u = resolve([{ name: 'user', trust: 'user', value: { review: { tiers: { light: { files: 9 } } } } }]).config.review.tiers; expect(u.light.files).toBe(9)
  })
  test('route: exactly the cell, then its escalation after N failed rounds (0 = never); the setting it came from', () => {
    const cell = { model: 'haiku', effort: 'high', escalate: { after: 1, model: 'sonnet', effort: 'xhigh' } }
    expect(route('worker', cell, 'light', 0)).toEqual({ model: 'haiku', effort: 'high', setting: 'roles.worker.byRisk.light' })
    expect(route('worker', cell, 'core', 1)).toEqual({ model: 'sonnet', effort: 'xhigh', escalated: true, setting: 'roles.worker.byRisk.core.escalate' })
    expect(route('worker', { ...cell, escalate: { ...cell.escalate, after: 0 } }, 'light', 5).model).toBe('haiku'); expect(route('explorer', { model: 'haiku', effort: 'default' }, '', 0)).toEqual({ model: 'haiku', setting: 'roles.explorer' })
  })
  test('riskOf at claim: core task (review.coreTask), deep label, risky glob, then declared paths (tiers.light.paths)', () => {
    expect(riskOf(R, { paths: ['src/a.ts', 'test/a.test.ts'], labels: [] })).toBe('light'); expect(riskOf(R, { paths: ['a', 'b', 'c'], labels: [] })).toBe('standard')
    expect(riskOf(R, { paths: ['src/auth/t.ts'], labels: [] })).toBe('thorough'); expect(riskOf(R, { paths: ['a'], labels: ['breaking'] })).toBe('thorough')
    expect(riskOf(R, { paths: ['a'], labels: ['security'], coreTask: true })).toBe('core'); expect(riskOf({ ...R, coreTask: 'thorough' }, { paths: ['a'], labels: [], coreTask: true })).toBe('thorough')
    expect(riskOf({ ...R, tiers: { ...c, light: { ...c.light, paths: 3 } } }, { paths: ['a', 'b', 'c'], labels: [] })).toBe('light')
  })
  test('riskOf at review: a diff on the landed core (review.coreDiff), else size', () => {
    expect(riskOf(R, { paths: ['core/x.ts'], lines: 1, labels: [], corePaths: ['core/**'] })).toBe('thorough'); expect(riskOf({ ...R, coreDiff: 'core' }, { paths: ['core/x.ts'], lines: 1, labels: [], corePaths: ['core/**'] })).toBe('core')
  })
  test('config: one routing cell merges from a layer, the other cells keep their defaults; the old tier keys are refused', () => {
    const r = resolve([{ name: 'repo', trust: 'repo', value: { roles: { worker: { byRisk: { thorough: { model: 'opus', effort: 'xhigh' } } } } } }])
    expect(r.diagnostics).toEqual([]); expect(r.config.roles.worker.byRisk.thorough).toMatchObject({ model: 'opus', effort: 'xhigh', escalate: { after: 1, model: 'sonnet' } }); expect(r.config.roles.worker.byRisk.light.model).toBe('haiku')
    expect(resolve([{ name: 'u', trust: 'user', value: { roles: { worker: { tier: 'fast' } }, models: { fast: 'haiku' } } }]).diagnostics).toEqual(['u: roles.worker.tier: unknown key', 'u: models: unknown key'])
  })
})
