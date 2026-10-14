# 0025: one agent lifecycle, safe exits, landings that wait for your checkout (0.14.0)

Status: accepted (release/0.14.0). Design source: the ADR 0024 draft (agent lifecycle, §2) and the 0.14 plan (`.omc/plans/cadre-1.0.0.md` §3.1, §4). User decisions: "Merge into one ADR" (lifecycle), clean break with no migration, the S0 verdicts below.

## Context

An agent's state was inferred in pieces (bindings, board steps, task meta, `ui.handed`, `ui.retries`) by close, render, guards and the spawner, with about a dozen counters in four stores, each with its own owner and reset. Eleven field failures came from that (an explorer loop on ids with `_`, a tester trapped after a refused report, a claim with no owner after a quit, a yolo Retry that did nothing, stop budgets refilled by retries, …). Separately, a landing moved `dev` under a user who had it checked out and then rewrote their tree to follow it.

## Decision

**Run record, one writer.** Every agent spawned by admission gets a run record `{taskId, role, step, state, epoch, mode, log}`. Its `$.state` copy (`ui.runs`, compare-and-set) is the only one written, by `core/lifecycle.step(h, agentId, event)` through the pure `next(run, event) → {run, effects}`; it is mirrored to `$.store cadre:<repo>:run:<agentId>` (survives `/clear`), and the log keeps the last 20 steps. States: `running`, `refused(n)`, `silent(n)`, `waiting{decision}`, `idle-bound`, `retired`, `ended{done|released|blocked|cancelled|lost}`. Every binding, wake and budget write goes through `core/lifecycle`; `board.patchBinding` writes plain fields only. A frozen scan (`scripts/budget.mjs` → `BUDGET.writesOutside`) fails the suite on any other writer. A binding with no run record ends `lost` and is unbound; after `/clear` a binding comes back only with its record. A waiting run is never retired, nudged or released; every end yields exactly one next step (tests/lifecycle.test.ts).

**One budget per task** `{startFails, silentRuns, nudges, refusals, red, rework, rebase, epoch}` in `$.store cadre:<repo>:budget:<taskId>`, the same pattern. It only grows; the human's Retry resets one counter (`retry(h, task, 'red')`; the rebase Retry sets `rebase` to the cap − 1), from any session (it re-reads the mirror first). `drive resume` resets the drive's bounds, never a task's budget. Per-run counts (nudges, refused reports) live on the run. Exactly-once wake: the epoch is the task's spawn count; one queued wake per agent and epoch, a text never twice, an older run's wake dropped.

**Spawn intent.** The spawner records each start as an intent `{taskId, role, session}` under a nonce and the nonce is the whole spawn prompt. Admission resolves a cadre start only by its intent: an unresolved one is refused with a logged error, never an explorer. Main's own Agent calls keep the id lookup. An intent left by a session that died mid-claim is settled at the next session start: its half-made claim goes back to todo. Reservations are per task and step.

**Exits (§4 rules 1–5).**
1. `SubagentHandback` and `StructuredOutput` pass every guard path (the guard, the re-entry judge, the failure path), never refused; the hand-back's message is still replaced. The refusing hand-back guard is gone.
2. Every role on every exit path reaches a terminal or handed state (tests/exit.test.ts).
3. A tool first seen on a run is journaled; one that is no cadre tool, not the role's and not an MCP server's is listed for Doctor. Observation only.
4. The repeat-call breaker: 20 identical calls in a row (tool + sorted args) refuse the call and spend the run; at its turn end the task blocks with flag `loop` (one dialog).
5. Forced exit: once a run has reported (idle-bound, waiting, ended, retired) or is spent, cadre answers the agent's next model request at `turn.step`, zero tokens, never after a refused report. The form depends on the permission mode the agent was spawned under (S0, Claude Code 2.1.295 and 2.1.299 alike):

