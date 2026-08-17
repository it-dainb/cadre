# cadre

A small trained core that directs a larger force.

cadre plans work, dispatches workers into isolated git worktrees, reviews what they produce, and merges. The lead never edits code — that is what keeps its context flat no matter how much the workers do.

**~783 tokens always-on.** Nine skills, four agents, four hooks, zero MCP servers.

## Why

Measured in a clean container, installed through the real CLI path, on
**oh-my-claudecode's** agents (the plugin cadre replaces) — same agent either
way, only the frontmatter differing:

| | |
|---|---|
| Subagent spawn, no `tools:` declared | **22,035 tokens** |
| Same agent, `tools:` scoped to what it uses | **9,482 tokens** |

cadre's own worker measures **7,632 tokens** to spawn. Reproduce any of these
with `harness/spawn-cost.sh`.

Omitting `tools:` from an agent means it inherits the *entire* tool pool, and every schema is rendered into its spawn prompt. A five-worker fan-out was paying ~110,000 tokens before any work began. That is the defect cadre is built around.

The second cost is quieter. `additionalContext` from `PostToolUse`, `PreToolUse`, `SessionStart` and `Stop` is written into transcript history — paid once, then re-read on every later turn. cadre ships **no** `PostToolUse` hook, and its gates deny rather than advise. A block changes behaviour at zero context cost; a nudge grows the transcript forever.

## Install

```bash
claude plugin marketplace add <path-or-repo>
claude plugin install cadre@cadre
/cadre setup
```

`setup` asks two questions and writes `.cadre/config.json`:

- **mode** — `adaptive` (default) gates when work turns large or destructive; `automatron` removes the human gate entirely.
- **threshold** — files a task may touch before the gate trips. Default 3.

Autonomy removes the *human*, never the reviewer. Self-review measures around 50% accuracy, so the review pass is what holds the accuracy floor when nobody is watching.

## The loop

```
intent → plan → [gate if large or destructive] → worker (worktree)
       → reviewer (read-only) → [gate] → merge
```

**Workers inherit nothing.** Not CLAUDE.md, not project rules, not the lead's conversation. `spec.md` plus the spawn prompt is the entire channel, so the spec is assembled once and the prompt points at it rather than repeating it.

**Blocked workers terminate.** A worker that cannot proceed writes `{"state":"blocked","question":"..."}` and stops. The lead answers and dispatches a *fresh* worker into the same worktree. Workers never prompt the user: they hold one slice of the plan, the lead holds all of it, and a new context window keeps a long clarification loop from accumulating.

**Workers do not dispatch workers.** Past depth 2 a subagent's completion notification routes to the root session and the intermediate parent waits forever. Coordination is through files and bounded polling.

## Gates

All `PreToolUse`. They deny; they never inject.

| Gate | Stops |
|---|---|
| absolute-path write | writes escaping the active worktree — `isolation: "worktree"` does not block these, measured |
| delegation depth | `Agent`/`Task` from inside a worktree |
| plan write | a `plan.md` whose `## Discovery` section is missing or under 100 characters |
| merge | merge, push, history rewrite, mass delete, dependency change, migration, or anything past the threshold |

## Budgets

From a checkout of this repo, `./harness/ci.sh` fails the build on regression; `--full` adds a fresh-install measurement. It runs in CI on every change to `cadre/`. The harness lives at the repo root and is not part of the installed plugin.

Every row must be demonstrably failable — break it on purpose before trusting it. The budget table is the acceptance test, and it is the only mechanism observed to resist re-bloat over time.

## Declined

`cadre/out-of-scope/` records what was turned down and why: external CLI workers, background task queues, journals, LLM self-review as a gate, MCP tools for memory. Every entry names its reason, so the same proposal does not arrive again as a fresh idea.

