// The flag dialogs of cadre 1.0.1 (d0f4cc0 semantics, recorded from the code at 2a09a57 before S3): per dialog, the option [key, label] in order, and for the dialogs the generic
// builder (core/decide.flagDecision) made (red and stopped are always asked by their own phase first, so the generic one is never seen), the descriptive line. S3's table-built dialogs must equal it: no wording drift (plan cadre-2.0 2.5, S3 acceptance).
// Dialogs a phase asks itself (red, the rebase cap, a spec change that cannot be accepted, a stopped epic) carry their own lines: only their options are pinned.
export const FLAGS_GOLDEN: Record<string, { options: [string, string][]; why?: string }> = {
  "git:dev:agent": { options: [["r", "Restore"], ["k", "Keep"]], why: "a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move." },
  "quarantine:x": { options: [["r", "Restore"], ["k", "Keep"]], why: "a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move." },
  "spec_change": { options: [["a", "Accept"], ["x", "Reject"]], why: "the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests." },
  "shape": { options: [["r", "Retry"], ["x", "Cancel task"]], why: "its agent kept sending reports in a wrong form (an over-long value, an unknown field, a wrong type). Retry: it starts again. Cancel task ends it." },
  "lost-epic": { options: [["r", "Re-cut"], ["x", "End epic"]], why: "the epic branch is gone. Re-cut it from dev, or end the epic." },
  "blocked": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "blocked: the worker asks a question. Type your answer in the chat: it goes to the worker. Keep leaves it waiting for that answer; Cancel task ends it." },
  "attempts": { options: [["k", "Keep going"], ["x", "Cancel task"]], why: "attempts: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it." },
  "no-report": { options: [["k", "Keep going"], ["x", "Cancel task"]], why: "no-report: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it." },
  "stagnant": { options: [["k", "Keep going"], ["x", "Cancel task"]], why: "stagnant: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it." },
  "stale": { options: [["k", "Keep going"], ["x", "Cancel task"]], why: "stale: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it." },
  "loop": { options: [["k", "Keep going"], ["x", "Cancel task"]], why: "loop: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it." },
  "conflict": { options: [["a", "Accept"], ["k", "Keep"], ["x", "Cancel task"]], why: "conflict: Keep accepts the state, Cancel task ends it." },
  "drift": { options: [["a", "Accept"], ["k", "Keep"], ["x", "Cancel task"]], why: "drift: Keep accepts the state, Cancel task ends it." },
  "integration-failed": { options: [["k", "Keep"]], why: "integration-failed: Keep accepts the state." },
  "external": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "external: Keep accepts the state, Cancel task ends it." },
  "locked-dirty": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "locked-dirty: Keep accepts the state, Cancel task ends it." },
  "holds": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "holds: Keep accepts the state, Cancel task ends it." },
  "merge-red": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "merge-red: Keep accepts the state, Cancel task ends it." },
  "rework:2/3": { options: [["k", "Keep"], ["x", "Cancel task"]], why: "rework:2/3: Keep accepts the state, Cancel task ends it." },
  "red (own dialog)": { options: [["r", "Retry"], ["x", "Cancel task"]] },
  "red (own dialog, with passing ids)": { options: [["r", "Retry"], ["h", "Already holds"], ["x", "Cancel task"]] },
  "conflict (rebase cap dialog)": { options: [["r", "Retry"], ["x", "Cancel task"]] },
  "spec_change (cannot be accepted)": { options: [["x", "Reject"], ["c", "Cancel task"]] },
  "stopped (own dialog)": { options: [["r", "Retry"]] },
}
// lost-wip has no decision (released automatically)
export const NO_DECISION = ['lost-wip']
