// The default profile (plan 2.11), grown slice by slice: S2 holds the check slots only. Data, JSON-serializable, no code.
import type { FlagSpec, Profile } from '../types/profile'
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
const REF = { why: 'a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move.', holds: true, yolo: 'human', target: 'ref', options: [{ key: 'r', label: 'Restore', effect: [{ do: 'restore' }] }, { key: 'k', label: 'Keep', effect: [{ do: 'clear', how: 'keep' }] }] } as const
const SAME = { why: GEN, holds: false, yolo: 'human', options: [KEEP, CANCEL] } as const
const STUCK = { why: GO_WHY, holds: false, yolo: 'human', options: [GO, CANCEL] } as const
const SPEC = (how: 'accept' | 'reject') => [{ do: 'spec', how }, { do: 'clear', kinds: ['spec_change'] }] as const
const RED_WHY = 'Retry: fix the cause (the package checks, or the test setup), then a new tester writes the tests again.'
export const flags: Record<string, FlagSpec> = {
  git: REF, quarantine: REF,
  external: { ...SAME, holds: true },
  drift: { ...SAME, holds: true, options: [ACCEPT, KEEP, CANCEL] },
  conflict: { ...SAME, holds: true, options: [ACCEPT, { key: 'r', label: 'Retry', needs: 'keys', effect: [{ do: 'retry', counter: 'rebase', more: 1 }, { do: 'clear', kinds: ['conflict', 'merge-red'] }, { do: 'rework', kind: 'conflict' }] }, KEEP, CANCEL] },
  'merge-red': SAME, holds: SAME, 'locked-dirty': SAME, edited: SAME, 'report-unvalidated': SAME,
  'lost-wip': { why: '', holds: true, yolo: 'human', options: [] },
  'lost-epic': { why: 'the epic branch is gone. Re-cut it from dev, or end the epic.', holds: true, yolo: 'human', target: 'plan', options: [{ key: 'r', label: 'Re-cut', effect: [{ do: 'recut' }] }, { key: 'x', label: 'End epic', effect: [{ do: 'cancel' }] }] },
  'integration-failed': { why: '{flag}: Keep accepts the state.', holds: true, yolo: 'human', target: 'plan', options: [KEEP] },
  stopped: { why: 'Retry: the epic goes on. The epics that wait on it start after it lands.', holds: false, yolo: 'human', target: 'epic', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'resume' }] }] },
  rework: { ...SAME, holds: true },
  red: { why: RED_WHY, holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: RED }, { key: 'h', label: 'Already holds', needs: 'ids', effect: [{ do: 'amend' }, ...RED] }, CANCEL] },
  'gate-error': { why: RED_WHY, holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: RED }, CANCEL] },
  // hook-failed is raised from S6 on (its Retry then reruns the hook)
  'hook-failed': { why: 'a delivery hook failed. Retry runs it again, Skip goes on without it, Cancel task ends the task.', holds: true, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'clear' }] }, { key: 's', label: 'Skip', effect: [{ do: 'clear' }] }, CANCEL] },
  spec_change: { why: 'the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.', holds: false, yolo: 'main', options: [
    { key: 'a', label: 'Accept', effect: SPEC('accept') }, { key: 'x', label: 'Reject', effect: SPEC('reject') }, { key: 'c', label: 'Cancel task', needs: 'keys', effect: [{ do: 'cancel' }] }] },
  blocked: { why: 'blocked: the worker asks a question. Type your answer in the chat: it goes to the worker. Keep leaves it waiting for that answer; Cancel task ends it.', holds: false, yolo: 'main', options: [{ key: 'k', label: 'Keep', effect: [{ do: 'wait' }] }, CANCEL] },
  shape: { why: 'its agent kept sending reports in a wrong form (an over-long value, an unknown field, a wrong type). Retry: it starts again. Cancel task ends it.', holds: false, yolo: 'human', options: [{ key: 'r', label: 'Retry', effect: [{ do: 'retry', counter: 'shapeRefusals' }, { do: 'unblock', note: modelText('context', 'Retry from the human: report again in the form the report tool describes (each value within its length cap, only its fields).') }] }, CANCEL] },
  attempts: STUCK, 'no-report': STUCK, stagnant: STUCK, stale: STUCK, loop: STUCK,
}
