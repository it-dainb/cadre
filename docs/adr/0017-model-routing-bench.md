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

(pending: first pass light + standard, then thorough + core)
