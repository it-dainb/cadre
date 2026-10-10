// Golden read model (DESIGN 2.5, v2.5 fields): empty board + a 3-task epic mid-flight. Pinned by tests/snapshot.test.ts.
import type { Snapshot } from '../../../types'

export const EMPTY_KEYS = ['approval', 'containment', 'cost', 'drive', 'epic', 'init', 'mission', 'plan', 'repo', 'resumesQueued', 'schemaVersion', 'seq', 'sync', 'tasks']
export const EPIC: Snapshot = {
  schemaVersion: 1, seq: 41, repo: 'repo-ab12', mission: 'm-1', epic: 'e-1',
  plan: { id: 'p3', slug: 'auth', state: 'approved', epicBranch: 'epic/p3-auth', approvedAt: 1000, landed: { dev: 'dev', sha: '1a2b3c4', at: 2000 }, released: { version: '0.2.0', at: 3000 } },
  tasks: [
    { id: 'a1', title: 'Login', type: 'feature', kind: 'code', merges: true, state: 'done', step: 'merge', phaseSince: 1500, deps: [], flags: [] },
    { id: 'a2', title: 'Docs', type: 'docs', kind: 'docs', merges: true, state: 'active', step: 'worker', phaseSince: 1600, owner: 'ag-2', deps: [{ id: 'a1', type: 'blocks' }], flags: ['edited:pm:title'], card: 'TASK a2' },
    { id: 'a3', title: 'Why slow', type: 'spike', kind: 'spike', merges: false, state: 'todo', step: '', phaseSince: 1000, deps: [{ id: 'a2', type: 'conditional-blocks' }], condition: { on: 'a2', state: 'pending' }, flags: [] },
  ],
  approval: { planId: 'p3', missing: [] },
  drive: { on: true, level: 'epic', epicId: 'e-1', turns: 12, costUsd: 1.5, startedAt: 900, heldBy: 's1' },
  sync: [{ target: 'pm', state: 'offline', pending: 4, at: 1700 }],
  cost: { tokens: 5000, usd: 0.4, cachePct: 87 },
  containment: { state: 'contained', unsandboxed: 0 }, resumesQueued: 1,
  init: [{ stage: 1, state: 'done' }],
}
// What modelView drops: seq, cost, tasks[].phaseSince, sync[].at, drive.{turns,costUsd,startedAt}
export const MODEL_DROPPED = ['seq', 'cost', 'phaseSince', 'turns', 'costUsd', 'startedAt']
