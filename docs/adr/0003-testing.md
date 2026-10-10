# ADR 0003: Testing strategy

Status: accepted · Date: 2026-10-10 · Design: `design/DESIGN.md` v2.5 §14

## Context
The mod kit cannot run processes (KIT:21) and has no fs, `$.state` or timers in tests. cadre needs real git, a real beads store, adapter processes and live Claude behaviour checked.

## Decision
| Layer | Where | Run with |
|---|---|---|
| Pure units, goldens, hook chain, init stages, UI/budget | `tests/*.test.ts`, `tests/fixtures/*`, `tests/support.ts` (`fakeHost`) | `claude plugin test .` (kit; stubs for `process.run`, `fs.*`, `store.*`, `settings.read`; `mock.clock`) |
| Real git (squash, `--no-ff`, release cut, effect restore, tdd gates) | `tests/git/*.test.mjs` over pure `core/git` helpers | `node --experimental-transform-types --test tests/git/*.mjs` |
| Adapter protocol vs the fake adapter (real spawns) | `tests/protocol/*.test.mjs`, `task-management/adapters/fake` | `node --experimental-transform-types --test tests/protocol/*.mjs` |
| Store contract vs real bd | `tests/store-contract.ts` via `tests/dev/beads-real.mjs` (`RECORD=1` re-records `tests/fixtures/bd/contract.ts`) | `node --experimental-transform-types --import ./tests/dev/register.mjs tests/dev/beads-real.mjs` |
| Budget | `scripts/budget.mjs` (core ≤ 5,000 LOC, `ui/` ≤ 750, 3 MCP tools, 0 skills, `.catch` on every gating hook) | `node scripts/budget.mjs` (regenerates `tests/fixtures/budget.generated.ts`) |
| Live smoke S01–S61 | `tests/smoke/S*.md` (one file each: purpose, assumption, steps, expected, M0 status) | `harness/run.sh` (Docker) |
| Real model | `evals/<case>/` (`case.yaml`, `prompt.md`, `graders/`, `scaffold.sh`) | `claude plugin eval . --scaffold --trust-plugin --allow-tools Bash Edit Write "mcp__*"` inside the harness |

Gate before every commit: `node scripts/budget.mjs` → `claude plugin validate --strict .` → `claude plugin test .` (pin `2.1.295`).

## Rules
- Live Claude runs (smokes, evals) go through `harness/run.sh` only. The container needs `seccomp`, `apparmor` and `systempaths` unconfined for bubblewrap (ADR 0001).
- Evals seed an approved plan `p-p1` via `bd` in `scaffold.sh` (approval is kit-only) on `evals/fixtures/{ts,py,rust,go}` with a validated `.cadre/config.json`, `git init`, `dev`, and `epic/p-p1-slug-length-cap`. Cases: `fix-bug-main-never-edits` (a), `execute-p1-{ts,py,rust,go}` (b), `auto-report` (c), `review-resumes-same-agent` (d). The band reads `degraded` in the harness sandbox; evals assert L1/L3/flow.
- Deterministic graders for mechanism (`tool_used`), `llm` graders on the trace only where text must be judged.
- No `test.skip`, stub tests or placeholders; PENDING-HUMAN smokes are recorded as such in their smoke file and ADR 0001.

## Consequences
- Go and Rust fixtures cannot run on a host without those toolchains; they run in the harness image.
- Subagent tool calls may appear in the eval trace: (a) is safe because no plan is approved, so no worker spawns; (b)–(d) do not assert main-only tool absence.
