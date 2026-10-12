# ADR 0013: TUI v2 and autonomy modes (auto by default, `/cadre yolo`)

Status: accepted (0.9.0). User decisions, 2026-10-12 (plan `cadre-0.9.0-ui`, Track B). Supersedes DESIGN §9 "Arming: `/cadre drive on` (human) arms" and ADR 0012 "Continue after approval … drive stays separate".

## Autonomy modes

### Why
0.8.0 asked the human only in the dialog, but after approval main still stopped whenever a turn ended without a next step, and drive had to be armed by a typed command that no longer exists (ADR 0011). A goal should run to dev once the human approved its plan, asking only where a human must decide; and some goals should not ask at all.

### Decision
**Two modes, chosen when the goal is typed.** `/cadre <goal>` = **auto**; `/cadre yolo <goal>` = **yolo** (`commands/cadre.parse`; bare `yolo` is a usage hint; composer origin and an active repo, as any goal). `core/lanes.goal` leaves the mode in `ui.mode`; `relane` takes it once onto the plan it drafts (epic meta `cadre.mode`, `board.plan.mode`); a plan main starts on its own is auto. The approval dialog's first line starts with it (`yolo · lite · 1 task · fix · …`), inside the content hash.

**Default mode: `drive.mode`** (`auto` | `yolo`, default `auto`; user decision, supersedes the first draft's "no default-mode key"). With `yolo`, `/cadre <goal>` is `/cadre yolo <goal>`; `/cadre yolo <goal>` is always yolo; a plan main starts on its own takes it too. Yolo relaxes human gates, so the key is class S with the tighten rule `['enum', 'yolo', 'auto']`: the committed `.cadre/config.json` may only force `auto` (a repo `yolo` is ignored with the diagnostic `drive.mode: the repo file may only tighten this key`); only the user layer (`~/.claude/cadre.json`, the Settings tab) chooses yolo. The approval dialog's first line names the effective mode, so it is never invisible.

**Drive is armed at approval, in both modes, never before.** `dispatch.approve` (first approval only) calls `drive.arm(h, plan.mode)` through the `DRIVE` hook (a static import would be a load cycle). The 0.8.0 approval brief stays as drive's first push (main is idle after a dialog answer, so no turn end would start it); from then on drive submits `Continue: <next>` at every main `turn.complete` (#1, after `next`) until the plan lands on dev. Drive never answers a dialog: it only reads gates. After any dialog answer `dispatch.answer` calls `DRIVE.kick`: a drive paused on a gate that is now gone queues `Continue: <next>` for main.

**Gate policy** (`core/drive.gate`, plus the hooks named):

| Gate | auto | yolo |
|---|---|---|
| spec change | dialog (pause) | main decides: drive's turn-end text asks it to `TaskUpdate <id> metadata.decision "accept\|reject: <reason>"`; `close.decide` applies it through `tdd.resolveSpec(h, id, how, 'main')`; recorded |
| blocked question | dialog / main asks the human (pause) | main answers with `metadata.decision`; `unblock` resumes the worker; recorded |
| rework past `review.maxRework` | the task is cancelled and the plan goes on (recorded); a task other open tasks depend on stops the run instead | same |
| integration red | one lite `bug` fix task, approved by drive (recorded, epic meta `cadre.redFix`); the 2nd red raises `integration-failed` (dialog) | same fix task; the 2nd red stops |
| protected ref moved outside cadre, quarantine | dialog (pause) | stop |
| release | proposed (dialog) | not proposed: drive finishes at "landed on dev; the release is yours" |
| hard stops: an agent moved a protected branch (`git:*:agent`), containment was contained at arm and is not, a settings file changed (hash of `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` at arm), a bound | stop | stop |

`paused` (a gate; lifts by itself) and `stopped` (needs `drive resume`) are separate fields on `board.drive`; bounds now **stop** (0.8.0 paused on them). `stop` hands yolo's quiet `spec_change`/`blocked` flags to the human as decisions. `drive stop|resume|status` are dialog/press commands (the band's key `2`); `resume` is a fresh budget, and on a plan approved without drive it arms it.

**Yolo never asks after approval.** `decide.yoloOn(drive)` gates the places that would: `events.emit` asks no `spec_change`/`blocked` flag decision, `tdd.specChange` no spec dialog, `integrate` no release proposal, `session.reask` (after `/clear`) neither. An approval of new drafts main adds later is still the human's (pause).

**Recorded decisions.** `drive.decided(h, kind, text, taskId?)`: a beads decision record `<mode>: <text>` linked to the plan, and the event `drive.decided {kind: spec|question|rework|integration, text, taskId?}` (actor main for main's decisions). Activity and Doctor read them.

**Board state for the UI** (read-only): `drive {on, level, epicId, mode?, turns, costUsd, startedAt, maxTurns?, maxUsd?, maxMinutes?, paused?, stopped?, heldBy?}`; `drive.status {state: armed|running|paused|stopped|resumed|finished, reason?}`.

### Live fixes (0.9.0 runs)
- After Reject in an auto spec-change dialog main was idle and the worker waited: `resolveSpec` reject now queues the worker's resume and the answer queues `Continue: <result>` for main.
- After the worker's report the task kept its claimer as `owner`, so main's context said the reviewer was running and `nextAction` never said "spawn the reviewer"; main waited on a reviewer that never existed. `owner` is now whoever works the current step: cleared at the worker's report and when a reviewer stops without a verdict, set when admission spawns the reviewer.
- The 5 s heartbeat renewed leases of tasks in review; bd refused it and the failure was logged every tick. Only `active` tasks are beaten.
- Yolo stopped on "blocked <id>" when main's turn ended between the block and its flag (a report in flight). A blocked task without its flag yet now only pauses.
- A worker that kept editing after reporting a spec change was told "write only inside your working directory" and went looking for another place to write (one run ended in a quarantine). A write while the task waits for a decision now says to stop and wait (`policy/guards`).
- In auto, main asked the spec change again with its own question ("ask the human about <id>"): a task waiting on a spec change now reads `wait: the user decides the spec change of <id> in its own dialog`.
- After a rework, drive kept asking main to spawn a reviewer while the bound reviewer was resumed (refused each time): the owner is cleared at the worker's report only when no reviewer is bound.
- A reworking worker's write was blamed on its idle reviewer, which shares the worktree, and quarantined (`core/effect`: every binding of a worktree owns it).
- Flag decisions repeated the task id (`a2 flagged conflict` / `a2 a2`): the body line is the task title only.

### Consequences
- Fixed on the way: `/goal` was noted in `ui.goal`, the slot of the queued brief: a queued brief paused drive as "two loop owners" and a seen `/goal` could be submitted as `true`. It is `ui.loop` now. `tdd.resolveSpec` now moves beads out of `blocked` as `unblock` does, or the worker's next report could not move the task.
- Accepted risk (user): under yolo main may weaken an approved spec. Every decision is recorded, and the reviewer still checks the contract.
- Kit: `tests/drive.test.ts` (parser, mode on the plan, arming only at approval, never answering a dialog, auto's critical list, yolo's spec change and question end to end, rework past the cap, hard stops in both modes, bounds, stop/resume, finish); `tests/git/integrate.test.mjs` (yolo proposes no release; one fix task, then auto asks and yolo stops); `tests/reuse.test.ts` drive tests moved to `arm`.
