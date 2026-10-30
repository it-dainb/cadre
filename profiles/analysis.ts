// The analysis profile (plan 2.12): explore, work, verify with a check, review, landing; no tests-first step, no code vocabulary. `verify` runs the unit's `check` (data argv, jailed) and
// sends the work back once. Omitted sections come from the default profile; its flag rows are merged under the ones listed here.
import type { ProfileLayer } from '../types/profile'
import { modelText } from '../core/say'
import { roles as base } from './default'

const R = 'mcp__cadre__report', I = 'mcp__cadre__inspect'
export const profile: ProfileLayer = {
  schema: 2,
  types: { analysis: { pipeline: ['explore', 'work', 'verify', 'review', 'land'], acceptance: { format: 'what the result must show', cover: 'none' }, contract: 'none', rubric: 'method, evidence, completeness', branch: 'analysis/', commit: 'analysis' } },
  steps: {
    explore: { role: 'scout', workspace: 'none', brief: ['description', 'acceptance'] },
    work: { role: 'analyst', workspace: 'worktree', brief: ['description', 'acceptance', 'handoff', 'findings', 'notes'] },
    verify: { gate: 'check', expect: 'pass', on: 'work', onFail: { retry: 1, then: { back: 'work' } } },
    review: { role: 'examiner', workspace: 'none', brief: ['diff', 'acceptance', 'findings'], onFail: { retry: 2, then: { back: 'work' } } },
    land: { gate: 'integrate', expect: 'pass', on: 'review' },
  },
  roles: {
    explorer: base.explorer,   // main's explore tool and the planners' questions run it whatever the profile
    scout: { description: 'reads what exists and reports what it found for one task', prompt: modelText('agent-file', 'You are a scout. You read what exists for one task, given in your brief, read-only. Cite the source of every fact. Finish with the report tool once: outcome "done" and a short summary.'),
      tools: ['Read', 'Grep', 'Glob', I, R], network: 'off', write: [], ttl: '5m', onSilent: 'nudge', nudge: modelText('nudge', 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "scout", outcome "done" and a summary.'),
      report: { outcomes: ['done'], fields: { summary: { text: 800 } }, required: ['summary'] } },
    analyst: { description: 'does the analysis of one approved task in its own folder', prompt: modelText('agent-file', 'You are an analyst. You own one task, given in your brief. Do the analysis it asks for in your folder and leave the results as files. Finish with the report tool once: outcome "done" and a short summary (outcome "blocked" with a reason if you cannot go on).'),
      tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', R], network: 'on', write: ['**'], ttl: '5m', onSilent: 'nudge', nudge: modelText('nudge', 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "analyst", outcome "done" and a summary.'),
      report: { outcomes: ['done', 'blocked'], fields: { summary: { text: 800 }, reason: { text: 400 } }, required: ['summary'], requiredWith: { blocked: ['reason'] } } },
    examiner: { description: 'examines one analysis against its acceptance', prompt: modelText('agent-file', 'You are an examiner. You judge one analysis against its acceptance and the rubric in your brief: method, evidence, completeness. Cite the file and line of every finding. Finish with the report tool once: a verdict, a summary and your findings.'),
      tools: ['Read', I, R], network: 'off', write: [], ttl: '5m', onSilent: 'retry', nudge: modelText('nudge', 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "examiner", a verdict, a summary and findings.'),
      report: { outcomes: ['pass', 'fail'], fields: { summary: { text: 1500 }, findings: { list: 50 } }, required: ['summary', 'findings'] }, verdict: { pass: 'pass', fail: 'changes', findings: 'files' } },
  },
  checks: { check: { failExit: [1], network: false } }, hooks: {}, landing: { provider: 'direct', onEpicDone: 'off', baseline: 'strict' }, protected: [], sandbox: { env: {} }, fields: [],
}
