# 0021: a planner agent drafts each epic's tasks

Status: accepted (0.12.0). Plan `cadre-0.11.0-plan-explore-cache` ("Epic plans in a milestone"). Extends ADR 0015 (milestone lane), 0018 (cadre starts the agents; the re-entry rule), 0019 (settings registry).

## Why
In a milestone, main drafted every epic's task plan when the next: line named the epic: one main turn (a ~145k cached prefix) per epic, plus the TaskCreate/TaskUpdate rounds, while main also kept the roadmap and the user. An epic plan needs a fresh context with the epic's goal, what already landed and the rules, not main's whole history.

## Decision
**Who.** `milestone.epicPlanner: 'agent' | 'main'` (default `agent`). With `agent`, a planner agent (`agents/planner.md`: Read, inspect, report; read-only; 1h cache TTL like the other task roles) drafts a ready epic's tasks. Main keeps the roadmap and the user and is never asked to plan an epic: its next: line names no `plan epic` step, the approval brief says the epics plan, start, get reviewed and land by themselves, and its `TaskCreate` with `metadata.epic` is refused ("planned for you"). A planner needs cadre to start agents, so `agent` applies only in mod spawn (`drive.spawn` mod, ADR 0018); in main spawn main plans as before, and Activity says which one runs and why (`milestone.epicPlanner`).

**Spawn: the same single site.** No new spawn path. `render.spawnable` lists `{id: <epic>, role: 'planner'}` for every ready (or planning) epic with no binding, so the spawner's existing loop starts it from its `turn.complete` / `command.run` frame (the re-entry rule holds: one `$.agent.spawn`, in `spawner`), counted by `tally` like any spawn, deduplicated by the binding table (`~<epic>` reservation, then the binding) and the in-flight key. The prompt is `PLAN-<epic>`; admission turns it into the planner only when `next.origin.plugin === 'cadre'` (from main it is a plain explorer question). Admission routes it explicitly: `roles.planner.{model, effort}` (default sonnet/high, the plan's routing table), recorded on the binding (turn.step applies the effort) and in `agent.bound` (`setting: roles.planner`), so the Activity line reads `<epic> planner on <model>/<effort> · roles.planner`.

**Input brief** (`core/planner.plannerBrief`), in cache order: the plan block the task agents get (ADR 0022 `briefs.planBlock`: mission, protected paths, the landed core's interface, the notes without paths), the roadmap (every epic's id, title, goal, core, order, files: the same bytes for every planner of the milestone), then this epic (goal, size, files, core), the dependencies already landed with what they changed (each done task's declared files and its new/changed interface symbols), the locked core files (the milestone's `cadre.corePaths`), the notes on the epic's files (`validate.sliceNotes`, `notes.slice`), and the task types with their pipelines. The plan rules (vertical slices, declared paths, core first, scenarios, changelog, interface, 1-7 tasks) are static in the agent file.

**Output: the report tool, not TaskCreate.** Picked because (a) subagents never get Task* (native/tasks answers main only; giving a subagent TaskCreate would need a second, agent-scoped Task* surface and its guards), (b) the report is already every agent's one output contract (ADR 0010) with its own envelope check, and (c) a refused report is a tool result the same agent reads and answers in the same context, which is exactly "back to the same planner". The report: `{role: "planner", summary, tasks: [{subject, description, metadata, after?: [n]}]}` (after = the 1-based numbers of tasks in the list that land first).

**Checks: main's, unchanged.** Each round replaces the last one's drafts, then per task `validateFields` and the duplicate check (`native/tasks.twinOf`: same subject, or same files and description) exactly as main's TaskCreate, `createDraft` + `link`, `lanes.retouch`, then `milestone.planEpic` (the plan missing list incl. the path overlap check, the epic branch cut from the milestone tip, the auto-approval) with the record `auto: plan <e> approved automatically for milestone <m> · drafted by the planner`. A refusal drops the round's drafts and answers `error: <what> (round n/max)` with draft ids renamed `task N`.

**Rounds.** `planner.maxRounds` (default 3) counts refused rounds on the epic (`cadre.planRounds`); a planner that ends its turn without an accepted plan counts one too (not a usage-limit stop) and the spawner starts a fresh one. At the cap the epic stops (`stopEpic`): auto asks the human (Retry clears the rounds and plans it again), yolo goes on with the other epics. This reuses the stopped-epic path rather than adding a decision kind.

## Settings (ADR 0019)
`roles.planner.model` (default sonnet), `roles.planner.effort` (high), category Models and effort; `milestone.epicPlanner` (agent), `planner.maxRounds` (3, 1..10), category Planning. Probes: `tests/settings-behaviour.test.ts` (route for both role keys); scenario proofs in `tests/planner.test.ts` (`epicPlanner = 'main'`, `maxRounds = 2`). `CLAUDE_CODE_EFFORT_LEVEL` now marks 26 routing effort keys.

## Tests
- Kit `tests/planner.test.ts`: planners started by the spawner through admission, one per ready epic, never twice, routed by `roles.planner`, the roadmap block byte-identical; main not nudged (no submit, next: line `wait`, its epic TaskCreate refused); report checks (missing fields, duplicate, path overlap, wrong role); approval + record + drive.decided; rounds cap → stopped epic, auto pause, Retry, fresh planner; a planner stop counts a round; `epicPlanner = 'main'` keeps main planning. `tests/milestone.test.ts` runs with `main` (main's path).
- Real git `tests/git/planner.test.mjs`: a 2-epic milestone in mod mode, both plans from planners, epic branches cut from the milestone tip, workers/reviewers, both epics land on the milestone and the milestone on dev with zero main turns.
- Harness: tier `milestone`, cell `milestone-planners` (`single ready`, sonnet, LANDED=1, PROXY=1, `EPIC_PLANNERS=2`): oracle `epic-planner` (2 accepted planner plans, no main TaskCreate with `metadata.epic`), `routing` covers the planner (proxy + `expect-routing.mjs`).

## Not done
- A planner gets no nudge: a stop without a plan is a round and a fresh planner (simpler than a resume, and its context is cheap).
- In main spawn (`-p` headless, `drive.spawn main`) main still plans the epics.

## Live
See the results section below (filled from the harness runs).
