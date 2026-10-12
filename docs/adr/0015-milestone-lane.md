# ADR 0015: the milestone lane (wave 1: backend)

Status: accepted (0.10.0, wave 1). User decisions, 2026-10-12 (plan `cadre-0.10.0-milestone`). Extends ADR 0011 (lanes), ADR 0013 (autonomy), ADR 0014 G (core first, trial merge, rework).

## Why
A goal of several features (or more than ~7 tasks) made one plan too big for one context, one review queue and one approval. Splitting it by hand meant several goals, several approvals, and nothing kept them in order.

## Decision
**Model.** mission (project) → **milestone** (one `/cadre <goal>`) → epics (each a plan of 1-7 tasks) → tasks. In beads the milestone is the plan's epic record (`cadre.lane = milestone`); its children are `epic` records (parent-child), ordered by `blocks`; each epic's tasks are its children. The board keeps ONE plan (the milestone, `board.epic` = its id, `plan.epicBranch` = the milestone branch) and the tasks of every epic (`SnapTask.epic`); `plan.epics` is the roadmap, derived from beads at every mirror (`core/milestone.roadmap`): `draft · waiting · ready · planning · running · landed · stopped`.

**Lane.** `milestone` joins ask · lite · full. Main picks it (guide: several features, or more than about 7 tasks). Fixed override: a plan draft with more than 7 tasks keeps `full` but its lane line says `8 tasks: a milestone fits` and the dialog's Lane option is `Lane → milestone`. Change lane full ↔ milestone drops the drafts (tasks and epics do not convert) and briefs main to draft the other shape; the plan record and its id stay.

**Roadmap draft.** Every TaskCreate after the milestone's is an epic: subject, goal (description), `metadata.size` (1-7 tasks), `metadata.paths`, optional `metadata.core`; dependencies by `addBlockedBy`. The missing list (`validate.missingList`, same code as tasks) wants goal, size and paths, 2+ epics, a core epic of at most 2 tasks, and refuses two unordered epics on one path: `move it into the core epic or add a dependency`.

**Critic (from OMC ralplan).** When nothing else is missing, the draft still lacks `critic review`: main spawns ONE plain Agent (an explorer: fresh context, read-only) with the whole roadmap, merges what it gets right, and records `metadata.critique` on the milestone. The critique is refused until an explorer answer exists in this session. Only then is the dialog drawn. Not enforced: that the critic saw the final version (merging the critique changes the draft by design).

**One approval, both modes.** The dialog `approve milestone <id>`, first line `auto|yolo · milestone · N epics · <reason>`, one line per epic with `core`, size and `after …`. Approve cuts `milestone/<id>-<slug>` from dev and arms drive. Nothing else in the milestone is approved by the human.

**Just-in-time epic plans.** An epic becomes `ready` when its dependencies landed and a slot is free (`milestone.maxEpics`, default 2, 0 = no cap; running + planning epics count). The next: line says `plan epic <id>: TaskCreate its tasks with metadata.epic "<id>", then TaskUpdate <id> metadata.planned true`. The first task's answer carries the plan rules. `planned: true` checks the epic's drafts with the plan missing list, then approves them automatically (`core/milestone.planEpic`), cuts `epic/<id>-<slug>` from the milestone tip, and records it (`drive.decided` kind `plan` + beads decision `<mode>: plan <id> approved automatically for milestone <m>`). Gates inside an epic follow the mode as before.

**Running.** Tasks of all running epics share one board: admission takes the ready list and the branch of the task's epic and refuses a task whose epic is not running; maxParallel caps tasks across epics; a squash goes into the task's epic branch; siblings are refreshed only within their epic (another epic gets the milestone tip at its own landing).

**Landing.** `TaskUpdate <epic> completed` → `integrate.integrateEpic` with the milestone branch as the target: the plan state `integrating` is the lock (one landing at a time; a second is refused "call TaskUpdate completed again after it"), merge `--no-ff` in a throwaway worktree with the footer `Milestone: <id> <slug>`, the epic's changelog entries amended in, the suites on the MERGED result, CAS on the milestone ref, the epic branch deleted, the epic closed in beads, `plan.landed {planId: epic, on}`. A core epic's files are then locked for every later task (`rebase.coreLanded`). The milestone then takes dev's news (`freshen`: dev merged into the milestone branch in a throwaway, CAS; a conflict is left for the final landing). When the last epic lands, the milestone lands on dev at once (the existing path) and the release is proposed once (auto; yolo: none), cut as `chore(release): vX.Y.Z — milestone <id> <slug>`. Single-epic goals keep epic → dev unchanged.

