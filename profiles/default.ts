// The default profile (plan 2.11), grown slice by slice: S2 the check slots, S3 the flag table, S4 the work roles, S5 the pipelines and the rest. Data, JSON-serializable, no code.
import type { FlagSpec, Profile, RoleSpec, Step, TypeSpec } from '../types/profile'
import { PROMPTS } from '../agents/prompts'
import { modelText } from '../core/say'

export const checks = {
  test: { failExit: [1], network: false },
  setup: { network: true },
} as const satisfies Profile['checks']

// The flag table (plan 2.5): one entry per flag kind (the text before the first ':'). `why` is the dialog line (a person reads it; `{flag}` = the raised flag's full name).
// Effects run in order, no branching; an option with `needs: 'keys'` is offered only when the raiser names it.
const GEN = '{flag}: Keep accepts the state, Cancel task ends it.'
const GO_WHY = '{flag}: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it.'
const KEEP = { key: 'k', label: 'Keep', effect: [{ do: 'clear' }] } as const
const CANCEL = { key: 'x', label: 'Cancel task', effect: [{ do: 'cancel' }] } as const
const ACCEPT = { key: 'a', label: 'Accept', effect: [{ do: 'adopt' }, { do: 'clear' }] } as const
const GO = { key: 'k', label: 'Keep going', effect: [{ do: 'retry', counter: 'silentRuns' }, { do: 'reset', counter: 'nudges' }, { do: 'unblock', note: modelText('context', 'Keep from the human: continue from the last checkpoint on the task branch, and report when done.') }] } as const
const RED = [{ do: 'rewind', to: 'tester' }, { do: 'retry', counter: 'red' }, { do: 'clear', kinds: ['red', 'gate-error'] }, { do: 'dropNeed' }, { do: 'endAgent' }] as const
const REF = { blocks: true, why: 'a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move.', holds: true, yolo: 'human', target: 'ref', options: [{ key: 'r', label: 'Restore', effect: [{ do: 'restore' }] }, { key: 'k', label: 'Keep', effect: [{ do: 'clear', how: 'keep' }] }] } as const
const SAME = { why: GEN, holds: false, yolo: 'human', options: [KEEP, CANCEL] } as const
const STUCK = { why: GO_WHY, holds: false, yolo: 'human', options: [GO, CANCEL] } as const
const SPEC = (how: 'accept' | 'reject') => [{ do: 'spec', how }, { do: 'clear', kinds: ['spec_change'] }] as const
const RED_WHY = 'Retry: fix the cause (the package checks, or the test setup), then a new tester writes the tests again.'
export const flags: Record<string, FlagSpec> = {
  git: REF, quarantine: { ...REF, blocks: false },
  external: { ...SAME, holds: true, blocks: true },
  drift: { ...SAME, holds: true, blocks: true, options: [ACCEPT, KEEP, CANCEL] },
  conflict: { ...SAME, holds: true, blocks: true, options: [ACCEPT, { key: 'r', label: 'Retry', needs: 'keys', effect: [{ do: 'retry', counter: 'rebase', more: 1 }, { do: 'clear', kinds: ['conflict', 'merge-red'] }, { do: 'rework', kind: 'conflict' }] }, KEEP, CANCEL] },
  'merge-red': SAME, holds: SAME, 'locked-dirty': SAME, edited: SAME, 'report-unvalidated': SAME,
  'lost-wip': { why: '', holds: true, blocks: true, yolo: 'human', options: [] },
  reverted: { why: '', holds: false, yolo: 'human', options: [] },   // a mark on a reverted task, never a decision
  'lost-epic': { why: 'the epic branch is gone. Re-cut it from dev, or end the epic.', holds: true, blocks: true, yolo: 'human', target: 'plan', options: [{ key: 'r', label: 'Re-cut', effect: [{ do: 'recut' }] }, { key: 'x', label: 'End epic', effect: [{ do: 'cancel' }] }] },
  'integration-failed': { why: '{flag}: Keep accepts the state.', holds: true, blocks: true, yolo: 'human', target: 'plan', options: [KEEP] },
  stopped: { why: 'Retry: the epic goes on. The epics that wait on it start after it lands.', holds: false, yolo: 'human', target: 'epic', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'resume' }] }] },
  rework: { ...SAME, holds: true },
  red: { why: RED_WHY, holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: RED }, { key: 'h', label: 'Already holds', needs: 'ids', effect: [{ do: 'amend' }, ...RED] }, CANCEL] },
  'gate-error': { why: RED_WHY, holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: RED }, CANCEL] },
  // hook-failed (core/hooks): Retry clears the flag and the next tick runs the hooks again; Skip also drops them (dropNeed)
  'hook-failed': { why: 'a delivery hook failed. Retry runs it again, Skip goes on without it, Cancel task ends the task.', holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'clear' }] }, { key: 's', label: 'Skip', effect: [{ do: 'clear' }, { do: 'dropNeed' }] }, CANCEL] },
  spec_change: { why: 'the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.', holds: false, yolo: 'main', options: [
    { key: 'a', label: 'Accept', effect: SPEC('accept') }, { key: 'x', label: 'Reject', effect: SPEC('reject') }, { key: 'c', label: 'Cancel task', needs: 'keys', effect: [{ do: 'cancel' }] }] },
  blocked: { why: 'blocked: the worker asks a question. Type your answer in the chat: it goes to the worker. Keep leaves it waiting for that answer; Cancel task ends it.', holds: false, yolo: 'main', options: [{ key: 'k', label: 'Keep', effect: [{ do: 'wait' }] }, CANCEL] },
  shape: { why: 'its agent kept sending reports in a wrong form (an over-long value, an unknown field, a wrong type). Retry: it starts again. Cancel task ends it.', holds: false, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'retry', counter: 'shapeRefusals' }, { do: 'unblock', note: modelText('context', 'Retry from the human: report again in the form the report tool describes (each value within its length cap, only its fields).') }] }, CANCEL] },
  attempts: STUCK, 'no-report': STUCK, stagnant: STUCK, stale: STUCK, loop: STUCK,
}

