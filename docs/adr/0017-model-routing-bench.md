# 0017: model x effort routing, decided by a bench

Status: proposed (0.11.0). Nothing is locked until the user reads the results below.

**Knob.** `roles.<worker|tester|reviewer>` = `{tier, effort, byRisk, escalate}` (config, user or repo layer):
- `tier`: a tier name (`fast`/`standard`/`deep` via `models`) or a model alias (`haiku`, `sonnet`, `opus`); `effort`: `low`..`max` or `default` (the agent file's frontmatter).
- `byRisk.<light|standard|thorough>`: `{tier?, effort?}` override for that risk tier. Worker and tester: the risk comes from the task before any diff (`core/risk.taskRisk`: a risky glob, a core task or a deep label = thorough; one file and its test = light; else standard; meta `cadre.risk` wins). Reviewer: the diff tier of ADR 0016.
- `escalate: {after: N, to: <tier|alias>}`: once a task has N failed rounds (review asked for changes, or a rework onto a moved plan), its next run of that role uses `to`. `after: 0` = off.
- Reviewer floor stays (never below sonnet; thorough = deep unless `byRisk.thorough.tier` says otherwise).
- Model goes through the agent.spawn rewrite; effort through the binding (`effort`), applied per request in `turn.step` (agent.spawn has no effort field).
- `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_EFFORT_LEVEL` beat cadre (Claude Code applies them); cadre records the run as `forced` and Activity says so.
- Record: every agent run appends `{role, model, effort, risk, escalated?, forced?}` to task meta `cadre.runs`; `agent.bound` carries `model`, `effort`, `escalated`, `forced`. Activity names escalations and forced runs; the reviewer line shows its model/effort.

**Budget.** Core cap 5500 (user decision 2026-10-12, no cleanup pass first).

**Bench** (`harness/bench/`, README there). 12 tasks over 2 node fixture repos with pre-approved plans (planning is out of the measurement), each with a hidden acceptance check and a reference solution (`verify-refs.sh`: every check fails on the fixture and passes with the reference):

| tier | tasks |
|---|---|
| light | slugMax, titleCase, truncateWords, formatCents |
| standard | slug separator option (+ options module), Ledger.transfer + InsufficientFunds, byMonth + monthKey (UTC) |
| thorough | signed expiring tokens under `src/auth/` (HMAC, constant-time compare), currency migration + ordered, idempotent runner |
| core | a key-value store interface, then ledger persistence and report totals that both build on it (one plan, 3 tasks) |

A run = one task plan executed headless by main (sonnet) through `harness/run.sh` with the cell's roles in `.cadre/config.json`. Landed = closed in the store and the hidden check passes on the epic branch. Cost from every transcript at the 5.5 prices (Opus $4/$20, Sonnet $2/$10, Haiku $0.10/$0.50 per Mtok; cache write 5m 1.25x, 1h 2x; read 0.05x Opus/Sonnet, 0.1x Haiku). Metric: $ per landed task (all, and roles only), first-try rate, mean rework rounds, minutes per run.

## Results

### Pilot (2026-10-12): light + standard, N=1, plugin e9462f1

7 tasks x 6 cells = 42 runs, 0 invalid, $14.49 total (main $9.41, roles $5.08). Main fixed on sonnet; reviewer sonnet/high. A haiku worker escalates to sonnet after one failed round.
Effort verified on the wire (passthrough proxy, `harness/bench/effort-proxy.mjs`): each agent's requests carry the configured `output_config.effort`, Haiku included.

| tier | cell (worker_tester_reviewer) | runs | landed | first-try | mean rework | escalations | $/landed (all) | $/landed (roles) | min/run | src off declared paths |
|---|---|---|---|---|---|---|---|---|---|---|
| light | w-haiku.high+esc.sonnet_t-haiku.high_r-sonnet.high | 4 | 4/4 | 100% | 0.00 | 0 | $0.29 | $0.07 | 2.1 | 2/4 |
| light | w-haiku.high+esc.sonnet_t-sonnet.medium_r-sonnet.high | 4 | 4/4 | 100% | 0.00 | 0 | $0.31 | $0.10 | 1.9 | 1/4 |
| light | w-sonnet.high_t-haiku.high_r-sonnet.high | 4 | 3/4 | 75% | 0.25 | 0 | $0.47 | $0.16 | 2.2 | 1/4 |
| light | w-sonnet.high_t-sonnet.medium_r-sonnet.high | 4 | 3/4 | 75% | 0.25 | 0 | $0.52 | $0.21 | 2.2 | 0/4 |
| light | w-sonnet.medium_t-haiku.high_r-sonnet.high | 4 | 4/4 | 100% | 0.00 | 0 | $0.32 | $0.12 | 1.9 | 1/4 |
| light | w-sonnet.medium_t-sonnet.medium_r-sonnet.high | 4 | 4/4 | 100% | 0.00 | 0 | $0.33 | $0.13 | 2.0 | 1/4 |
| standard | w-haiku.high+esc.sonnet_t-haiku.high_r-sonnet.high | 3 | 3/3 | 100% | 0.00 | 0 | $0.31 | $0.08 | 2.2 | 0/3 |
| standard | w-haiku.high+esc.sonnet_t-sonnet.medium_r-sonnet.high | 3 | 3/3 | 100% | 0.00 | 0 | $0.35 | $0.13 | 2.2 | 0/3 |
| standard | w-sonnet.high_t-haiku.high_r-sonnet.high | 3 | 3/3 | 100% | 0.00 | 0 | $0.39 | $0.13 | 2.2 | 0/3 |
| standard | w-sonnet.high_t-sonnet.medium_r-sonnet.high | 3 | 3/3 | 100% | 0.00 | 0 | $0.39 | $0.17 | 2.1 | 0/3 |
| standard | w-sonnet.medium_t-haiku.high_r-sonnet.high | 3 | 2/3 | 67% | 0.33 | 0 | $0.54 | $0.19 | 2.3 | 0/3 |
| standard | w-sonnet.medium_t-sonnet.medium_r-sonnet.high | 3 | 3/3 | 100% | 0.00 | 0 | $0.37 | $0.14 | 2.2 | 0/3 |

**Every non-landed run had the same cause, in cadre, not in the models.** In all 3 the reviewer asked for the task's changelog entry in CHANGELOG.md, which the worker may not edit (cadre writes it at close). The worker reported blocked and the task stopped at 1 rework. These runs fall in sonnet-worker cells by chance (n=1). With them excluded, every cell landed 100% first try.
**Declared paths are not in the briefs.** Haiku testers/workers sometimes create a new module (`src/titleCase.mjs`) instead of the declared `src/words.mjs`. Hidden checks test behaviour wherever the symbol lives; the last column counts runs with source files outside the declared paths.
**Escalation was never exercised** (no haiku worker failed a round).
Main is ~65% of all $ and depends on cache warmth across parallel runs. So `$/landed (roles)` is the comparison that tracks the role choice: haiku worker + haiku tester $0.07–0.08 vs sonnet/sonnet $0.13–0.21.
Pilot N=1 cannot separate the cells on quality (light/standard are easy for every config); the focus pass decides.

### Focus pass

(pending: 2–3 cells x 7 tasks x N=3, chosen by the user)