Design ported from [agent-hive](https://github.com/tctinh/agent-hive) (MIT + Commons Clause) — architecture only, code written from scratch.

## Status

1.0.0. What that does and does not mean here.

**Verified:** 118 tests, every module mutation-checked. The gates are proven live and *attributably* so — the absolute-path write is denied with cadre's own error text, and the same write succeeds once cadre is uninstalled. Always-on cost is measured from a fresh install that is asserted to be enabled before any number is read off it. Every CI budget row has been broken on purpose to confirm it fails.

**1.0.0 shipped broken and was fixed.** `plugin.json` re-declared `hooks/hooks.json`, which the CLI already loads by convention; the duplicate registration made the plugin report `failed to load`. Two checks now exist because neither did: `measure.sh` refuses to report tokens for a plugin that is not enabled, and CI fails a manifest that re-declares the auto-loaded hooks file. The earlier live-gate proof was also unattributable — its control tried to disable the gate by editing a cached copy that nothing executes.

**Not verified, and worth knowing before you rely on it:**

- **Windows.** The path handling is fixed and unit-tested, but only by simulating Windows-shaped paths on Linux. No Windows CI runner has ever executed this.
- **The merge gate end to end.** Covered at the hook contract; never exercised against a real `git merge` in a live session.
- **Write atomicity.** temp+rename is correct by construction, but proving it needs a process killed mid-write, which no test here does.
- **Capability.** Still unmeasured, and the first benchmark did not change that. Five tasks across three arms — plain Claude Code, Claude Code + oh-my-claudecode, Claude Code + cadre — all on Opus 5, one trial each, $6.56 total:

  | arm | solved | cost/task | vs plain |
  |---|---|---|---|
  | plain Claude Code | 5/5 | $0.179 | — |
  | oh-my-claudecode | 5/5 | $0.271 | +51% |
  | cadre, orchestration engaged | 5/5 | $0.701 | +291% |

  **Running cadre's loop costs about four times plain Claude Code and solves no more.** The plan → worktree → worker → reviewer → merge cycle carries a floor of roughly $0.50–0.80 per task no matter how small the task is, and no task here is large enough to earn that back. On the widest one — 28 mechanical edits — plain Claude Code wrote a script and finished for $0.22; cadre spent $0.70 doing it properly through the loop.

  An earlier version of this section reported cadre at parity with plain. That measurement was of a plugin that was installed and never invoked: with a plain prompt, 8 of 10 runs never spawned a worker or wrote any `.cadre/` state. The arm was plain Claude Code plus the always-on tax. Skills are description-triggered, and in headless mode nothing triggered them — the runs now invoke `/cadre:work` explicitly and assert that state was written.

  The always-on saving (~781 tok vs ~3,169) is real and cheap to keep. It is also, on this evidence, the only cost advantage cadre currently has, and it is small enough that per-task spend buries it.

  An earlier version of this table reported cadre 27% cheaper. It was wrong twice over. The runner invoked its checker with `docker exec` and no `-i`, so the check read an empty script and exited 0 — every task "passed" without ever being verified. And cadre's apparent win was its merge gate halting on the word "migration" and never doing the work, because the gate matched the bare substring and a task file was called `migrate.mjs`. The cheapest run is always the one that does nothing. The gate now matches schema-migration tooling (`db:migrate`, `prisma migrate`, `alembic upgrade`, and similar) rather than the word; the runner copies the checker in and, on every run, re-runs it against a pristine copy of the task and fails the run if that passes.

  All five tasks pass in all three arms, so nothing here separates them on capability. Two tasks were built to punish a symptom-level fix and one to punish missing 1 of 28 mechanical edits — all verified to fail in exactly that near-miss state — and Opus 5 still solved every one unaided. A benchmark where nothing ever fails is measuring its task set. Reproduce with `harness/bench/run.sh`.

  `.omc/research/bench-landscape.md` explains why SWE-bench Verified cannot answer the capability question (saturated, contaminated) and why Terminal-Bench 2.0 can; `.omc/research/bench-tb2-setup.md` has the setup, including the adapter subclass needed to get a plugin into its task containers.

The design was audited by four independent reviewers against the spec, the plans, the Claude Code research and the prior art it borrows from. They found three blockers, two critical gate bypasses and several fail-open defects that a green test suite had not caught. Those are fixed. The audit is why this is 1.0.0 and not 0.1.0 — not the test count.
