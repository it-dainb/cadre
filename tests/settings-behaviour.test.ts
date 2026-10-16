// ADR 0019 enforcement: for every setting, changing it changes what cadre does. Each probe runs the real code path with the default config and with
// one key changed; the observable must differ. Keys proved by a scenario test elsewhere are listed in fixtures/settings-proof (ELSEWHERE).
import { describe, expect, test } from 'claude-code/testing'
import { REG, defaults, strictOf } from '../config/index'
import type { Config } from '../config/index'
import { RISKS, riskOf, route } from '../core/risk'
import { laneOf } from '../core/lanes'
import { boundOf } from '../core/drive'
import { stale, usdOf } from '../core/reuse'
import { start, wake } from '../core/session'
import { modeOf } from '../core/specview'
import { registryOf } from '../core/dispatch'
import { protectedRef, wtRootOf } from '../core/branches'
import { isProt, writableJail } from '../core/git'
import { allowlist } from '../agents/index'
import { coverageGaps, sliceNotes } from '../core/validate'
import { asciiOf } from '../config/index'
import { policyOf } from '../policy/guards'
import { ELSEWHERE } from './fixtures/settings-proof'
import { guideOf, nextStep } from '../core/clarify'
import { BUDGET } from './fixtures/budget.generated'
import { fakeHost } from './support'

const put = (c: any, k: string, v: unknown) => { const ks = k.split('.'); ks.slice(0, -1).reduce((o, x) => o[x], c)[ks[ks.length - 1]] = v; return c }
const host = (c: Config, files: Record<string, string> = {}) => Object.assign(fakeHost({ files }), { config: async () => c })
const R = (c: Config, r: 'worker' | 'tester' | 'reviewer', k: (typeof RISKS)[number], n: number) => route(r, c.roles[r].byRisk[k], k, n)
const rv = (c: Config, s: { paths: string[]; lines?: number }, o = {}) => riskOf(c.review, { labels: [], ...s, ...o })
const T = (n: number) => Array.from({ length: n }, () => ({ type: 'spike', meta: {}, labels: [], design: '' })) as any
const stat = (files: number, lines: number, path = 'src/a.ts') => ({ paths: Array.from({ length: files }, (_, i) => (i ? `src/f${i}.ts` : path)), lines })
const rec = { on: true, turns: 50, startedAt: 0 } as any, bound = (c: Config, cost = 5, idle = 2) => boundOf(rec, c.drive, cost, idle, 60 * 60_000)
const B = { taskId: 't', role: 'worker', step: 'worker', worktree: '/w', sessionId: 's', ctxTokens: 120_000, startedAt: 0, lastAt: 0 } as any
const started = async (c: Config) => { const h = host(c); await start(h); return { pol: await policyOf(h), ui: (await h.ui.read()).cfg } }

