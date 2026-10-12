# Model x effort bench

Measures model x effort per role (worker, tester, reviewer) on well-scoped tasks whose plans are already approved, so planning is out of the measurement.
Metric: **cost per LANDED task** (all $ the runs spent / tasks landed), first-try rate, mean rework rounds, wall time.

```
harness/bench/verify-refs.sh                 # no model: each hidden check fails on the fixture and passes with the reference solution
harness/bench/run.sh harness/bench/pass1.json -n          # runs + estimate only
harness/bench/run.sh harness/bench/pass1.json -j 4 --go   # a grid over $5 needs --go
RESUME=harness/out/bench/<grid>-<stamp> harness/bench/run.sh <grid> --go   # redo only the invalid (budget, usage limit, harness) runs, same plugin commit
node harness/bench/bench.mjs table harness/out/bench/<grid>-<stamp> [--md]
```

| Piece | What it is |
|---|---|
| `repos/strkit`, `repos/ledger` | the two fixture repos (node, no dependencies) |
| `tasks/<id>/plan.json` | the approved plan: repo, tier (light/standard/thorough/core), tasks with scenarios, contract symbols, declared paths, changelog; `after` = deps, `core` = the shared interface |
| `tasks/<id>/ref/` | known-good reference solution (laid over the repo) |
| `tasks/<id>/check.test.mjs` | hidden acceptance check, run on the epic branch tip after the run (core plans: tests named `<task key>.…`) |
| `scaffold.mjs` | builds one run's repo: fixture, `.cadre/config.json` with the cell's `roles`, git main/dev/epic, the store with the plan approved |
| `run.sh` | expands the grid, prints runs + $ + time, runs each headless via `harness/run.sh` (own `PROJECTS` dir per run, timeout `BUDGET`), judges, prints the table |
| `bench.mjs` | `plan` (grid -> runs, estimate), `judge` (one run -> `result.json`), `table` |
| `pass1.json`, `pass2.json`, `smoke.json`, `focus*.json` | grids: `tiers`, `n`, `only` (task ids), and either `workers`/`testers`/`reviewers` (cross product) or `cells: [{worker, tester, reviewer}]`, each `{tier: model, effort, escalate?}`; a haiku worker gets `escalate {after: 1, to: sonnet}` unless `escalateHaiku: false` |

**Landed** = the task is closed in the store AND its hidden check passes on the epic branch. **First try** = landed with 0 rework rounds (`cadre.rework` + `cadre.rebase`) and one worker run. **Escalations** = runs recorded with `escalated` in task meta `cadre.runs`. **Review rejections** = the reviewer's `report` with verdict `changes` (its findings).
**Cost** from the transcripts (main + `subagents/*`), the last usage per message id, at the 5.5 prices: Opus $4/$20, Sonnet $2/$10, Haiku $0.10/$0.50 per Mtok; cache write 5m 1.25x, 1h 2x input; cache read 0.05x (Opus/Sonnet), 0.1x (Haiku). `$/landed (roles)` leaves main out (main is fixed per grid: `MAIN_MODEL`, sonnet).
Evidence: `harness/out/bench/<grid>-<stamp>/<cell>/<task>-<k>/` (gitignored): `work/`, `projects/`, `stream.jsonl`, `out/debug.log`, `result.json`; `table.txt` per grid.