**Failures and bounds.** Red on the merged result while driving: ONE fix task in that epic (`drive.redFix`, unchanged); the second red, or a merge conflict with the milestone, stops THAT epic (`cadre.stopped` on the epic; decision `flag:<epic>:stopped`, Retry = `resolve <epic> keep`). A stopped epic stops the epics that wait on it; independent epics go on in yolo, auto pauses for the human (`drive.gate`); yolo stops once nothing else can move. The milestone's own red on dev gets no fix task (its children are epics): the flag asks the human. Drive bounds cover the whole milestone: the plan bounds (turns, $, minutes) times the number of epics. Per-epic no progress: a running epic with a free task slot and nothing of it running, in review or blocked stops after `noProgressTurns` drive turns while the rest goes on (the global no-progress bound still holds the whole run).

**Continue.** `/cadre continue` needed no change beyond the board: the rebuilt board holds the tasks of every epic, so every in-flight task of every running epic is picked up; a cold repo adopts a milestone with its lane and branch.

## Live (ADR 0005)
sonnet, auto, three small features: one roadmap dialog after the critic's review; two epics in parallel within maxEpics 2, the third after the first landed; all three landed on the milestone branch, the milestone on dev about 6 minutes after Approve; release once, named for the milestone. A first run where main picked full led to the guide's "two or more separate features" rule.

## Seams for wave 2
- Epic-level conflict path: `integrate.landed` is where running epics would get the new milestone tip (today they merge onto it at their own landing); `integrate.integrateEpic`'s `fail(..., true, false)` for a merge conflict is where a `resolve-conflict` task would be created instead of `stopEpic`; promote-to-core mid-run would add a core epic through `planEpic`'s path.
- UI: `plan.epics` (roadmap + states + `why`) and `SnapTask.epic` are on the human view for the header, tab 5 and the band; `plan.landed` carries `on` (Activity says `landed on milestone/…`).

## Consequences
- `metadata` gains `epic`, `size`, `planned`, `critique`; `lane` gains `milestone`. `milestone/` branches are protected like `epic/` ones.
- Kit: `tests/milestone.test.ts` (lane + override + Change lane, roadmap missing list, critic, the one dialog, approval, JIT auto-approval + record, scheduling within maxEpics, next: line, stop propagation per mode, per-epic no progress, scaled bounds, admission per epic, continue). Real git: `tests/git/milestone.test.mjs` (landing on the milestone branch, footer, freshen, the milestone on dev, release subject, one landing at a time, red → fix task → stop, conflict → stop).

## Wave 2: conflicts between epics
User decisions, 2026-10-12 (plan `cadre-0.10.0-milestone`, "Conflicts between epics"). Reuses ADR 0014 G (`core/rebase.ts`).

**Trial merge before every landing.** `integrateEpic` runs `git merge-tree --write-tree` of the target tip (the milestone branch, or dev for a single plan) and the epic branch first; a conflict skips the merge attempt and names the files.

**A conflict is a task, not a stop.** A conflict at landing adds ONE resolve task to that epic (`rebase.resolveTask`): type `refactor`, lane lite (worker → green → reviewer → merge), changelog none, meta `cadre.resolve = <target>`. Its worktree and branch are created at once from the epic tip with the target merged in and the conflict left in the files (`MERGE_HEAD`, markers); the claim keeps that tree. The description gives both sides: this epic's goal and the epics already on the target. The worker resolves it, the usual gates run (green on the merged tree, a review), and close lands it on the epic branch as a real merge (`--no-ff`), not a squash: a squash would drop the target as a parent and the landing would conflict again. Its protected files that equal the target's (the changelog the earlier landings amended) are not counted as its edits. Main then completes the epic again. Both modes, automatic, recorded (`drive.decided` kind `resolve` + a beads decision). At most 2 per epic (`cadre.resolves`); then a milestone epic stops (`stopEpic`: auto asks with the files and the epics already landed; yolo stops that epic, independent epics go on) and a single plan gets the `integration-failed` flag as before. Default for single-epic plans (the plan left it open): the same resolve task, since it is gated the same way; the milestone's own landing on dev keeps asking the human (its children are epics, not tasks).

**Running epics take the new milestone tip.** After an epic lands (and the milestone took dev's news), every other running epic gets the milestone tip merged into its branch in a throwaway worktree with a CAS on the branch (`rebase.refreshEpics`), then its running workers get the new epic tip (`rebase.refresh`, scoped to that epic). An epic that would conflict is left alone: its own landing turns the conflict into a resolve task.

**Early heads-up.** `rebase.watch` (60 s) also compares the branches of running epics pairwise; a collision tells every running worker of both epics once.

**Promote to core mid-run.** In a running milestone, `TaskCreate` with `metadata.core: true` and no `epic` adds a core-patch epic: approved at once (recorded `drive.decided` kind `plan`), scheduled and planned like any epic; when it lands its files are locked for the later tasks (`coreLanded`) and the running epics take it (above). The goal guide names it in one line.

**Rejected.** Resolving a conflict in the epic's last task (its worker is gone and its review done); merging epic branches into each other (the rule stays: a child builds only on what landed on its parent).
