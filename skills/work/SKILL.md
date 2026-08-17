---
name: work
description: Run a task end to end at the lowest tier that can do it — dispatch cheaply, escalate on failing checks, and use worktree isolation and review only when the change is large or hard to undo.
---

# work

Dispatch. Do not implement it yourself, and do not narrate the plan first.

Every turn you take is billed at the session's tier, which is the most
expensive one available. The measured failure of the previous design was a lead
that wrote specs, reviewed diffs and summarised each step, spending 6.7x more
top-tier output than an agent that simply did the task — for an identical
result. Your turns are the expensive part. Spend as few as possible.

## The ladder

1. Dispatch `doer` on the task as stated. One dispatch, no spec file.
2. It returns `DONE` or `FAILED` with the checks' output.
3. On `FAILED`, dispatch `worker` with the task *and* the failing output.
4. Still failing after that, do it yourself.

Stop at the first rung that passes. Most tasks end at step 1, and that is the
whole point: a small model with the project's own tests to check itself against
solves the ordinary case for a fraction of the cost, and its failures arrive as
test output rather than as plausible prose.

Escalate on evidence — a check that failed. Never on a model's own confidence
report. A wrong answer is usually a confident one.

## Fan out when the work is wide

Fan out on **size, not file count**, and only when the relevant source runs to
tens of thousands of bytes. Check with something like
`find <paths> -name '*.<ext>' | xargs wc -c | tail -1` before deciding.

Below roughly 50 KB, dispatch one `doer` and stop reading this section. Measured:
24 files totalling 2.3 KB cost $0.29 through a single doer and $0.67 split
across six — the lead's own output tripled composing the dispatches and
absorbing the results, and there was no context pressure to relieve. Many small
files look like wide work and are not; splitting them buys nothing and is
charged at the lead's tier.

Above that, dispatch a `doer` per slice **in a single message** so they run at
once. Four to six slices is the useful range; past that, spawn overhead
outgrows the work.

Fan-out buys wall time and spends money — roughly 7x faster and 2.3x dearer in
the case above. Take that trade only when the work is genuinely too large for
one context, or when someone is waiting on the clock and has said so.

List the files first (`Glob`, or the failing test names). Do not read them —
reading is the work you are paying a worker to do, and doing it yourself puts
every file in the most expensive context in the system. Give each doer its own
disjoint file list and let it read only those.

Then run the full suite **once**, yourself, and re-dispatch only the slices that
still fail. A per-slice check is a cheap filter, not proof the whole thing
composes; one authoritative run at the end catches what the slices could not see
about each other.

This is where a fan-out actually earns its overhead. A single agent working
through twenty files carries all twenty in context by the end and pays for that
on every turn; twenty files across five workers means each carries four and the
lead carries none. The saving grows with the width of the task — and inverts on
narrow ones, which is why step 1 stays the default.

## When to spend more

Use the full loop — `planner`, then `worker` with `isolation: "worktree"`, then
`reviewer` on the diff, then merge — when the change is one of:

- large enough to exceed the configured file threshold
- destructive or irreversible: a merge to trunk, a push, a history rewrite, a
  dependency change, a schema migration
- work you have already had to escalate twice

That machinery is insurance, and insurance has a premium. It costs roughly
$0.50 and 100 seconds per task before anything useful happens, so it is worth
buying when a mistake is expensive to undo and wasted otherwise. A one-line fix
does not need an isolated worktree and an independent reviewer.

Where a task has tests, they are the review. A second model's opinion costs
more than running the suite and is worth less.

## The merge gate

A `PreToolUse` hook on Bash. It denies merges, pushes, history rewrites, mass
deletes, dependency changes and schema migrations, plus anything past the file
threshold.

The gate is the enforcement, not a rule for you to apply on its behalf. Attempt
the merge and let it answer. Counting files yourself and stopping to ask is the
failure this is written to prevent: in automatron mode the hook returns
*allow*, and a lead that asks anyway strands finished work in a worktree nobody
will ever approve. `/automatron` removes the human approval, never the review
step. In that mode you do not ask; you merge.

## Depth

Lead dispatches; the dispatched do not dispatch. Past depth 2 a subagent's
completion notification never arrives and the parent waits forever. Coordinate
through files, never by waiting on a notification.

A blocked agent writes `{"state":"blocked","question":"..."}` and stops. Answer
it yourself if you can, and dispatch a fresh agent with the answer — the
worktree still holds the first one's changes.
