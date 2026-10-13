// Config defaults + the settings registry (DESIGN 12, ADR 0019). defaults() holds every default value (and the Config type); REG holds every key's metadata.
// tests/config.test.ts pins REG to the leaves of defaults() 1:1, so neither can drift. Layer class: S = safety (repo may only tighten), U = user-level only, O = ordinary (committed).
import { defaults as typeDefaults } from '../task-management/registry'

export type Cls = 'S' | 'U' | 'O'
const role = (tier: string, effort: string, x = {}) => ({ tier, effort, byRisk: {} as Record<string, unknown>, escalate: { after: 0, to: '' }, ...x })
export const defaults = () => ({
  strictness: 'strict', mcpAllow: [] as string[],
  jail: 'auto', jailWritable: [] as string[], effectCheck: 'auto',
  changelog: { path: 'CHANGELOG.md' },
  roles: {   // ADR 0017 locked routing; the thorough reviewer goes to models.deep by itself (core/risk.route)
    testerView: 'view', tdd: { author: 'separate' },
    worker: role('fast', 'high', { escalate: { after: 1, to: 'standard' } }),
    tester: role('standard', 'medium', { byRisk: { light: { tier: 'fast', effort: 'high' } } as Record<string, unknown> }),
    reviewer: role('standard', 'high'),
    explorer: { tier: 'fast', effort: 'low' },
  },
  models: { fast: 'haiku', standard: 'sonnet', deep: 'opus' },
  adapters: {} as Record<string, unknown>,
  store: { kind: 'beads', bin: 'bd', dir: '', timeoutMs: 45000 },
  worktrees: { root: '' },                                    // '' = ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt
  drive: { mode: 'auto', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 },
  cost: { prices: null as unknown, clearHintPct: 40, compactPct: 60 },
  sync: {} as Record<string, unknown>,
  types: typeDefaults() as unknown, packages: [] as { root: string; knownRed?: string[]; [k: string]: unknown }[],
  suites: { integration: 'all' as string | string[] },
  review: { deepLabels: ['security', 'breaking'], maxRework: 3, tiers: { light: { files: 5, lines: 100 }, thorough: { files: 20, lines: 500 }, risky: ['**/auth/**', '**/security/**', '**/crypto/**', '**/permission*/**', '**/migrations/**', '.github/**', '.gitlab-ci.yml', 'Dockerfile', '**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/go.mod', '**/Cargo.toml', '**/pyproject.toml', '**/requirements*.txt'] } },
  limits: { reportRetries: 3, nudges: 2, attempts: 3, rebaseRounds: 2 },
  lanes: { fullAt: 3, milestoneAt: 8 },
  branches: { main: '', dev: 'dev', epicPrefix: 'epic/' }, release: { onEpicDone: 'propose' },
  ui: { glyphs: 'unicode', flash: true, density: 'normal', notify: 'on', escalateAfterMs: 120_000 },
  maxParallel: 3, milestone: { maxEpics: 2 },   // 0 = no cadre cap (drive bounds still apply)
  reuse: { maxContextPct: 60, cacheTtlMs: 3_600_000 },   // 1h: roles ship as agent files with experimental.cacheTtl 1h (A28, ADR 0001 S44)
  disable: false,
})
export type Config = ReturnType<typeof defaults>

