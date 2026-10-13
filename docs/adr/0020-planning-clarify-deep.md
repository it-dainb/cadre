# 0020: planning: clarify before the plan, and `/cadre deep`

Status: accepted (0.12.0). User decisions 2026-10-12 (plan "clarify, epic planner, notes slices, cache layout"); the method is borrowed from oh-my-claudecode's deep-interview (weighted clarity per dimension, one question per round at the weakest, a threshold to stop), not its size.

## Decision

**Clarify gate** (`planning.clarify.enabled`, default on). For a lite, full or milestone goal (not ask), main first spawns ONE explorer: an Agent with `subagent_type: "Explore"`. Admission retypes it to the read-only explorer, routed by `roles.explorer.{model, effort}` like every marker-less Agent. After its answer main records how clear the goal is with TaskCreate `{"kind": "clarity", "outcome", "scope", "acceptance", "constraints"}` (each 0..1). cadre answers what is next (`core/clarify.nextStep`, from the settings):
- every point ≥ `planning.clarify.threshold` (0.7): draft the plan, no questions;
- else (auto): at most `planning.clarify.maxQuestions` (3) questions in ONE AskUserQuestion call, about the weak points, each naming what the explorer found;
- yolo: no questions; the plan must carry `metadata.assumed` (one line per weak point) and the approval dialog shows them as `assumed: …` lines (part of the content hash).

The guide's "do not ask the user" about the mission is gone: the mission is drafted from the goal, the code and the user's answers.

**`/cadre deep <goal>`** (new typed form; also in the READY line, README, commands docs). The explorer first, then rounds: a clarity record, the scores shown to the user in one line (and a toast on every record), ONE question about the weakest point, until every point is clear, `planning.deep.maxRounds` (8) questions were asked, or the user says "enough". The result is the ordinary goal flow: the mission (if none) + the plan draft in the normal approval dialog. Deep asks even when `drive.mode` is yolo: the mode governs the drive after approval. `/cadre` says `talking it through · round r/N · <scores>` while it runs.

**Enforced, not only worded** (ADR 0019). `core/clarify.clarifyCall` (tool.call slot 5, main, goal run on) refuses: a clarity record before the explorer or with a value outside 0..1; a second explorer; AskUserQuestion before a clarity record, when the goal is clear, under yolo, a second round, more than `maxQuestions` questions (gate); more than one question, no fresh record since the last question, or past the round cap (deep); a yolo plan without `assumed` when a point was unclear. With clarify off (and not deep) the brief has no clarify step, a clarity record is refused and AskUserQuestion is not checked (the behaviour before). Probes: `tests/settings-behaviour.test.ts` (all four keys); flows: `tests/clarify.test.ts`.

**Goal-run stop check (carry-over from fix/goal-stop).** It counted any Agent spawn as the ask lane's step, so a lite/full goal could stop after exploring with no plan. `agentrun.seen` now records an Agent of type `Explore` as `goalRun.explored` and only another Agent as `spawned` (the ask step). A stop while the explorer's answer is still pending passes (its answer brings the next turn); after it, a stop without a plan is refused as before. A stop right after AskUserQuestion still passes. Mod mode's task spawning is untouched (the explorer has no task id).

## Why a recorded score

The threshold, the question cap and the round cap must change what happens (ADR 0019), so the scores have to reach code. A TaskCreate kind (like setup's `preferences`) keeps main on a tool it already uses; the answer carries the next step, so the guide stays short (the clarify step is 5 lines; deep is its own 4-line file, inlined only for `/cadre deep`). The Agent type is the explorer's marker because it is a field main sets anyway and needs no text parsing; an explorer spawned without it counts as the ask step (the old behaviour), and the clarity record then asks for a proper one.

## Not done

- No ambiguity score of cadre's own: main scores, cadre enforces what follows. A dishonest "all clear" skips the questions; the explorer and the approval dialog remain.
- The explorer default stays haiku/low (ADR 0017's table); the plan's note "haiku skips searches at low" is for the routing pass to decide.
- Harness cells (vague → explorer → ≤3 questions → plan; yolo → assumptions in the dialog; deep → rounds → plan; clear → no questions): see the report below once run.