const VAGUE = { outcome: 0.9, scope: 0.4, acceptance: 0.5, constraints: 0.8 }
// key -> [a non-default value, the observable]
const PROBES: Record<string, [unknown, (c: Config) => unknown]> = {
  'drive.maxTurns': [10, c => bound(c)], 'drive.maxCostUsd': [3, c => bound(c, 5, 0)], 'drive.maxWallMinutes': [30, c => bound({ ...c, drive: { ...c.drive, maxTurns: 1e6 } } as Config, 0, 0)],
  'drive.noProgressTurns': [2, c => bound({ ...c, drive: { ...c.drive, maxTurns: 1e6, maxWallMinutes: 1e6 } } as Config, 0, 2)],
  disable: [true, c => wake(Object.assign(host(c, { '/repo/.cadre/config.json': '{}' }), { secret: { read: async () => ({}), update: async () => {} } }) as any)],
  // every role x risk cell: the model, effort and escalation fields each change what route() hands the spawn (escalation probed one round past `after`)
  ...Object.fromEntries((['worker', 'tester', 'reviewer'] as const).flatMap(r => RISKS.flatMap(k => {
    const at = `roles.${r}.byRisk.${k}`, up = (c: Config) => R({ ...c, roles: { ...c.roles, [r]: { byRisk: { ...c.roles[r].byRisk, [k]: { ...c.roles[r].byRisk[k], escalate: { ...c.roles[r].byRisk[k].escalate, after: c.roles[r].byRisk[k].escalate.after || 1 } } } } } } as Config, r, k, 1)
    return [[`${at}.model`, ['fable', (c: Config) => R(c, r, k, 0)]], [`${at}.effort`, ['max', (c: Config) => R(c, r, k, 0)]], [`${at}.escalate.after`, [r === 'worker' ? 7 : 1, (c: Config) => R(c, r, k, 1)]],
      [`${at}.escalate.model`, ['fable', up]], [`${at}.escalate.effort`, ['max', up]]]
  }))),
  'roles.explorer.model': ['opus', c => route('explorer', c.roles.explorer, '', 0)], 'roles.explorer.effort': ['high', c => route('explorer', c.roles.explorer, '', 0)],
  'roles.planner.model': ['opus', c => route('planner', c.roles.planner, '', 0)], 'roles.planner.effort': ['medium', c => route('planner', c.roles.planner, '', 0)],
  'review.coreTask': ['thorough', c => rv(c, { paths: ['a'] }, { coreTask: true })], 'review.coreDiff': ['core', c => rv(c, { paths: ['core/x.ts'], lines: 1 }, { corePaths: ['core/**'] })],
  'review.tiers.light.paths': [3, c => rv(c, { paths: ['a', 'b', 'c'] })],
  'review.tiers.light.files': [2, c => rv(c, stat(3, 10))], 'review.tiers.light.lines': [50, c => rv(c, stat(1, 80))],
  'review.tiers.thorough.files': [10, c => rv(c, stat(15, 10))], 'review.tiers.thorough.lines': [300, c => rv(c, stat(1, 400))],
  'review.tiers.risky': [['src/**'], c => rv(c, stat(1, 1))],
  'planning.clarify.enabled': [false, c => guideOf((BUDGET.guides as Record<string, string>).goal, c.planning)],
  'planning.clarify.maxQuestions': [1, c => nextStep(VAGUE, c.planning, { mode: 'auto' }).text], 'planning.clarify.threshold': [0.3, c => nextStep(VAGUE, c.planning, { mode: 'auto' }).text],
  'planning.deep.maxRounds': [1, c => nextStep(VAGUE, c.planning, { mode: 'auto', deep: true, asked: 1 }).text],
  'review.coverage.enforce': [false, c => coverageGaps(c.review.coverage.enforce, 'S1: Given a When b Then c', [], [])], 'notes.slice': [false, c => sliceNotes([{ paths: ['src/a'], text: 'x' }], ['src/a'], c.notes.slice)],
  'lanes.fullAt': [4, c => laneOf('ask', T(3), c.types as any, c.lanes)], 'lanes.milestoneAt': [9, c => laneOf('full', T(8), c.types as any, c.lanes)],
  types: [{ chore: { commit: 'chore', pipeline: ['worker', 'merge'] } }, async c => Object.keys(await registryOf(host(c)))],
  'branches.main': ['trunk', c => protectedRef('trunk', c.branches)], 'branches.dev': ['develop', c => protectedRef('dev', c.branches)], 'branches.epicPrefix': ['feat/', c => protectedRef('feat/x', c.branches)],
  'changelog.path': ['docs/CHANGES.md', c => isProt('docs/CHANGES.md', c.changelog.path)], 'worktrees.root': ['/fast/wt', c => wtRootOf(host(c), c)],
  strictness: ['advisory', c => strictOf(host(c))], mcpAllow: [['mcp__x__y'], async c => (await started(c)).pol.mcpAllow],
  jail: ['on', c => modeOf(host(c), { cfg: c }).catch(e => (e as Error).message)], jailWritable: [['/cache'], c => writableJail({ wt: '/w', scratch: '/s', pkgRoot: '/w', argv: ['true'], writable: c.jailWritable }).join(' ')],
  effectCheck: ['always', async c => (await started(c)).pol.effectCheck],
  'reuse.maxContextPct': [50, c => stale(B, 1, c)], 'reuse.cacheTtlMs': [0, c => stale({ ...B, ctxTokens: 70_000 }, 10, c)],
  'cost.prices': [{ haiku: { in: 1, out: 1 } }, c => usdOf({ in: 1e6, out: 0, cr: 0, cw: 0, model: 'claude-haiku-5' }, c)],
  'ui.glyphs': ['ascii', c => asciiOf(c.ui.glyphs, {})], 'ui.flash': [false, async c => (await started(c)).ui], 'ui.density': ['compact', async c => (await started(c)).ui],
  'ui.notify': ['off', async c => (await started(c)).ui], 'ui.escalateAfterMs': [5_000, async c => (await started(c)).ui],
}
// read only inside a turn/hook flow that has no smaller entry point; why they are trusted is in ADR 0019 (fixed list of exceptions, kept short)
const PLUMBING: Record<string, string> = {
  'cost.clearHintPct': 'core/reuse.drain: toast after an epic lands past this fill (one comparison)', 'cost.compactPct': 'core/reuse.drain: toast past this fill (one comparison)',
  'store.kind': 'hooks/register wire.store: memory vs file (tests replace wire.store, so the kit cannot call the shipped factory)',
}

describe('every setting changes behaviour (ADR 0019)', () => {
  test('each key is probed here, proved in a named test, or listed as plumbing', () => {
    const none = Object.keys(REG).filter(k => !PROBES[k] && !ELSEWHERE[k] && !PLUMBING[k]), twice = Object.keys(PROBES).filter(k => ELSEWHERE[k] || PLUMBING[k])
    expect([none, twice, Object.keys(PROBES).filter(k => !REG[k])]).toEqual([[], [], []])
  })
  for (const [k, [alt, probe]] of Object.entries(PROBES)) test(k, async () => {
    const a = JSON.stringify(await probe(defaults())), b = JSON.stringify(await probe(put(defaults(), k, alt)))
    expect(b).not.toBe(a)
  })
})

