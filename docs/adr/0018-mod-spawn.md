# 0018: cadre starts the task agents itself ($.agent.spawn)

Status: accepted behind `drive.spawn` (default `main` until the gates below are met; see "Default").

## Decision

While drive runs a plan, cadre starts every task agent itself with `$.agent.spawn`, closes a task once its review passes, and completes a done
epic, milestone or plan. Main is out of the per-step loop: it plans, talks to the user, and hears one line per landing on its next turn.
`drive.spawn: 'mod' | 'main'` (user config, default `main`); the env `CADRE_SPAWN=mod|main` beats it; a non-interactive session runs `main`.

Why: in main mode every step is a main turn (`Continue: spawn TASK-x`), and each main turn re-reads ~100k of context. The bench put most of a
landed task's cost on main, and it found main stalls (main messaged a finished tester instead of spawning the worker). Shorter relay prompts
were rejected: still a full main read per step.

## Evidence (probe, `harness/probes/spawn/RESULTS.md`, Claude Code 2.1.295)

A standalone plugin: one `turn.complete` registration S spawns; others only observe or guard.

| probe | interactive (tui) | headless `-p` one-shot | headless `--input-format stream-json` |
|---|---|---|---|
| guards (`tool.call`) fire on the child, a deny holds | yes | yes | yes |
| the report tool is handled; `turn.step` fires in the child | yes | yes | yes |
| the `agent.spawn` chain (minus S) sees the spawn; a cwd rewrite holds | yes | yes | yes |
| S sees the child's `turn.complete` and spawns the next; that child is guarded | yes (not nested, no frame build-up) | **no**: -p exits once no background agent is left, before the child's turn-end hooks | yes |
| `command.run` can spawn | yes | — | — |
| main gets a task-notification turn | no (claimed by the waiter) | no | no |

`classic.SubagentStop` fires before the task ends but IS nested and the origin accumulates (`origin probe#2 > probe#8`): the spawner never sees
its own child's stop, so it cannot chain. `$.agent.spawn` also raises a `tool.call` `Agent` with no `agentId` and a `toolu_plugin_…` id.

## The re-entry rule (hard)

A `$` call made outside a hook (timer, ui handler, module top level) has the bare plugin as origin: EVERY cadre hook is left out for everything
it causes, so an agent spawned there runs unguarded and its report is never handled. A call from registration #k leaves #k out for events
nested under it. Therefore:
- the spawn is made only from a frame whose event no agent raises inside its own run: `turn.complete` (a subagent's is not nested, probed) and
  `command.run` (typed `/cadre`);
- `hooks/register.ts` builds a host with `spawnAgent` only through `spawner($, next)`, which throws for any other `next.event`; `spawnStep`
  refuses a host without it or another event;
- `tests/git/spawn.test.mjs` lints it: `$.agent.spawn(` appears once (in `spawner`), `spawner($` is called only on a `turn.complete` /
  `command.run` registration, no timer line spawns, nothing else touches `spawnAgent`.

The spawner registration is the outermost `turn.complete`, so its work runs after observe/drain (the board already holds the report).

## What main is told

- After approval: `Plan <id> is approved. Its tasks start, get reviewed and land by themselves; you hear one line as each lands. Nothing to do
  now: tell the user it is running and stop.` (a milestone: plan each epic when the next: line names it).
- Its context line's `next:` names only main's own steps (plan an epic; yolo: decide a blocked task), else
  `wait: the tasks run by themselves and you hear when each lands, so talk with the user or plan what is next`.
- One digest line per landing as context on its next prompt (`Landed since your last turn: …`), never a turn of its own.
- A task-notification of an agent the spawner started is dropped (`{drop}`); main's own explorers keep theirs.
- Main's own Agent call naming a task while mod drive runs is denied: `<id> starts by itself; do not spawn agents for the plan's tasks. An Agent
  without a task id (to explore or ask) is fine`. The spawner's call is told apart by `next.origin.plugin === 'cadre'`.
- What is main's own (plan the next epic, a yolo blocked question) goes out once from the spawner's turn end (`drive(quiet)`: never the same text twice).

## Lifecycle

approve → `arm` (also sets `board.drive.spawn`) → the approval brief gives main one short turn → its turn end → the spawner:
`ready()` (landed / lease / hard stops / gate) → `land()` (close each review✓ task, actor `mod`; complete a done epic, the milestone, the plan) →
`spawnable(board, bindings)` within `maxParallel` → `tally(n)` → `$.agent.spawn({prompt: "TASK-x"})` → admission claims / rebinds / reviews as before.
Each agent's turn end runs the spawner again. Rework, escalation, effort, nudges and auto-reports are unchanged (`observe`, `drain`, `turn.step`).

## Failure modes

| case | handling |
|---|---|
| a spawn throws (admission undid the claim) | `cadre.attempts`+1; the third failed start stops the run for the human |
| a spawn is denied (gate, a live lease elsewhere) | logged; the gate or the next turn end deals with it |
| double spawn | per-task in-flight key in the spawner; admission's CAS (claim, `~id` reservation); the drive lease across sessions |
| two turn ends close at once | one close at a time per session (`landing`) |
| a sweep looks while a close moves the epic ref | the audit judges nothing when a cadre git op ran during its look (found live; `core/effect.audit`) |
| `$.process.run` in a reviewer's turn-end frame after its worktree is removed | the host's `run` defaults `cwd` to the repo root (found live: posix_spawn ENOENT) |
| a dialog answer / press with nothing running (no frame to spawn from) | idle fallback: one short main turn (`IDLE`), whose end lets the spawner go; a typed `/cadre` never queues it (its frame spawns) |
| a stall (agent died without a turn end, lease lapsed, a resume nobody sent) | the 5 s timer's `watchdog`: the idle fallback after 2 min with no spawner step, counted as a turn; the no-progress bound ends a loop. Its window starts at the last sign of life (found live: the first look fired during main's approval turn) |
| a close sends the worker back (conflict / red on the plan tip) | the rework resume is queued after this turn end's drain ran: the spawner sends this session's queued resumes itself (found live: the worker waited for good) |
| a quit while the spawner starts an agent | a quit under way starts nothing (`session.life.ending`); admission records the owner before the spawn, so a claim left by a dying session reads as gone (found in the quick matrix: continue-after-quit) |
| a verdict mid-write when another turn end looks | skipped quietly; the reviewer's own turn end lands it |
| an agent dies on a full usage window | not an attempt: task released, drive paused until the reset (`ui.limit`), the watchdog kicks after it |
| bounds | spawns count as drive turns; `noProgressTurns` counts spawner steps without a transition |
| session end | agents die; stale leases → `/cadre continue` (a command frame) respawns at once |
| one-shot `-p` | main mode (exits before an agent's turn end could spawn); `CADRE_SPAWN=mod` with stream-json stdin works |

## Default

`main` until: kit/git gates green, `SPIKE=<branch> harness/matrix.sh quick` 7/7, a mod-mode cell landing with no main stall, and a bench smoke
(main $ per landed task and main's share, before/after on the same grid). Success: main share < 25 %, no main-stall cells, the oracle's
token-leak/guard checks clean. Results below.

## Results

(filled at the flip)
