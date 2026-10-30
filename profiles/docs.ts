// The docs profile (plan 2.12): a writer, a critic, landing. No tester, no checks, no delivery hooks. Omitted sections come from the default profile; its flag rows are merged under the ones listed here.
import type { ProfileLayer } from '../types/profile'
import { modelText } from '../core/say'
import { roles as base } from './default'

const R = 'mcp__cadre__report', I = 'mcp__cadre__inspect'
export const profile: ProfileLayer = {
  schema: 2,
  types: { doc: { pipeline: ['write', 'review', 'land'], acceptance: { format: 'what the reader must be able to do', cover: 'none' }, contract: 'none', rubric: 'accuracy, tone, completeness', commit: 'docs' } },
  steps: {
    write: { role: 'writer', workspace: 'worktree', brief: ['description', 'acceptance', 'notes'] },
    review: { role: 'critic', workspace: 'none', brief: ['diff', 'acceptance'], onFail: { retry: 2, then: { back: 'write' } } },
    land: { gate: 'integrate', expect: 'pass', on: 'review' },
  },
  roles: {
    explorer: base.explorer,   // main's explore tool and the planners' questions run it whatever the profile
    writer: { description: 'writes or edits the documents of one approved task in its own folder', prompt: modelText('agent-file', 'You are a writer. You own one task, given in your brief. Write or edit only the documents it names, for the reader its acceptance describes. Finish with the report tool once: outcome "done" and a short summary (outcome "blocked" with a reason if you cannot go on).'),
      tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', R], network: 'off', write: ['**'], ttl: '5m', onSilent: 'nudge', nudge: modelText('nudge', 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "writer", outcome "done" and a summary.'),
      report: { outcomes: ['done', 'blocked'], fields: { summary: { text: 800 }, reason: { text: 400 } }, required: ['summary'], requiredWith: { blocked: ['reason'] } } },
    critic: { description: 'reviews one document change against its acceptance', prompt: modelText('agent-file', 'You are a critic. You judge one change to documents against its acceptance and the rubric in your brief: accuracy, tone, completeness. Cite the file and line of every finding. Finish with the report tool once: a verdict, a summary and your findings.'),
      tools: ['Read', I, R], network: 'off', write: [], ttl: '5m', onSilent: 'retry', nudge: modelText('nudge', 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "critic", a verdict, a summary and findings.'),
      report: { outcomes: ['pass', 'fail'], fields: { summary: { text: 1500 }, findings: { list: 50 } }, required: ['summary', 'findings'] }, verdict: { pass: 'pass', fail: 'changes', findings: 'files' } },
  },
  checks: {}, hooks: {}, landing: { provider: 'direct', onEpicDone: 'off', baseline: 'strict' }, protected: [], sandbox: { env: {} }, fields: [],
}
