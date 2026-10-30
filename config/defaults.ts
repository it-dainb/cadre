// Config defaults + the settings registry (DESIGN 12, ADR 0019). defaults() holds every default value (and the Config type); REG holds every key's metadata.
// tests/config.test.ts pins REG to the leaves of defaults() 1:1, so neither can drift. Layer class: S = safety (repo may only tighten), U = user-level only, O = ordinary (committed).
import { roles as profile } from '../profiles/default'
import { active } from '../core/pipeline'

export type Cls = 'S' | 'U' | 'O'
// one routing cell: the model alias and effort for a role at a risk, and the escalation after `after` failed rounds (0 = never)
const cell = (model: string, effort: string, after = 0, up = model, upEffort = effort) => ({ model, effort, escalate: { after, model: up, effort: upEffort } })
// the default cells are the profile's routing (profiles/default.ts roles); the escalation is the setting's own
const byRisk = (role: string, ...up: [number, string] | []) => ({ byRisk: Object.fromEntries(Object.entries(profile[role].routing!).map(([k, c]) => [k, cell(c.model, c.effort!, up[0], up[1] ?? c.model)])) as Record<'light' | 'standard' | 'thorough' | 'core', Cell> })
type Cell = ReturnType<typeof cell>
export const defaults = () => ({
  strictness: 'strict', mcpAllow: [] as string[],
  jail: 'auto', jailWritable: [] as string[], effectCheck: 'auto',
  roles: {   // ADR 0017 locked routing, every role x risk cell explicit (ADR 0019): nothing is routed by a rule outside these
    testerView: 'view', tdd: { author: 'separate' },
    worker: byRisk('worker', 1, 'sonnet'), tester: byRisk('tester'), reviewer: byRisk('reviewer'),
    explorer: { model: 'haiku', effort: 'low' },
    specifier: { enabled: false, model: 'haiku', effort: 'low' },   // A1: a new role ships off until the fold-vs-keep check says otherwise
    planner: { model: 'sonnet', effort: 'high' },   // drafts each epic's task plan in a milestone (ADR 0021)
  },
  adapters: {} as Record<string, unknown>,
  store: { kind: 'file' },                                    // .cadre/state (task-management/adapters/file)
  worktrees: { root: '' },                                    // '' = ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt
  drive: { mode: 'auto', spawn: 'mod' as 'main' | 'mod', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 },
  cost: { prices: null as unknown, clearHintPct: 40, compactPct: 60 },
  sync: {} as Record<string, unknown>,
  profile: 'default' as unknown,   // a built-in profile name (a user layer may also give an inline profile, core/profile); the repo's own is .cadre/profile.json
  units: [] as { root: string; knownRed?: string[]; [k: string]: unknown }[],
  limits: { ...active().limits },   // the engine counters: the active profile's values are the defaults (the step retries are the steps' onFail.retry)
  lifecycle: { firstOutputSec: 240, staleMin: 45, goneSec: 60 },   // stall timers (core/close stalls)
  planning: { clarify: { enabled: true, maxQuestions: 3, threshold: 0.7 }, deep: { maxRounds: 8 } },   // ADR 0020: explorer + clarity before a goal's plan; /cadre deep
  branches: { main: '', dev: 'dev', epicPrefix: 'epic/' },
  ui: { glyphs: 'unicode', flash: true, density: 'normal', notify: 'on', escalateAfterMs: 120_000 },
  concurrency: { default: 3, models: {} as Record<string, number>, providers: {} as Record<string, number> }, models: { allow: [] as string[] },   // default counts tasks (0 = no cadre cap); a model or provider key counts running runs (core/queue)
  milestone: { maxEpics: 2, epicPlanner: 'agent' as 'agent' | 'main' }, planner: { maxRounds: 3 },
  lessons: { model: 'haiku', passesPerDay: 4, repeats: 3, repos: 2, decayDays: 30, maxAgeDays: 90, perBrief: 5 },   // ADR 0028: the side-model pass (0 passes = off), promotion, decay, the feed
  notes: { slice: true },   // ADR 0022
  reuse: { maxContextPct: 60, cacheTtlMs: 3_600_000 },   // 1h: roles ship as agent files with experimental.cacheTtl 1h (A28, ADR 0001 S44)
  disable: false,
})
export type Config = ReturnType<typeof defaults>