// The work roles (plan 2.4). The prompts stay in agents/prompts.ts (the source of truth); planner and specifier are core planning roles outside this table (core/roles).
// `report.fields` is the report form per role: caps are data (S0 gap G3), `requiredWith` and `ask` the outcome-conditional fields (G2); onSilent per S0 gap G1 (types/profile.ts).
const R = 'mcp__cadre__report', C = 'mcp__cadre__run_check', I = 'mcp__cadre__inspect'
const RUN_EG = modelText('brief', 'e.g. {"command":["node","--test","--test-reporter=junit","--test-reporter-destination=$CADRE_JUNIT","test/login.test.js"]}'), RUN_HINT = modelText('brief', '(pytest: --junitxml=$CADRE_JUNIT; jest: jest-junit)')   // the default profile's example for the tester's `run` and its runner hint (the brief section; the refusal shows the example only)
const STOP = 'You stopped without calling report; a hand-back message is not a report. Call the report tool now'
const cell = (model: string, effort: string) => ({ model, effort })
const text = (n: number) => ({ list: 5, of: { text: n } })
export const roles: Record<string, RoleSpec> = {
  worker: { description: 'implements one approved task in its own folder', prompt: modelText('agent-file', PROMPTS.worker), tools: ['Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', R, C], mcpAllow: true, network: 'on', write: ['**'], ttl: '1h',
    onSilent: 'nudge', nudge: modelText('nudge', `${STOP}: {"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"} (or outcome "blocked" with reason).`),
    report: { outcomes: ['done', 'blocked', 'spec_change'], fields: { summary: { text: 800 }, reason: { text: 400 }, scenario: { text: 300 }, risks: text(120), questions: text(120), followups: { list: 5 } }, required: ['summary'], requiredWith: { blocked: ['reason'], spec_change: ['reason', 'scenario'] },
      ask: { reason: modelText('tool-result', 'required with outcome {outcome}; say what is in the way, then report again'), scenario: modelText('tool-result', 'required with outcome {outcome}; give the changed scenario in full as "<id>: <text>", then report again') } },
    routing: { light: cell('haiku', 'high'), standard: cell('haiku', 'high'), thorough: cell('haiku', 'high'), core: cell('haiku', 'high') } },
  tester: { description: 'writes black-box tests for one task from its scenarios', prompt: modelText('agent-file', PROMPTS.tester), tools: ['Read', 'Write', 'Edit', R], network: 'off', write: ['**'], ttl: '1h',
    onSilent: 'nudge', nudge: modelText('nudge', `${STOP} with role "tester", outcome "done", summary and tests.`),
    report: { outcomes: ['done'], fields: { summary: { text: 800 }, tests: { list: 50, of: { object: { path: { text: 200 }, name: { text: 300 }, ids: { list: 10, of: { text: 20 } } }, required: ['path', 'name'] } }, run: 'command' }, required: ['summary'], requiredWith: { done: ['tests'] }, eg: { run: RUN_EG, runHint: RUN_HINT } },
    routing: { light: cell('haiku', 'high'), standard: cell('sonnet', 'medium'), thorough: cell('sonnet', 'medium'), core: cell('sonnet', 'medium') } },
  reviewer: { description: 'reviews one task commit against its scenarios', prompt: modelText('agent-file', PROMPTS.reviewer), tools: ['Read', I, C, R], network: 'off', write: [], ttl: '1h',
    onSilent: 'retry', nudge: modelText('nudge', `${STOP} with role "reviewer", verdict, summary, findings, coverage and contractStatus.`),
    report: { outcomes: ['pass', 'fail'], fields: { summary: { text: 1500 }, findings: { list: 50 }, coverage: { list: 50 }, contractStatus: { list: 100 } }, required: ['summary', 'findings', 'coverage', 'contractStatus'] },
    verdict: { pass: 'pass', fail: 'changes', findings: 'files' },
    routing: { light: cell('sonnet', 'high'), standard: cell('sonnet', 'high'), thorough: cell('opus', 'high'), core: cell('sonnet', 'high') } },
  explorer: { description: 'read-only recon, discovery and spikes', prompt: modelText('agent-file', PROMPTS.explorer), tools: ['Read', I, R], network: 'off', write: [], ttl: '5m', effort: 'low', maxTurns: 40,
    onSilent: 'nudge', nudge: modelText('nudge', `${STOP}, once: {"schemaVersion":1,"role":"explorer","answer":"<your answer>","citations":[{"path":"src/a.ts","line":1}]}`),
    report: { outcomes: [], fields: { answer: { text: 2000 }, citations: { list: 30 } }, required: ['answer'], ask: { answer: 'required for role explorer' } } },
}