// ---- the registry: one row per key ----
export const CATS = ['Drive and autonomy', 'Parallelism', 'Models and effort', 'Review', 'Planning', 'Git and branches', 'Checks and TDD', 'Safety and containment', 'Cache and context', 'Task store and sync', 'UI'] as const
export type Cat = typeof CATS[number]
// tighten: the repo layer's rule (bool -> only the strict value; enum -> the later opt; list -> intersection; min -> lower only; grow -> union).
// open: a free-form object, its inner keys are not validated. ok: a custom check (null = fine, else why).
export interface Meta { cat: Cat; cls: Cls; desc: string; opts?: readonly string[]; min?: number; max?: number; tighten?: 'bool' | 'enum' | 'list' | 'min' | 'grow'; open?: true; ok?: (v: unknown) => string | null }
const m = (cat: Cat, desc: string, x: Partial<Meta> = {}): Meta => ({ cat, desc, cls: 'O', ...x })
const D = 'Drive and autonomy', P = 'Parallelism', M = 'Models and effort', R = 'Review', PL = 'Planning', G = 'Git and branches', C = 'Checks and TDD', SF = 'Safety and containment', CA = 'Cache and context', ST = 'Task store and sync'
const TIER = ['fast', 'standard', 'deep', 'haiku', 'sonnet', 'opus', 'fable'], EFFORT = ['default', 'low', 'medium', 'high', 'xhigh', 'max'], N = (min: number, max = 1e9) => ({ min, max })
const strs = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? null : 'expected a list of text')
const roleRows = (r: string, what: string): Record<string, Meta> => ({
  [`roles.${r}.tier`]: m(M, `${what}: model tier or alias`, { opts: TIER }), [`roles.${r}.effort`]: m(M, `${what}: effort ('default' keeps the agent file's)`, { opts: EFFORT }),
  [`roles.${r}.byRisk`]: m(M, `${what}: {light|standard|thorough: {tier, effort}} per review tier`, { open: true }),
  [`roles.${r}.escalate.after`]: m(M, `${what}: failed rounds before the escalation model (0 = never)`, N(0, 20)), [`roles.${r}.escalate.to`]: m(M, `${what}: the escalation tier or alias`, { opts: ['', ...TIER] }),
})
export const REG: Record<string, Meta> = {
  'drive.mode': m(D, 'yolo: no questions after approval; auto asks at the gates', { cls: 'S', opts: ['yolo', 'auto'], tighten: 'enum' }),
  'drive.maxTurns': m(D, 'a drive stops after this many main turns', { cls: 'U', ...N(1, 10_000) }), 'drive.maxCostUsd': m(D, 'a drive stops at this spend ($)', { cls: 'U', ...N(1, 10_000) }),
  'drive.maxWallMinutes': m(D, 'a drive stops after this many minutes', { cls: 'U', ...N(1, 10_080) }), 'drive.noProgressTurns': m(D, 'an epic stops after this many turns without progress', { cls: 'U', ...N(1, 100) }),
  'limits.nudges': m(D, 'times an agent that stopped without a report is nudged', N(0, 10)), 'limits.attempts': m(D, 'agent runs without a report before the task blocks', N(1, 10)),
  disable: m(D, 'turn cadre off for you, from the next session (env CADRE_DISABLE)', { cls: 'U' }),
  maxParallel: m(P, 'tasks running at once (0 = no cadre cap)', N(0, 100)), 'milestone.maxEpics': m(P, 'epics of a milestone running at once (0 = no cap)', N(0, 100)),
  ...roleRows('worker', 'worker'), ...roleRows('tester', 'tester'), ...roleRows('reviewer', 'reviewer'),
  'roles.explorer.tier': m(M, 'explorer: model tier or alias', { opts: TIER }), 'roles.explorer.effort': m(M, 'explorer: effort', { opts: EFFORT }),
  'models.fast': m(M, 'the model of the fast tier'), 'models.standard': m(M, 'the model of the standard tier'), 'models.deep': m(M, 'the model of the deep tier (thorough review)'),
  'review.deepLabels': m(R, 'task labels that send a change to the thorough review', { ok: strs }), 'review.maxRework': m(R, 'review rounds before a task blocks', N(1, 20)),
  'review.tiers.light.files': m(R, 'at most this many files: light review', { tighten: 'min', ...N(0) }), 'review.tiers.light.lines': m(R, 'at most this many lines: light review', { tighten: 'min', ...N(0) }),
  'review.tiers.thorough.files': m(R, 'more files than this: thorough review', { tighten: 'min', ...N(0) }), 'review.tiers.thorough.lines': m(R, 'more lines than this: thorough review', { tighten: 'min', ...N(0) }),
  'review.tiers.risky': m(R, 'paths whose change always gets the thorough review', { tighten: 'grow', ok: strs }),
  'limits.reportRetries': m(R, 'refused reports before one is accepted unvalidated and flagged', N(1, 3)),
  'lanes.fullAt': m(PL, 'a plan of this many tasks takes the full lane', N(2, 50)), 'lanes.milestoneAt': m(PL, 'a plan of this many tasks should be a milestone', N(2, 100)),
  types: m(PL, 'task types and their pipelines', { open: true }),
  'branches.main': m(G, 'the release branch (set by init)'), 'branches.dev': m(G, 'the integration branch'), 'branches.epicPrefix': m(G, 'epic branch name prefix'),
  'release.onEpicDone': m(G, 'after an epic lands on dev: propose a release, or not', { opts: ['propose', 'off'] }), 'limits.rebaseRounds': m(G, 'reworks onto a moved plan tip before asking you', N(0, 10)),
  'changelog.path': m(G, 'the changelog cadre writes at close'), 'worktrees.root': m(G, "task worktrees ('' = ~/.cache/cadre/wt)", { cls: 'U' }),
  'roles.testerView': m(C, 'view: the tester sees only the interface; full: the whole tree', { cls: 'S', opts: ['full', 'view'], tighten: 'enum' }),
  'roles.tdd.author': m(C, 'separate: a tester agent writes the tests; same: the worker does', { opts: ['separate', 'same'] }),
  packages: m(C, 'packages with their checks (set by init)', { open: true }), 'suites.integration': m(C, "checks run at integration ('all' or a list)", { ok: v => (v === 'all' ? null : strs(v)) }),
  strictness: m(SF, 'strict: guards refuse; advisory: guards warn', { cls: 'S', opts: ['advisory', 'strict'], tighten: 'enum' }),
  mcpAllow: m(SF, 'MCP tools task agents may call', { cls: 'S', tighten: 'list', ok: strs }), jail: m(SF, 'checks run in a sandbox: off, auto (when available), on', { cls: 'S', opts: ['off', 'auto', 'on'], tighten: 'enum' }),
  jailWritable: m(SF, 'extra paths the sandbox may write', { cls: 'S', tighten: 'list', ok: strs }), effectCheck: m(SF, 'audit git effects of tool calls: off, auto, always', { cls: 'S', opts: ['off', 'auto', 'always'], tighten: 'enum' }),
  'reuse.maxContextPct': m(CA, 'an agent past this context fill is not reused', N(1, 100)), 'reuse.cacheTtlMs': m(CA, 'an idle agent older than this is not reused (prompt cache gone)', N(0)),
  'cost.clearHintPct': m(CA, 'context fill that suggests /clear after an epic lands', N(1, 100)), 'cost.compactPct': m(CA, 'context fill that suggests /compact', N(1, 100)),
  'cost.prices': m(CA, '$ per Mtok per tier, for cost in the pane', { cls: 'U', open: true }),
  'store.kind': m(ST, 'task store (env CADRE_STORE)', { cls: 'U', opts: ['beads', 'memory'] }), 'store.bin': m(ST, 'the bd binary', { cls: 'U' }), 'store.dir': m(ST, "task store folder ('' = found by cadre)", { cls: 'U' }),
  'store.timeoutMs': m(ST, 'bd call timeout (ms)', N(1000, 600_000)), adapters: m(ST, 'sync adapters: {command, credentialEnv, grants}', { cls: 'U', open: true }), sync: m(ST, 'sync targets of this repo', { open: true }),
  'ui.glyphs': m('UI', 'unicode or ascii marks', { opts: ['unicode', 'ascii'] }), 'ui.flash': m('UI', 'flash a row when it changes'), 'ui.density': m('UI', 'row spacing', { opts: ['compact', 'normal', 'relaxed'] }),
  'ui.notify': m('UI', 'desktop notifications for what needs you', { opts: ['on', 'off'] }), 'ui.escalateAfterMs': m('UI', 'an unanswered item becomes a desktop notification after this (ms)', N(5_000, 3_600_000)),
}