// ---- the registry: one row per key ----
export const CATS = ['Drive and autonomy', 'Parallelism', 'Models and effort', 'Review', 'Planning', 'Git and branches', 'Checks and TDD', 'Safety and containment', 'Cache and context', 'Task store and sync', 'UI', 'Workspace units'] as const
export type Cat = typeof CATS[number]
// tighten: the repo layer's rule (bool -> only the strict value; enum -> the later opt; list -> intersection; min -> lower only; grow -> union).
// open: a free-form object, its inner keys are not validated. ok: a custom check (null = fine, else why).
export interface Meta { cat: Cat; cls: Cls; desc: string; opts?: readonly string[]; min?: number; max?: number; tighten?: 'bool' | 'enum' | 'list' | 'min' | 'grow'; open?: true; ok?: (v: unknown) => string | null }
const m = (cat: Cat, desc: string, x: Partial<Meta> = {}): Meta => ({ cat, desc, cls: 'O', ...x })
const D = 'Drive and autonomy', P = 'Parallelism', M = 'Models and effort', R = 'Review', PL = 'Planning', G = 'Git and branches', C = 'Checks and TDD', SF = 'Safety and containment', CA = 'Cache and context', ST = 'Task store and sync'
const mdl = (v: unknown) => (typeof v === 'string' && v ? null : 'expected a model'), EFFORT = ['default', 'low', 'medium', 'high', 'xhigh', 'max'], RISK = ['light', 'standard', 'thorough', 'core'], N = (min: number, max = 1e9) => ({ min, max })
const ref = (empty = false) => (v: unknown) => (typeof v === 'string' && (empty && !v || /^[\w.][\w./-]*$/.test(v)) && !v.includes('..') ? null : 'a git name: letters, digits, . _ / -, not starting with - or .. inside')   // it reaches git push/fetch: an option-like value is refused
const relPath = (v: unknown) => (typeof v === 'string' && v && !v.startsWith('/') && !v.includes('\\') && !v.split('/').includes('..') ? null : 'a path inside the repo: not absolute, no .. segment')   // it is written under a worktree
const caps = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 100) ? null : 'expected {name: whole number 0-100}')
const strs = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? null : 'expected a list of text')
// a role's 4 risk cells x (model, effort, escalate.after/model/effort). The reviewer may not run on haiku (ADR 0016's floor, as allowed values).
const roleRows = (r: string): Record<string, Meta> => Object.fromEntries(RISK.flatMap(k => {
  const at = `roles.${r}.byRisk.${k}`, w = `${r}, ${k} risk`, mo = (v: unknown) => (typeof v !== 'string' || !v ? 'expected a model' : r === 'reviewer' && /^haiku/.test(v) ? 'the reviewer may not run on haiku' : null)
  return [[`${at}.model`, m(M, `${w}: model`, { ok: mo })], [`${at}.effort`, m(M, `${w}: effort ('default' keeps the agent file's)`, { opts: EFFORT })],
    [`${at}.escalate.after`, m(M, `${w}: failed rounds before it escalates (0 = never)`, N(0, 20))], [`${at}.escalate.model`, m(M, `${w}: model after escalation`, { ok: mo })],
    [`${at}.escalate.effort`, m(M, `${w}: effort after escalation`, { opts: EFFORT })]]
}))
const list = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'))
const profileName = (v: unknown) => (typeof v === 'string' || (!!v && typeof v === 'object' && !Array.isArray(v)) ? null : 'a built-in profile name (default, docs, analysis), or an inline profile in your own config file')
export const REG: Record<string, Meta> = {
  profile: m(PL, 'the workflow profile: a built-in name (default, docs, analysis); .cadre/profile.json adds the repo\'s own (read at session start)', { ok: profileName }),
  'drive.mode': m(D, 'yolo: no questions after approval; auto asks at the gates', { cls: 'S', opts: ['yolo', 'auto'], tighten: 'enum' }),
  'drive.maxTurns': m(D, 'a drive stops after this many main turns', { cls: 'U', ...N(1, 10_000) }), 'drive.maxCostUsd': m(D, 'a drive stops at this spend ($)', { cls: 'U', ...N(1, 10_000) }),
  'drive.spawn': m(D, "mod: cadre starts, closes and lands the plan's tasks itself while drive runs; main: Claude spawns each step. Env CADRE_SPAWN beats it; a non-interactive session runs main", { cls: 'U', opts: ['mod', 'main'] }),
  'drive.maxWallMinutes': m(D, 'a drive stops after this many minutes', { cls: 'U', ...N(1, 10_080) }), 'drive.noProgressTurns': m(D, 'an epic stops after this many turns without progress', { cls: 'U', ...N(1, 100) }),
  'limits.nudges': m(D, 'times an agent that stopped without a report is nudged', N(0, 10)), 'limits.silentRuns': m(D, 'agent runs without a report before the task blocks', N(1, 10)),
  'limits.stagnantNudges': m(D, 'times an agent is nudged for stopping without a report, with no tool call in between, before the task blocks', N(1, 10)),
  'lifecycle.firstOutputSec': m(D, 'seconds an agent may run without a model request or a tool call before its start counts as failed', { cls: 'U', ...N(10, 3600) }),
  'lifecycle.staleMin': m(D, 'minutes an agent may go without any activity before it is stopped and its task blocks (never replaced by itself)', { cls: 'U', ...N(1, 600) }),
  'lifecycle.goneSec': m(D, 'seconds an agent whose session is gone may stay bound before its run is released', { cls: 'U', ...N(10, 3600) }),
  'limits.startFails': m(D, 'failed agent starts of one task before the run stops', N(1, 10)),
  'limits.limitWaitMinutes': m(D, 'after a usage limit, the drive waits at least this long before it goes on (minutes)', N(1, 300)),   // 0: a limit with no reported reset would lift at once and retry while still limited
  disable: m(D, 'turn cadre off for you, from the next session (env CADRE_DISABLE)', { cls: 'U' }),
  'concurrency.default': m(P, 'tasks running at once (0 = no cadre cap)', N(0, 100)), 'models.allow': m(M, 'model ids besides the aliases, claude-… and Bedrock ids that a role or unit may name', { ok: strs }),
  'concurrency.models': m(P, 'runs at once per model: {"haiku": 2}', { open: true, ok: caps }), 'concurrency.providers': m(P, 'runs at once per provider: {"anthropic": 4}', { open: true, ok: caps }),
  'milestone.maxEpics': m(P, 'epics of a milestone running at once (0 = no cap)', N(0, 100)),
  ...roleRows('worker'), ...roleRows('tester'), ...roleRows('reviewer'),
  'roles.explorer.model': m(M, 'explorer (a question without a task): model', { ok: mdl }), 'roles.explorer.effort': m(M, 'explorer: effort', { opts: EFFORT }),
  'lessons.model': m(M, 'the side model that turns records into lessons (no agent, one short request per pass)', { cls: 'U', ok: mdl }), 'lessons.passesPerDay': m(M, 'lesson passes per day, counted in the store (0 = lessons off)', { cls: 'U', ...N(0, 100) }),
  'lessons.repeats': m(PL, 'a lesson reinforced this many times in a repo moves to your user scope', N(1, 20)), 'lessons.repos': m(PL, 'a lesson seen in this many repos moves to your user scope', N(2, 20)),
  'lessons.decayDays': m(PL, 'a lesson unused this long is dropped', N(1, 365)), 'lessons.maxAgeDays': m(PL, 'a lesson older than this is dropped, used or not', N(1, 3650)), 'lessons.perBrief': m(PL, 'lessons one task brief carries (its text stays within 1.5 KB)', N(0, 20)),
  'notes.slice': m(PL, "each task's brief carries only the plan notes on its paths (notes without paths go to every task); off: every note goes to every task"),
  'limits.reportRetries': m(R, 'refused reports before one is accepted unvalidated and flagged', N(1, 3)),
  'limits.shapeRetries': m(R, 'malformed reports (an over-long value, an unknown field, a wrong type) of one task before it blocks for you; they never count against the 3 tries', N(1, 10)),
  'limits.specAccepts': m(R, 'times a task\'s request to change its locked spec is accepted before the run stops and asks you', N(1, 20)),
  'planning.clarify.enabled': m(PL, 'before a goal is planned: one explorer, then a clarity check; a vague goal gets a few questions (yolo: assumptions instead)'),
  'planning.clarify.maxQuestions': m(PL, 'questions in the one clarify round', N(1, 4)),
  'planning.clarify.threshold': m(PL, 'clarity (0-1) each of outcome, scope, acceptance, constraints needs before Claude plans without asking', { min: 0, max: 1 }),
  'planning.deep.maxRounds': m(PL, '/cadre deep: question rounds before Claude plans anyway', N(1, 20)),
  'branches.main': m(G, 'the release branch (set by init)', { ok: ref(true) }), 'branches.dev': m(G, 'the integration branch', { ok: ref() }), 'branches.epicPrefix': m(G, 'epic branch name prefix'),
  'limits.rebaseRounds': m(G, 'reworks onto a moved plan tip before asking you', N(0, 10)),
  'worktrees.root': m(G, "task worktrees ('' = ~/.cache/cadre/wt)", { cls: 'U' }),
  'roles.testerView': m(C, 'view: the tester sees only the interface; full: the whole tree', { cls: 'S', opts: ['full', 'view'], tighten: 'enum' }),
  'roles.tdd.author': m(C, 'separate: a tester agent writes the tests; same: the worker does', { opts: ['separate', 'same'] }),
  units: m(C, 'workspace units {root, kind, ownGit, concurrency, checks, routing} (set by init)', { open: true }),
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
  'roles.specifier.enabled': m(M, 'a specifier writes how-to notes for each task before its work starts (it cannot change the scenarios); off: the worker starts from the task as planned'), 'roles.specifier.model': m(M, 'specifier: model', { ok: mdl }), 'roles.specifier.effort': m(M, 'specifier: effort', { opts: EFFORT }),
  'roles.planner.model': m(M, 'planner (drafts the tasks of each epic of a milestone): model', { ok: mdl }), 'roles.planner.effort': m(M, 'planner: effort', { opts: EFFORT }),
  'milestone.epicPlanner': m(PL, "agent: a planner agent drafts each epic's tasks when the epic is ready (needs drive.spawn mod); main: Claude drafts them", { opts: ['agent', 'main'] }),
  'planner.maxRounds': m(PL, "rounds a planner's refused task plan gets before its epic stops (auto asks you; yolo goes on with the other epics)", N(1, 10)),
}
