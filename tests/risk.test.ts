import { describe, expect, test } from 'claude-code/testing'
import { FOCUS, parseNumstat, reviewTier, route, taskRisk } from '../core/risk'
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
  test('route: base, byRisk override, reviewer floor + deep, escalation after N rounds', () => {
    const m = defaults().models
    expect(route({ tier: 'fast', effort: 'high' }, m, 'light', 0)).toEqual({ model: 'haiku', effort: 'high' })
    expect(route({ tier: 'fast', effort: 'default', byRisk: { standard: { tier: 'standard', effort: 'medium' } } }, m, 'standard', 0)).toEqual({ model: 'sonnet', effort: 'medium' })
    expect(route({ tier: 'fast' }, m, 'light', 0, true).model).toBe('sonnet'); expect(route({ tier: 'haiku' }, m, 'light', 0, true).model).toBe('sonnet'); expect(route({ tier: 'standard' }, m, 'thorough', 0, true).model).toBe('opus')
    const esc = { tier: 'fast', escalate: { after: 1, to: 'sonnet' } }
    expect(route(esc, m, 'light', 0).model).toBe('haiku'); expect(route(esc, m, 'light', 1)).toEqual({ model: 'sonnet', escalated: true }); expect(route({ ...esc, escalate: { after: 0, to: 'sonnet' } }, m, 'light', 5).model).toBe('haiku')
  })
  test('taskRisk: declared paths and labels; an explicit cadre.risk wins', () => {
    expect(taskRisk(c, ['src/a.ts', 'test/a.test.ts'], false)).toBe('light'); expect(taskRisk(c, ['a', 'b', 'c'], false)).toBe('standard')
    expect(taskRisk(c, ['src/auth/t.ts'], false)).toBe('thorough'); expect(taskRisk(c, ['a'], true)).toBe('thorough'); expect(taskRisk(c, ['src/auth/t.ts'], false, [], 'light')).toBe('light')
  })
  test('config: roles byRisk / escalate merge from a layer', () => {
    const r = resolve([{ name: 'repo', trust: 'repo', value: { roles: { worker: { tier: 'fast', byRisk: { thorough: { tier: 'deep', effort: 'xhigh' } }, escalate: { after: 1, to: 'sonnet' } } } } }])
    expect(r.diagnostics).toEqual([]); expect(r.config.roles.worker).toMatchObject({ tier: 'fast', byRisk: { thorough: { tier: 'deep', effort: 'xhigh' } }, escalate: { after: 1, to: 'sonnet' } })
  })
})