| mode | cadre answers | why |
|---|---|---|
| `auto` | text + a `SubagentHandback` chunk | text + `end_turn` alone is re-asked 3 times before the run ends |
| every other mode | text + `end_turn` | the hand-back tool exists in auto mode only ("No such tool") |

Backstop: a forced exit whose turn has not ended 60 s later is stopped once with `TaskStop` (`$.tool.call` from cadre's 5 s tick: no dialog in auto or yolo, S0), ends `lost`, one dialog. The deadline is on the run record, so a reload or `/clear` keeps it. Doctor warns past the tested build (2.1.299).

**Stop causes.** A drive stop records its cause `{taskId, flag}` (the yolo gate's holds, the rework cap, the spec-accept cap) or a usage limit's `{flag: limit, resetAt}`. Answering the cause lifts the stop (the dialog clears the flag; the reset time passes); the run goes on by kick → queueBrief → main's turn end → the spawner. No dialog answer, press or timer starts an agent itself. A usage limit (H14) is a stop with its reset time, charging nothing. In mod mode main never messages an agent.

**Landings wait for your checkout (H5).** cadre never moves a branch checked out in a worktree. The landing waits as `refs/cadre/pending/<branch>` (CAS, so landings stack) with `refs/cadre/base/<branch>` (the tip it first merged on); one dialog offers **Land**. Every reader of the dev tip reads the pending tip (`baseOf`): the epic cut, integration, release, the release proposal, the tdd baseline, freshen, and a resolve task, which records that sha so its close compares protected paths against it. Land: if you committed meanwhile, your commit stays and the landing re-integrates onto it through the trial merge and the suites; then `merge --ff-only` in your worktree moves ref, index and files together, refusing on conflicting edits. A branch checked out nowhere lands by itself at the next landing, session start or tick (≤ 2 rounds, then one dialog). A release is refused while dev or main waits. A dev you moved during a run is merged into the plan and its running workers get it. This replaces the automatic refresh of your checkout.

**Clean break.** 0.13 state is not read: no migration, no alias. Doctor says "finish or cancel plans from the previous version before upgrading" when it finds the old counters on open tasks, hand-back marks, or agents bound with no run record.

## Settings (registered, ADR 0019)

| key | default | was |
|---|---|---|
| `limits.silentRuns` | 3 | `limits.attempts` (renamed, no alias) |
| `limits.startFails` | 3 | a fixed 3 |

The breaker's 20 and the backstop's 60 s are fixed for now.

## Removed

Meta `cadre.attempts`, `cadre.nudge`, `cadre.testerRounds`, `cadre.rework`, `cadre.rebase`; `ui.handed`, the agent `ui.retries` keys; `TASK-<id>`/`PLAN-<id>` prompt parsing for cadre's spawns; the refusing hand-back guard; the automatic refresh of the user's checkout; `limits.attempts`.

## Release notes (0.14.0)

- An agent can always end; cadre ends one that is done itself, at zero tokens, and stops one that keeps repeating a call.
- A drive stopped on a flag goes on when you answer it (yolo Retry used to do nothing); a usage limit stops the drive until it resets, then it goes on by itself.
- A landing never moves a branch you have checked out: it waits, and a dialog lands it into your checkout with your commits and edits kept.
- A session that quits mid-start leaves nothing stuck; ids with `_` work.
- Settings: `limits.attempts` is now `limits.silentRuns`; new `limits.startFails`.

## Evidence

Offline: kit 1047 pass, real-git + protocol 120 pass, the replay net (tests/replay.test.ts, field failures 1–11 and regressions 12–20, every row green, each checked against its fix reverted), budget core 5877 / 7000 (plan ~6120). Live: S0 verdicts above (scripted, zero quota). Owed before release: the scripted cells (`exit-every-role`, `forced-exit`, `underscore-id`, `usage-limit`, `dev-moved`), `clear-bg-agents`, and the quick tier, after the user's OK.