// The pipelines (plan 2.11): a type picks its steps; a step is a role run or a gate. Retries: red = the tester's rounds (limits.testerRounds in 1.0.1), reviewer = the review rounds (review.maxRework).
// green has no onFail: a failing green only refuses the worker's report, unbounded as in 1.0.1.
const GWT = { format: 'Given/When/Then' }
const FULL = ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], LITE = ['worker', 'green', 'reviewer', 'merge']
export const types: Record<string, TypeSpec> = {
  feature: { pipeline: FULL, lite: LITE, acceptance: { ...GWT, cover: 'results' }, contract: 'required', branch: 'feat/', commit: 'feat' },
  bug: { pipeline: FULL, lite: LITE, acceptance: { ...GWT, cover: 'results' }, contract: 'required', branch: 'fix/', commit: 'fix' },
  refactor: { pipeline: LITE, acceptance: { ...GWT, cover: 'report' }, contract: 'required', branch: 'refactor/', commit: 'refactor' },
  docs: { pipeline: ['worker', 'reviewer', 'merge'], acceptance: { format: 'what must be true', cover: 'report' },   // 1.0.1 enforced the reviewer's coverage for every type; `none` would relax it
    contract: 'none', rubric: 'accuracy, tone, completeness', branch: 'docs/', commit: 'docs' },
  test: { pipeline: ['tester', 'reviewer', 'merge'], acceptance: { ...GWT, cover: 'report' }, contract: 'none', branch: 'test/', commit: 'test' },
  spike: { pipeline: ['explorer', 'report'], acceptance: { format: 'question answered', cover: 'none' }, contract: 'none' },
}
export const steps: Record<string, Step> = {
  tester: { role: 'tester', workspace: 'view', brief: ['acceptance', 'contract'], locks: { acquire: 'out' } },
  red: { gate: 'test', expect: 'fail', on: 'tester', onFail: { retry: 3, then: 'human' } },
  worker: { role: 'worker', workspace: 'worktree', brief: ['description', 'acceptance', 'contract', 'locked', 'deps', 'handoff', 'findings', 'decisions', 'notes'], locks: { enforce: 'in' } },
  green: { gate: 'test', expect: 'pass', on: 'worker' },
  reviewer: { role: 'reviewer', workspace: 'none', brief: ['diff', 'acceptance', 'contract', 'locked', 'findings'], onFail: { retry: 3, then: { back: 'worker' } } },
  merge: { gate: 'integrate', expect: 'pass', on: 'reviewer' },
  explorer: { role: 'explorer', workspace: 'none', brief: ['question'] },
  report: { gate: 'report', expect: 'pass', on: 'explorer' },
}
// The delivery hooks (plan 2.7): the closed task's changelog entry goes on its epic branch, a release cuts the changelog; CHANGELOG.md is theirs, so no task agent edits it.
// `${MODULES}` is the plugin's modules folder (core/profile expands it). PATH: the folder's own virtualenv comes first, as node_modules/.bin does for npm scripts.
export const profile: Profile = {
  schema: 2, types, steps, roles, checks, flags,
  hooks: { 'task.closed': [{ run: ['node', '${MODULES}/changelog.mjs', 'entry'], commit: 'docs(changelog): ${id}' }], release: [{ run: ['node', '${MODULES}/release.mjs'], commit: 'chore(release): v${version}' }] },
  landing: { provider: 'direct', onEpicDone: 'propose', prepare: 'setup', baseline: 'tolerate', union: ['CHANGELOG.md'] },
  protected: ['CHANGELOG.md'],
  sandbox: { env: { PATH: '${WT}/.venv/bin:${PATH}' } },
  fields: [{ name: 'scope', store: 'meta', required: false }, { name: 'breaking', store: 'meta', required: false, kind: 'bool' }, { name: 'package', store: 'meta', required: false }, { name: 'changelog', store: 'meta', required: true, want: modelText('context', '{"category":"Added","entry":"…"} or, if users would not notice, {"none":true,"reason":"…"}') }, { name: 'holds', store: 'meta', required: false, kind: 'ids', want: modelText('context', 'acceptance ids already true, e.g. ["A2"]') }, { name: 'lane', store: 'meta', required: false, kind: { enum: ['ask', 'lite', 'full', 'milestone'] } },
    { name: 'risk', store: 'meta', required: false, kind: { enum: ['light', 'standard', 'thorough', 'core'] } }],
  limits: { reportRetries: 3, shapeRetries: 6, nudges: 1, stagnantNudges: 3, silentRuns: 3, startFails: 3, limitWaitMinutes: 15, rebaseRounds: 2, specAccepts: 2 },
}