import { check, forcedOf, resolve, rows } from '../config/index'
import { doctorRows, settingsRows } from '../config/route'
describe('validation and provenance (ADR 0019)', () => {
  test('every default passes its own check; a bad value for any enum or number key is refused with a reason, the rest of the layer applies', () => {
    for (const [k, m] of Object.entries(REG)) {
      const def = k.split('.').reduce((o: any, x) => o?.[x], defaults()); expect(check(k, def)).toBe(null)
      const bad = m.opts ? 'bogus' : m.min !== undefined ? m.max! + 1 : undefined; if (bad === undefined) continue
      const r = resolve([{ name: 'u', trust: 'user', value: k.split('.').reduceRight((o: unknown, x) => ({ [x]: o }), bad as unknown) }])
      expect(r.diagnostics.some(d => d.startsWith(`u: ${k}: expected`))).toBe(true)
    }
    const r = resolve([{ name: 'u', trust: 'user', value: { drive: { mode: 'fast', maxTurns: 7 }, nope: 1 } }])
    expect([r.config.drive.mode, r.config.drive.maxTurns, r.diagnostics]).toEqual(['auto', 7, ['u: drive.mode: expected one of: yolo, auto', 'u: nope: unknown key']])
  })
  test('source per key: default, user, repo, env; forced only by FORCE=1 or the effort variable, with the warning', () => {
    const L = [{ name: '~/.claude/cadre.json', trust: 'user' as const, value: { maxParallel: 5 } }, { name: '.cadre/config.json', trust: 'repo' as const, value: { lanes: { fullAt: 4 } } }, { name: 'env', trust: 'user' as const, value: { store: { kind: 'memory' } } }]
    const by = (env = {}) => Object.fromEntries(rows(L, env).map(r => [r.key, r]))
    expect([by().maxParallel.src, by()['lanes.fullAt'].src, by()['store.kind'].src, by()['drive.maxTurns'].src]).toEqual(['user', 'repo', 'env', 'default'])
    expect(by({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' })['roles.worker.byRisk.light.model'].src).toBe('default')
    const f = by({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_EFFORT_LEVEL: 'low' })
    expect([f['roles.worker.byRisk.core.escalate.model'].src, f['roles.worker.byRisk.core.escalate.model'].warn, f['roles.tester.byRisk.light.effort'].warn, f['maxParallel'].src]).toEqual(['forced', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE puts every agent on haiku', 'CLAUDE_CODE_EFFORT_LEVEL puts every agent on effort low', 'user'])
    expect(forcedOf({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })).toEqual({ model: "main's model" })
  })
  test('doctor: refused values and env overrides warn; then every key, non-default first; fixed invariants are shown and not editable', async () => {
    const h = Object.assign(fakeHost({ files: { '/hm/u/.claude/cadre.json': '{"maxParallel":5,"drive":{"mode":"fast"}}' }, env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } }))
    const d = await doctorRows(h), text = d.map(r => `${r[0]} ${r[1]}`)
    expect(text.slice(0, 3)).toEqual(['warn setting refused: ~/.claude/cadre.json: drive.mode: expected one of: yolo, auto', 'warn CLAUDE_CODE_EFFORT_LEVEL puts every agent on effort low: overrides 26 model/effort settings', 'ok setting maxParallel = 5 · user'])
    expect(d.length).toBe(2 + (await settingsRows(h)).length); expect(text).toContain('ok setting fixed.setupLease = 20 turns / 30 min · fixed')
  })
})

import { say } from '../ui/views/activity'
describe('the Activity line names the model the agent runs on and the setting it came from (ADR 0019)', () => {
  test('resolved id when Claude Code reports one, else the alias; forced and escalated say so', () => {
    const v = { b: { tasks: [] } } as any, line = (data: object) => say({ type: 'agent.bound', taskId: 'a1', at: 0, data: { agentId: 'x', taskId: 'a1', role: 'reviewer', ...data } } as any, v)?.text
    expect(line({ model: 'opus', ran: 'claude-opus-5-5', effort: 'high', setting: 'roles.reviewer.byRisk.thorough' })).toBe('a1 reviewer on claude-opus-5-5/high · roles.reviewer.byRisk.thorough')
    expect(line({ model: 'sonnet', effort: 'high', setting: 'roles.worker.byRisk.light.escalate', escalated: true })).toBe('a1 reviewer on sonnet/high · roles.worker.byRisk.light.escalate after a failed round')
    expect(line({ model: 'haiku', effort: 'low', forced: 'haiku/low', setting: 'roles.reviewer.byRisk.light' })).toBe('a1 reviewer on haiku/low · forced by your environment')
  })
})
