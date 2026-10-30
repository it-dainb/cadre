import { describe, expect, test } from 'claude-code/testing'
import { FOCUS, RISKS, riskOf, route } from '../core/routing'
import { brief } from '../core/briefs'
import { defaults, resolve } from '../config/index'
import { validateFields } from '../core/validate'
import { roles } from '../profiles/default'

describe('routing: the planner declares the risk (B9), the cells pick model and effort (ADR 0016, 0019)', () => {
  test('riskOf is the declared risk; none or an unknown value is standard; nothing is scored from paths, labels or a diff', () => {
    for (const r of RISKS) expect(riskOf({ meta: { 'cadre.risk': r } })).toBe(r)
    expect(riskOf({ meta: {} })).toBe('standard'); expect(riskOf({ meta: { 'cadre.risk': 'huge' } })).toBe('standard'); expect(riskOf(undefined)).toBe('standard')
    expect(riskOf({ meta: { 'cadre.core': 'true', 'cadre.paths': '["lib/auth/x.ts"]' } })).toBe('standard')
  })
  test('the risk is a task field: one of the four on a task, refused on a plan or with another value; the old thresholds are not settings', () => {
    expect(validateFields({ risk: 'thorough' }, { feature: {} } as any)).toBeNull(); expect(validateFields({ risk: null }, {} as any)).toBeNull()
    expect(validateFields({ risk: 'huge' }, {} as any)).toContain('metadata.risk: expected on a task, how closely it is reviewed: light|standard|thorough|core'); expect(validateFields({ kind: 'plan', risk: 'light' }, {} as any)).toContain('metadata.risk')
    expect(resolve([{ name: 'u', trust: 'user', value: { review: { tiers: { light: { files: 9 } }, deepLabels: ['x'], coreTask: 'core', coreDiff: 'core' } } }]).diagnostics).toEqual(['u: review.tiers: unknown key', 'u: review.deepLabels: unknown key', 'u: review.coreTask: unknown key', 'u: review.coreDiff: unknown key'])
  })
  test('the default cells are the profile routing (one source), the escalation is the setting\'s own', () => {
    const c = defaults().roles
    for (const r of ['worker', 'tester', 'reviewer'] as const) for (const k of RISKS) expect([c[r].byRisk[k].model, c[r].byRisk[k].effort]).toEqual([roles[r].routing![k].model, roles[r].routing![k].effort])
    expect(c.worker.byRisk.light.escalate).toEqual({ after: 1, model: 'sonnet', effort: 'high' }); expect(c.reviewer.byRisk.thorough.escalate.after).toBe(0)
  })
  test('brief tells only what to check (no tier words); standard adds nothing', () => {
    const b = (t: 'light' | 'standard' | 'thorough' | 'core') => brief('reviewer', { id: 'a', title: 't', type: 'feature', focus: FOCUS[t] })
    expect(b('light')).toContain('## Check'); expect(b('thorough')).toContain('security'); expect(b('standard')).not.toContain('## Check')
    for (const t of ['light', 'thorough', 'core'] as const) expect(/tier|light|thorough|standard|\bcore risk/i.test(FOCUS[t].replace('Small change', '').replace('Large or sensitive change', ''))).toBe(false)
  })
  test('route: exactly the cell, then its escalation after N failed rounds (0 = never); the setting it came from', () => {
    const cell = { model: 'haiku', effort: 'high', escalate: { after: 1, model: 'sonnet', effort: 'xhigh' } }
    expect(route('worker', cell, 'light', 0)).toEqual({ model: 'haiku', effort: 'high', setting: 'roles.worker.byRisk.light' })
    expect(route('worker', cell, 'core', 1)).toEqual({ model: 'sonnet', effort: 'xhigh', escalated: true, setting: 'roles.worker.byRisk.core.escalate' })
    expect(route('worker', { ...cell, escalate: { ...cell.escalate, after: 0 } }, 'light', 5).model).toBe('haiku'); expect(route('explorer', { model: 'haiku', effort: 'default' }, '', 0)).toEqual({ model: 'haiku', setting: 'roles.explorer' })
  })
  test('config: one routing cell merges from a layer, the other cells keep their defaults; the old tier keys are refused', () => {
    const r = resolve([{ name: 'repo', trust: 'repo', value: { roles: { worker: { byRisk: { thorough: { model: 'opus', effort: 'xhigh' } } } } } }])
    expect(r.diagnostics).toEqual([]); expect(r.config.roles.worker.byRisk.thorough).toMatchObject({ model: 'opus', effort: 'xhigh', escalate: { after: 1, model: 'sonnet' } }); expect(r.config.roles.worker.byRisk.light.model).toBe('haiku')
    expect(resolve([{ name: 'u', trust: 'user', value: { roles: { worker: { tier: 'fast' } }, models: { fast: 'haiku' } } }]).diagnostics).toEqual(['u: roles.worker.tier: unknown key', 'u: models.fast: unknown key'])
  })
})
