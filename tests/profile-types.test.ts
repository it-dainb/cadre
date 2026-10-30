import { expect, test } from 'claude-code/testing'
import type { Profile } from '../types/profile'

// S0: the default profile of plan 2.11 as a const that must type-check against types/profile.ts (types only, no loader).
// The type check is `tsc --noEmit` over this file; at run time the test only pins the shape's cross-references.
const DEFAULT = {
  schema: 2,
  types: {
    feature: { pipeline: ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], lite: ['worker', 'green', 'reviewer', 'merge'], acceptance: { format: 'Given/When/Then', cover: 'results' }, contract: 'required', branch: 'feat/', commit: 'feat' },
    docs: { pipeline: ['worker', 'reviewer', 'merge'], acceptance: { format: 'what must be true', cover: 'none' }, contract: 'none', rubric: 'accuracy, tone, completeness', branch: 'docs/', commit: 'docs' },
    spike: { pipeline: ['explorer', 'report'], acceptance: { format: 'question answered', cover: 'none' }, contract: 'none' },
  },
  steps: {
    tester: { role: 'tester', workspace: 'view', brief: ['acceptance', 'contract'], locks: { acquire: 'out' } },
    red: { gate: 'test', expect: 'fail', on: 'tester', onFail: { retry: 3, then: 'human' } },
    worker: { role: 'worker', workspace: 'worktree', brief: ['description', 'acceptance', 'contract', 'locked', 'deps', 'handoff', 'findings', 'decisions', 'notes'], locks: { enforce: 'in' } },
    green: { gate: 'test', expect: 'pass', on: 'worker', onFail: { retry: 3, then: { back: 'worker' } } },
    reviewer: { role: 'reviewer', workspace: 'none', brief: ['diff', 'acceptance', 'contract', 'locked', 'findings'], onFail: { retry: 3, then: { back: 'worker' } } },
    merge: { gate: 'integrate', expect: 'pass', on: 'reviewer' },
    explorer: { role: 'explorer', workspace: 'none', brief: ['question'] },
    report: { gate: 'report', expect: 'pass', on: 'explorer' },
  },
  roles: {
    worker: { description: 'implements', prompt: 'PROMPTS.worker', tools: ['Read', 'Edit', 'Write', 'Bash'], network: 'off', write: ['**'], ttl: '1h', onSilent: 'nudge',
      report: { outcomes: ['done', 'blocked', 'spec_change'], fields: { summary: { text: 800 }, reason: { text: 400 }, scenario: { text: 300 }, risks: { list: 5 } }, required: ['summary'], requiredWith: { blocked: ['reason'], spec_change: ['reason', 'scenario'] } } },
    reviewer: { description: 'reviews', prompt: 'PROMPTS.reviewer', tools: ['Read'], network: 'off', write: [], ttl: '1h', onSilent: 'retry',
      report: { outcomes: ['pass', 'fail'], fields: { summary: { text: 1500 }, findings: { list: 50 }, coverage: { list: 50 }, contractStatus: { list: 100 } }, required: ['summary', 'findings', 'coverage', 'contractStatus'] },
      verdict: { pass: 'pass', fail: 'changes', findings: 'files' } },
  },
  checks: { test: { failExit: [1], network: false }, setup: { network: true } },
  flags: {
    shape: { why: 'malformed reports', holds: false, yolo: 'main', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'retry', counter: 'shapeRefusals' }, { do: 'unblock', note: 'report again' }] }] },
    red: { why: 'cannot be made red', holds: true, yolo: 'human', options: [
      { key: 'r', label: 'Retry', effect: [{ do: 'rewind', to: 'tester' }, { do: 'retry', counter: 'red' }, { do: 'clear', kinds: ['red'] }, { do: 'dropNeed' }, { do: 'endAgent' }] },
      { key: 'h', label: 'Already holds', needs: 'ids', effect: [{ do: 'amend' }, { do: 'rewind', to: 'tester' }] }] },
  },
  hooks: { 'task.closed': [{ run: ['node', '${MODULES}/changelog.mjs', 'entry'], commit: 'docs(changelog): ${id}' }] },
  landing: { provider: 'direct', onEpicDone: 'propose', prepare: 'setup', baseline: 'tolerate' },
  protected: ['CHANGELOG.md'],
  sandbox: { env: { PATH: '${WT}/.venv/bin:${PATH}' } },
  fields: [{ name: 'breaking', store: 'meta', required: false, kind: 'bool' }, { name: 'holds', store: 'meta', required: false, kind: 'ids' }, { name: 'changelog', store: 'meta', required: ['feature'] }],
  limits: { reportRetries: 3, shapeRetries: 6, nudges: 1, stagnantNudges: 3, silentRuns: 3, startFails: 3, limitWaitMinutes: 15, rebaseRounds: 2, specAccepts: 2 },
} as const satisfies Profile

test('the default-profile-shaped const satisfies the 2.0 profile types and its step references resolve', async () => {
  const p: Profile = DEFAULT as unknown as Profile
  for (const t of Object.values(p.types)) for (const s of [...t.pipeline, ...(t.lite ?? [])]) expect(s in p.steps).toBe(true)
  for (const s of Object.values(p.steps)) if ('role' in s) expect(s.role in p.roles || ['tester', 'explorer'].includes(s.role)).toBe(true)
  expect(p.schema).toBe(2)
})
