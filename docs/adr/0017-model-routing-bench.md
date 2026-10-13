# 0017: model x effort routing, decided by a bench

Status: accepted (0.11.0). Routing locked by the user on 2026-10-13 from the results below.

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

### Focus pass (2026-10-13): plugin 42c2ebb, N=3

Cells: **A** worker haiku/high (+ escalate to sonnet after 1 failed round), tester haiku/high · **B** worker haiku/high (+ escalate), tester sonnet/medium · **C** worker sonnet/medium, tester sonnet/medium. Reviewer sonnet/high; risk sizing (ADR 0016) sends thorough tasks to opus/high. Main sonnet. $30.28 spent of the $35 cap. Ran at -j 2 after a subscription usage limit (429) cut the first attempt; runs it hit were invalid and re-run.

| tier | cell | runs | landed | first try | escalations | $/landed (roles) | $/landed (all) | min/run | main stalls |
|---|---|---|---|---|---|---|---|---|---|
| light | A haiku / haiku | 12 | 12/12 | 100% | 0 | $0.07 | $0.29 | 2.0 | 0 |
| light | B haiku / sonnet.med | 12 | 12/12 | 100% | 0 | $0.10 | $0.32 | 2.0 | 0 |
| light | C sonnet.med / sonnet.med | 12 | 9/12 | 75% | 0 | $0.15 | $0.44 | 1.7 | 3 |
| standard | A haiku / haiku | 9 + 3 | 8/9 + 1/3 | 75% | 0 | $0.08–0.11 | $0.33–0.82 | 2.1 | 1 (+1 likely) |
| standard | B haiku / sonnet.med | 9 | 9/9 | 100% | 0 | $0.13 | $0.49 | 2.2 | 0 |
| standard | C sonnet.med / sonnet.med | 9 | 9/9 | 100% | 0 | $0.16 | $0.38 | 2.1 | 0 |
| thorough | A haiku / haiku | 6 | 3/6 | 50% | 0 | $0.44 | $0.91 | 2.8 | 0 |
| thorough | B haiku / sonnet.med | 6 | 6/6 | 83% | 1 (landed) | $0.37 | $0.66 | 3.2 | 0 |

(A standard: 9 runs in the first grid, plus 3 more on s2-transfer to probe its one miss. The first grid's A and B-light rows come from its run log: a resume bug, now fixed, deleted that grid's per-run evidence after it was judged.)

**Why tasks did not land**
- **Main stalls (driver, independent of the roles): 4, plus 1 likely.** After the tester step, main read the card "next: spawn TASK-… (worker)" but sent SendMessage to the finished tester instead of spawning the worker. It then decided the "worker" had returned nothing and ended its turn. Every C-light miss was this; it is not a sonnet-worker failure. Fix in the main-facing card or guide.
- **Haiku tester writes a wrong locked test (A only): 2.** t1 assumed a 3-part token (JWT habit) where the spec says 2; s2 had tests that fail in their own setup. The worker correctly raised spec_change, and the task blocked for a human.
- **Haiku tester misses scenarios, and review passes it (A only): 2.** In t2-migration, S3 (an existing currency is kept) and S4 (order regardless of list order) were untested and unimplemented. The **opus** reviewer passed both, so the hidden check is what caught them.
- **Review rejection (1, B thorough, t1):** "the expiry check fails open: `now` is never validated (`{now: null}` → never expires)". The next round escalated the worker to sonnet, the fix was accepted, and the task landed. Escalation worked the one time it fired.
- The pilot's changelog false-reject is gone (42c2ebb). No runs went outside the declared paths (briefs carry Files since 8a0f148).

**Reading.** On light/standard/thorough tasks, the tester is the role whose model matters. A Haiku worker is enough when a sonnet tester writes the locked tests and the review gate plus escalation catch the rest. A Haiku tester is fine on light tasks but writes wrong or weak specs from standard upward, and review does not reliably catch a weak spec. Sonnet workers (C) bought nothing over Haiku workers (B) at about 20–25% more role cost. Main is 55–75% of all spend whatever the roles are.

### Core pass (2026-10-13): plugin 42c2ebb, N=3, $5.23

One plan = 3 tasks: a key-value Store interface (the core task), then ledger persistence and report totals, which both build on it. Tester sonnet/medium, reviewer sonnet/high.
Routing at 42c2ebb: the core task's worker/tester risk is thorough (`taskRisk`: `cadre.core`), but the cells set no `byRisk`, so models are as configured. The reviewer tier comes from the diff: the core's own review is light (its paths become core paths only when it lands). A dependent goes to opus only if its diff touches the core's files. None did, so every review ran on sonnet/high.

| tier | worker | runs | tasks landed | first try | rework | escalations | $/landed (roles) | $/landed (all) | min/run | dependents touching the core |
|---|---|---|---|---|---|---|---|---|---|---|
| core | haiku/high + escalate → sonnet | 3 | 9/9 | 100% | 0 | 0 | $0.12 | $0.25 | 4.9 | 0/6 |
| core | sonnet/high | 3 | 9/9 | 89% | 0.11 | 0 | $0.17 | $0.33 | 5.3 | 0/6 |

The core lock held: in all 12 dependent tasks the squash commit changed only the dependent's own files (`src/ledger.mjs` or `src/report.mjs` plus its test), never `src/store.mjs`, and no core patch was needed. The one rejection (sonnet worker, report totals) was a sound one: the commit duplicated `toCents` into report.mjs. It was fixed in one rework.

### Locked routing (user, 2026-10-13)

| role | light | standard | thorough | core |
|---|---|---|---|---|
| worker | haiku/high, escalate after 1 → sonnet | same | same | same (measured: 9/9) |
| tester | haiku/high | sonnet/medium | sonnet/medium | sonnet/medium |
| reviewer | sonnet/high | sonnet/high | opus/high (ADR 0016 deep tier, by diff) | sonnet/high; opus/high when a dependent touches the core (by diff) |

```json
{ "roles": {
  "worker":   { "tier": "haiku",  "effort": "high", "escalate": { "after": 1, "to": "sonnet" } },
  "tester":   { "tier": "sonnet", "effort": "medium", "byRisk": { "light": { "tier": "haiku", "effort": "high" } } },
  "reviewer": { "tier": "sonnet", "effort": "high" } } }
```
The thorough/core reviewer escalation to opus needs no config: `route()` sends the diff-thorough tier to `models.deep`.

**Caveats.** n is small: 6 runs per thorough cell, 2 thorough tasks, 1 core plan (3 runs per cell); opus workers were not measured. Hidden checks catch behaviour, not code quality. Light is easy for every cell. Main stalls must be fixed before rates below about 95% mean anything at scale.
