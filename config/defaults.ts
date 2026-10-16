// Config defaults + the settings registry (DESIGN 12, ADR 0019). defaults() holds every default value (and the Config type); REG holds every key's metadata.
// tests/config.test.ts pins REG to the leaves of defaults() 1:1, so neither can drift. Layer class: S = safety (repo may only tighten), U = user-level only, O = ordinary (committed).
import { defaults as typeDefaults } from '../task-management/registry'

export type Cls = 'S' | 'U' | 'O'
// one routing cell: the model alias and effort for a role at a risk, and the escalation after `after` failed rounds (0 = never)
const cell = (model: string, effort: string, after = 0, up = model, upEffort = effort) => ({ model, effort, escalate: { after, model: up, effort: upEffort } })
const byRisk = (light: Cell, standard: Cell, thorough: Cell, core: Cell) => ({ byRisk: { light, standard, thorough, core } })
type Cell = ReturnType<typeof cell>
export const defaults = () => ({
  strictness: 'strict', mcpAllow: [] as string[],
  jail: 'auto', jailWritable: [] as string[], effectCheck: 'auto',
  changelog: { path: 'CHANGELOG.md' },
  roles: {   // ADR 0017 locked routing, every role x risk cell explicit (ADR 0019): nothing is routed by a rule outside these
    testerView: 'view', tdd: { author: 'separate' },
    worker: byRisk(cell('haiku', 'high', 1, 'sonnet'), cell('haiku', 'high', 1, 'sonnet'), cell('haiku', 'high', 1, 'sonnet'), cell('haiku', 'high', 1, 'sonnet')),
    tester: byRisk(cell('haiku', 'high'), cell('sonnet', 'medium'), cell('sonnet', 'medium'), cell('sonnet', 'medium')),
    reviewer: byRisk(cell('sonnet', 'high'), cell('sonnet', 'high'), cell('opus', 'high'), cell('sonnet', 'high')),
    explorer: { model: 'haiku', effort: 'low' },
    planner: { model: 'sonnet', effort: 'high' },   // drafts each epic's task plan in a milestone (ADR 0021)
  },
  adapters: {} as Record<string, unknown>,
  store: { kind: 'file' },                                    // .cadre/state (task-management/adapters/file)
  worktrees: { root: '' },                                    // '' = ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt
  drive: { mode: 'auto', spawn: 'mod' as 'main' | 'mod', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 },
  cost: { prices: null as unknown, clearHintPct: 40, compactPct: 60 },
  sync: {} as Record<string, unknown>,
  types: typeDefaults() as unknown, packages: [] as { root: string; knownRed?: string[]; [k: string]: unknown }[], units: [] as { root: string; knownRed?: string[]; [k: string]: unknown }[],
  suites: { integration: 'all' as string | string[] },
  // ADR 0023: the tester proposes the command that runs its tests, cadre runs it for red (and green); with no test check it becomes the package's
  tdd: { testerCommand: { use: true, adopt: true }, collectErrors: ['ERROR collecting', 'errors? during collection', 'ImportError', 'ModuleNotFoundError', 'Cannot find module', 'ERR_MODULE_NOT_FOUND', 'SyntaxError', 'Test suite failed to run', '\\[build failed\\]', '\\[setup failed\\]', 'no tests ran', 'No tests found'] },
  review: { coverage: { enforce: true }, deepLabels: ['security', 'breaking'], maxRework: 3, coreTask: 'core', coreDiff: 'thorough', tiers: { light: { files: 5, lines: 100, paths: 2 }, thorough: { files: 20, lines: 500 }, risky: ['**/auth/**', '**/security/**', '**/crypto/**', '**/permission*/**', '**/migrations/**', '.github/**', '.gitlab-ci.yml', 'Dockerfile', '**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/go.mod', '**/Cargo.toml', '**/pyproject.toml', '**/requirements*.txt'] } },
  limits: { reportRetries: 3, nudges: 1, silentRuns: 3, startFails: 3, rebaseRounds: 2, testerRounds: 3 },
  lanes: { fullAt: 3, milestoneAt: 8 },
  planning: { clarify: { enabled: true, maxQuestions: 3, threshold: 0.7 }, deep: { maxRounds: 8 } },   // ADR 0020: explorer + clarity before a goal's plan; /cadre deep
  branches: { main: '', dev: 'dev', epicPrefix: 'epic/' }, release: { onEpicDone: 'propose' }, landing: { mode: 'direct' as 'direct' | 'pr', review: false, remote: 'origin' },
  ui: { glyphs: 'unicode', flash: true, density: 'normal', notify: 'on', escalateAfterMs: 120_000 },
  maxParallel: 3, milestone: { maxEpics: 2, epicPlanner: 'agent' as 'agent' | 'main' }, planner: { maxRounds: 3 },   // 0 = no cadre cap (drive bounds still apply)
  notes: { slice: true },   // ADR 0022
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
const MODEL = ['haiku', 'sonnet', 'opus', 'fable'], EFFORT = ['default', 'low', 'medium', 'high', 'xhigh', 'max'], RISK = ['light', 'standard', 'thorough', 'core'], N = (min: number, max = 1e9) => ({ min, max })
const strs = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? null : 'expected a list of text')
// a role's 4 risk cells x (model, effort, escalate.after/model/effort). The reviewer may not run on haiku (ADR 0016's floor, as allowed values).
const roleRows = (r: string): Record<string, Meta> => Object.fromEntries(RISK.flatMap(k => {
  const at = `roles.${r}.byRisk.${k}`, w = `${r}, ${k} risk`, mo = r === 'reviewer' ? MODEL.filter(x => x !== 'haiku') : MODEL
  return [[`${at}.model`, m(M, `${w}: model`, { opts: mo })], [`${at}.effort`, m(M, `${w}: effort ('default' keeps the agent file's)`, { opts: EFFORT })],
    [`${at}.escalate.after`, m(M, `${w}: failed rounds before it escalates (0 = never)`, N(0, 20))], [`${at}.escalate.model`, m(M, `${w}: model after escalation`, { opts: mo })],
    [`${at}.escalate.effort`, m(M, `${w}: effort after escalation`, { opts: EFFORT })]]
}))
export const REG: Record<string, Meta> = {
  'drive.mode': m(D, 'yolo: no questions after approval; auto asks at the gates', { cls: 'S', opts: ['yolo', 'auto'], tighten: 'enum' }),
  'drive.maxTurns': m(D, 'a drive stops after this many main turns', { cls: 'U', ...N(1, 10_000) }), 'drive.maxCostUsd': m(D, 'a drive stops at this spend ($)', { cls: 'U', ...N(1, 10_000) }),
  'drive.spawn': m(D, "mod: cadre starts, closes and lands the plan's tasks itself while drive runs; main: Claude spawns each step. Env CADRE_SPAWN beats it; a non-interactive session runs main", { cls: 'U', opts: ['mod', 'main'] }),
  'drive.maxWallMinutes': m(D, 'a drive stops after this many minutes', { cls: 'U', ...N(1, 10_080) }), 'drive.noProgressTurns': m(D, 'an epic stops after this many turns without progress', { cls: 'U', ...N(1, 100) }),
  'limits.nudges': m(D, 'times an agent that stopped without a report is nudged', N(0, 10)), 'limits.silentRuns': m(D, 'agent runs without a report before the task blocks', N(1, 10)),
  'limits.startFails': m(D, 'failed agent starts of one task before the run stops', N(1, 10)),
  disable: m(D, 'turn cadre off for you, from the next session (env CADRE_DISABLE)', { cls: 'U' }),
  maxParallel: m(P, 'tasks running at once (0 = no cadre cap)', N(0, 100)), 'milestone.maxEpics': m(P, 'epics of a milestone running at once (0 = no cap)', N(0, 100)),
  ...roleRows('worker'), ...roleRows('tester'), ...roleRows('reviewer'),
  'roles.explorer.model': m(M, 'explorer (a question without a task): model', { opts: MODEL }), 'roles.explorer.effort': m(M, 'explorer: effort', { opts: EFFORT }),
  'review.deepLabels': m(R, 'task labels that make a task thorough risk', { ok: strs }), 'review.maxRework': m(R, 'review rounds before a task blocks', N(1, 20)),
  'review.tiers.light.files': m(R, 'at most this many files: light review', { tighten: 'min', ...N(0) }), 'review.tiers.light.lines': m(R, 'at most this many lines: light review', { tighten: 'min', ...N(0) }),
  'review.tiers.thorough.files': m(R, 'more files than this: thorough review', { tighten: 'min', ...N(0) }), 'review.tiers.thorough.lines': m(R, 'more lines than this: thorough review', { tighten: 'min', ...N(0) }),
  'review.tiers.light.paths': m(R, 'at claim, a task declaring at most this many paths is light risk', { tighten: 'min', ...N(0, 100) }),
  'review.coverage.enforce': m(R, "every scenario needs a spec test named after it, and the reviewer's coverage must be ok for each; off: the reviewer's word decides"),
  'notes.slice': m(PL, "each task's brief carries only the plan notes on its paths (notes without paths go to every task); off: every note goes to every task"),
  'review.coreTask': m(R, 'the risk of a task in the core epic', { opts: RISK }), 'review.coreDiff': m(R, "the risk of a change that touches the landed core's paths", { opts: RISK }),
  'review.tiers.risky': m(R, 'paths whose change always gets the thorough review', { tighten: 'grow', ok: strs }),
  'limits.reportRetries': m(R, 'refused reports before one is accepted unvalidated and flagged', N(1, 3)),
  'lanes.fullAt': m(PL, 'a plan of this many tasks takes the full lane', N(2, 50)), 'lanes.milestoneAt': m(PL, 'a plan of this many tasks should be a milestone', N(2, 100)),
  types: m(PL, 'task types and their pipelines', { open: true }),
  'planning.clarify.enabled': m(PL, 'before a goal is planned: one explorer, then a clarity check; a vague goal gets a few questions (yolo: assumptions instead)'),
  'planning.clarify.maxQuestions': m(PL, 'questions in the one clarify round', N(1, 4)),
  'planning.clarify.threshold': m(PL, 'clarity (0-1) each of outcome, scope, acceptance, constraints needs before Claude plans without asking', { min: 0, max: 1 }),
  'planning.deep.maxRounds': m(PL, '/cadre deep: question rounds before Claude plans anyway', N(1, 20)),
  'branches.main': m(G, 'the release branch (set by init)'), 'branches.dev': m(G, 'the integration branch'), 'branches.epicPrefix': m(G, 'epic branch name prefix'),
  'release.onEpicDone': m(G, 'after an epic lands on dev: propose a release, or not', { opts: ['propose', 'off'] }),
  'landing.mode': m(G, 'a plan lands on dev directly, or as a pull request that merges when its checks pass', { opts: ['direct', 'pr'] }), 'landing.review': m(G, 'pr mode: the pull request also needs an approving review'), 'landing.remote': m(G, 'pr mode: the git remote the pull request goes to'), 'limits.rebaseRounds': m(G, 'reworks onto a moved plan tip before asking you', N(0, 10)),
  'changelog.path': m(G, 'the changelog cadre writes at close'), 'worktrees.root': m(G, "task worktrees ('' = ~/.cache/cadre/wt)", { cls: 'U' }),
  'roles.testerView': m(C, 'view: the tester sees only the interface; full: the whole tree', { cls: 'S', opts: ['full', 'view'], tighten: 'enum' }),
  'roles.tdd.author': m(C, 'separate: a tester agent writes the tests; same: the worker does', { opts: ['separate', 'same'] }),
  'limits.testerRounds': m(C, 'tester reports refused at the red gate (tests not failing for the right reason) before the task blocks and asks you', N(1, 10)),
  'tdd.testerCommand.use': m(C, "the tester names the command that runs its tests; cadre runs it to prove red (and green); off: only the package's test check"),
  'tdd.testerCommand.adopt': m(C, "a package with no test check takes the tester's command (verified red) as its test check, written to the repo settings file"),
  'tdd.collectErrors': m(C, "output patterns (regex) that mean the tests did not run (collection, import or setup error): the tester's report is refused naming the line", { ok: v => strs(v) ?? ((v as string[]).find(x => { try { new RegExp(x); return false } catch { return true } }) ? 'expected valid regular expressions' : null) }),
  packages: m(C, 'packages with their checks (set by init)', { open: true }), units: m(C, 'workspace units {root, kind, ownGit, checks, routing}; replaces packages when set', { open: true }), 'suites.integration': m(C, "checks run at integration ('all' or a list)", { ok: v => (v === 'all' ? null : strs(v)) }),
  strictness: m(SF, 'strict: guards refuse; advisory: guards warn', { cls: 'S', opts: ['advisory', 'strict'], tighten: 'enum' }),
  mcpAllow: m(SF, 'MCP tools task agents may call', { cls: 'S', tighten: 'list', ok: strs }), jail: m(SF, 'checks run in a sandbox: off, auto (when available), on', { cls: 'S', opts: ['off', 'auto', 'on'], tighten: 'enum' }),
  jailWritable: m(SF, 'extra paths the sandbox may write', { cls: 'S', tighten: 'list', ok: strs }), effectCheck: m(SF, 'audit git effects of tool calls: off, auto, always', { cls: 'S', opts: ['off', 'auto', 'always'], tighten: 'enum' }),
  'reuse.maxContextPct': m(CA, 'an agent past this context fill is not reused', N(1, 100)), 'reuse.cacheTtlMs': m(CA, 'an idle agent older than this is not reused (prompt cache gone)', N(0)),
  'cost.clearHintPct': m(CA, 'context fill that suggests /clear after an epic lands', N(1, 100)), 'cost.compactPct': m(CA, 'context fill that suggests /compact', N(1, 100)),
  'cost.prices': m(CA, '$ per Mtok per model alias, for cost in the pane', { cls: 'U', open: true }),
  'store.kind': m(ST, 'task store (env CADRE_STORE)', { cls: 'U', opts: ['file', 'memory'] }),
  adapters: m(ST, 'sync adapters: {command, credentialEnv, grants}', { cls: 'U', open: true }), sync: m(ST, 'sync targets of this repo', { open: true }),
  'ui.glyphs': m('UI', 'unicode or ascii marks', { opts: ['unicode', 'ascii'] }), 'ui.flash': m('UI', 'flash a row when it changes'), 'ui.density': m('UI', 'row spacing', { opts: ['compact', 'normal', 'relaxed'] }),
  'ui.notify': m('UI', 'desktop notifications for what needs you', { opts: ['on', 'off'] }), 'ui.escalateAfterMs': m('UI', 'an unanswered item becomes a desktop notification after this (ms)', N(5_000, 3_600_000)),
  'roles.planner.model': m(M, 'planner (drafts the tasks of each epic of a milestone): model', { opts: MODEL }), 'roles.planner.effort': m(M, 'planner: effort', { opts: EFFORT }),
  'milestone.epicPlanner': m(PL, "agent: a planner agent drafts each epic's tasks when the epic is ready (needs drive.spawn mod); main: Claude drafts them", { opts: ['agent', 'main'] }),
  'planner.maxRounds': m(PL, "rounds a planner's refused task plan gets before its epic stops (auto asks you; yolo goes on with the other epics)", N(1, 10)),
}
