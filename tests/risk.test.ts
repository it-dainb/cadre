import { describe, expect, test } from 'claude-code/testing'
import { FOCUS, parseNumstat, reviewTier } from '../core/risk'
import { brief } from '../core/briefs'
import { defaults, resolve } from '../config/index'
import { admitWith } from '../core/admission'

const c = defaults().review.tiers, st = (n: number, lines: number, p = 'src/a') => ({ paths: Array.from({ length: n }, (_, i) => `${p}${i}.ts`), lines })
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
    const b = (t: 'light' | 'standard' | 'thorough') => brief('reviewer', { id: 'a', title: 't', type: 'feature', focus: FOCUS[t] })
    expect(b('light')).toContain('## Check'); expect(b('thorough')).toContain('security'); expect(b('standard')).not.toContain('## Check')
    for (const t of ['light', 'thorough'] as const) expect(/tier|light|thorough|standard/i.test(FOCUS[t].replace('Small change', '').replace('Large or sensitive change', ''))).toBe(false)
  })
  test('config: a repo may only tighten the thresholds and add risky paths', () => {
    const r = resolve([{ name: 'repo', trust: 'repo', value: { review: { tiers: { light: { files: 3, lines: 500 }, thorough: { files: 50, lines: 100 }, risky: ['billing/**'] } } } }]).config.review.tiers
    expect([r.light.files, r.light.lines, r.thorough.files, r.thorough.lines]).toEqual([3, 100, 20, 100]); expect(r.risky).toContain('billing/**'); expect(r.risky).toContain('**/auth/**')
    const u = resolve([{ name: 'user', trust: 'user', value: { review: { tiers: { light: { files: 9 } } } } }]).config.review.tiers; expect(u.light.files).toBe(9)
  })
})
