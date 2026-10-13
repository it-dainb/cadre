# 0022: path-sliced notes, plan-block-first briefs, scenario coverage as a hard check

Status: accepted (0.12.0). Plan: "Exploration reuse", "Cache layout", "Reviewer gap" (user-approved 2026-10-12/13).

## Decision

**Notes keyed by path.** The plan's `metadata.notes` is `[{paths?, text}]` (at most 3000 characters in all); the old plain string is still accepted as one note for every task. Stored as JSON in the epic's `cadre.notes` (`core/validate.notesOf` reads both forms). `sliceNotes(notes, taskPaths, notes.slice)`: a note without paths is **shared** (plan block, every task); a note with paths goes in the task block (`## Notes on your files`) of each task whose declared paths overlap one of them (`validate.overlap`: same path, folder prefix either way, or a glob match); a task that declares no paths gets every path note. `notes.slice: false` puts every note in the shared block (the 0.11 behaviour). The plan rules now ask for the list form.

**Brief layout for the prompt cache.** Every role's brief is `[plan block][role header][task block]`. The plan block (`briefs.planBlock`) holds only plan-level data: the mission (`board.mission`), the protected paths (config), the landed core task's interface (`cadre.coreContract`, written on the epic by `rebase.coreLanded` from the core task's design), and the shared notes. It is byte-identical for every agent of a plan and carries no ids, times, counters or paths. Everything task-specific (id, title, Files, scenarios, contract, the notes slice, deps, findings, decisions, handoff, other tasks' paths, main's note) comes after it. The reviewer now gets the plan block too (it had no shared notes before). `agents/*.md` stay static (tests pin them to `agents/index.file`).

**Cache TTL per role.** The explorer's agent file now sets `experimental.cacheTtl: 5m` explicitly (a one-shot agent; a 5m write is 1.25x input against 2x for 1h); worker, tester and reviewer keep `1h`. The TTL is shipped in the agent files, so it cannot be a runtime knob (ADR 0019's fixed list); it is a fixed settings row `fixed.cacheTtl` built from `agents/index.TTL`, which `file()` also uses.

**Scenario coverage is a hard check** (`review.coverage.enforce`, default on). The bench saw a Haiku tester miss scenarios S3/S4 and an opus reviewer pass the task. Three gates, all from `validate.untested` / `coverageGaps`:
1. Tester report: every scenario id of the task must appear in at least one test name (`S3`, `s3`, `test_s3_x` count; `S30` and `xs3` do not). Otherwise the report is refused, the copy-in is undone, and the tester is told which ids have no test. This fixes the cause: the locked tests always cover every scenario.
2. Reviewer report: a `pass` is refused when a scenario id appears in no locked spec test name (`cadre.specTests`), or when a coverage entry is not `ok: true` (missing or weak). The refusal says to report `changes` with a major finding for each gap. If the reviewer keeps insisting past `limits.reportRetries` (the lax path), the pass is turned into `changes` with one major finding per gap, so the task never passes. The finding tells the worker to strengthen the test or, when the test is locked, to report `spec_change`.
3. Reviewer brief: a `## Scenario coverage` section states the rule in task language and lists any scenario that no locked test name carries.
A task with no locked tests (no tester step) skips the name check; the coverage-entry check still applies.

## Measurement: cache read share of sibling agents' first requests

Bench smoke, 2026-10-13: the core plan `c1-store` (core task, then two siblings that build on it), one run per plugin, worker haiku/high, tester sonnet/medium, reviewer sonnet/high, main sonnet. Grid `harness/bench/cache.json`; reader `node harness/bench/cache.mjs <evidence dir>` (the first request of every subagent transcript: share = cache_read / (cache_read + cache_creation + input)). Spent $2.58 ($1.95 before, $0.63 after; the difference is rework: the before run had 2 rework rounds and 2 escalations, not caused by the layout).

| first request of | before (eca5a15): read / write tokens | after (5af623b): read / write tokens |
|---|---|---|
| tester, siblings p1.2 / p1.3 | 2738 / 895 · 2738 / 877 (75%, 76%) | 2738 / 1025 · 2738 / 1007 (73%, 73%) |
| worker, siblings p1.2 / p1.3 | 7746 / 1841 · 7746 / 1792 (81%, 81%) | 7746 / 1962 · 7746 / 1899 (80%, 80%) |
| reviewer, siblings p1.2 / p1.3 | 2581 / 3111 · 2581 / 2422 (45%, 52%) | 2581 / 3440 · 2581 / 2597 (43%, 50%) |

(The before run's first core-task agents read 0: both runs started together, so nothing was cached yet. Those rows are left out. The earlier core pass on the same plan (`core-20261013-075914`, every first request) shows the same constants.)

**Result: the layout does not move the cache read share, as the plan expected.** The read on a first request is exactly the role's system prompt + tools (tester 2738, worker 7746, reviewer 2581 tokens), before and after. Claude Code sends the brief as one text block with the cache breakpoint at its end, so a prefix inside the block is never looked up. The plan block is byte-identical across siblings and roles (checked in the after transcripts: same bytes for all six sibling agents, with the landed core's interface in it), and siblings are spawned seconds apart. Even so, the brief is written fresh each time. The siblings' extra write in the after run (+130 tokens tester, +120 worker) is the plan block itself: the protected paths and the core interface, which siblings did not get before.
Kept anyway: it costs nothing, it puts the core interface in front of every dependent (accuracy, not cache), and it is the right order if Claude Code ever sends the brief as separate blocks. The cache lever that is left is main's turns (plan item 8), not the briefs.

## Consequences

- Planner text grew; the plan rules sit at their 1.5 KB cap.
- Old plans with a string `cadre.notes` keep working (one shared note).
- A tester whose framework names tests without the scenario id now gets one refusal, which names the fix. `review.coverage.enforce: false` turns all three gates off.
