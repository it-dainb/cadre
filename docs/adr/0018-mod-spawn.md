# 0018: cadre starts the task agents itself ($.agent.spawn)

Status: accepted; `drive.spawn` defaults to `mod` since the gates below were met (see "Default" and "Results").

## Decision

While drive runs a plan, cadre starts every task agent itself with `$.agent.spawn`, closes a task once its review passes, and completes a done
epic, milestone or plan. Main is out of the per-step loop: it plans, talks to the user, and hears one line per landing on its next turn.
`drive.spawn: 'mod' | 'main'` (user config, default `mod`); the env `CADRE_SPAWN=mod|main` beats it; a non-interactive session runs `main`.

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

Flipped to `mod` (9918502) once these held: kit/git gates green, `SPIKE=<branch> harness/matrix.sh quick` 7/7, a mod-mode cell landing with no main stall, and a bench smoke
(main $ per landed task and main's share, before/after on the same grid). Success: main share < 25 %, no main-stall cells, the oracle's
token-leak/guard checks clean. Results below.

## Results

### Bench smoke (2026-10-13, `harness/probes/spawn/smoke.sh`, plugin ae06e6b, main sonnet, worker haiku·high, tester sonnet·medium, reviewer sonnet·high)

Each run is one pre-approved bench plan (`harness/bench/scaffold.mjs`) judged by `harness/bench/bench.mjs judge` (landed = closed and the hidden
check passes; cost from every transcript at the 5.5 prices). main = the bench's own way (`-p`, main spawns every step in the foreground);
mod = stream-json stdin held open, the user types `/cadre continue` (a command frame: drive arms and cadre starts the agents).

| task | mode | landed | main $ | roles $ | total $ | main share | s |
|---|---|---|---|---|---|---|---|
| l1-slug-max | main | 1/1 | 0.2109 | 0.0909 | 0.3017 | 70 % | 112 |
| l1-slug-max | mod | 1/1 | 0 | 0.1006 | 0.1006 | 0 % | 121 |
| l2-title-case | main | 1/1 | 0.2083 | 0.0998 | 0.3081 | 68 % | 127 |
| l2-title-case | mod | 1/1 | 0 | 0.0819 | 0.0819 | 0 % | 126 |
| s2-transfer | main | 1/1 | 0.2265 | 0.1316 | 0.3580 | 63 % | 134 |
| s2-transfer | mod | 1/1 | 0 | 0.1292 | 0.1292 | 0 % | 141 |

Main $ per landed task: $0.215 → $0 while the plan runs; total per landed task $0.32 → $0.10 (−68 %); wall time the same. Interactively main still
takes one short turn per approval (it tells the user the plan runs: about one context read, $0.06 at 166k cached tokens in the first smoke, which
had that turn by mistake) and reads the digest on its next turn; spread over a plan's tasks that keeps main's share under 25 % for plans of 3+
light tasks and stays far below main mode's ~70 % for any size. The bench's own stdin change (a grid in both modes) is queued with the bench
worker for after its focus pass.

### Live cells (tui, sonnet, `single ready` + goal, LANDED=1)

- mod1–mod3 (CADRE_SPAWN=mod) found and fixed, each with a test: the sweep racing a close; `$.process.run` in a removed worktree; the rework resume
  nobody sent; the watchdog firing during main's approval turn (see Failure modes). mod3 landed on dev 1 min after approval (worker, reviewer).
- No main stall: in mod1 the tester of p-xy2.2 finished and cadre itself started its worker (`$.agent.spawn (cadre)` … `worker p-xy2.2`); main's
  transcript after approval holds only the approval briefs, no SendMessage and no spawn. The bench's stall (main messaging a finished tester instead
  of spawning the worker) cannot happen: main is not in that loop.
- The planning-phase goal-stop check is kept as it was (it refuses main's stop before a plan exists); after approval main's early stop no longer
  matters, since nothing waits on it.

### Matrix quick

- `CADRE_SPAWN=mod` on cc44c4a: 6/7. continue-after-quit failed: the quit hit while admission was claiming for the spawner (owner written too late)
  and the status line said "press 1" on the containment state (no dialog behind it; main idles at once in mod mode). Both fixed (b453d6f);
  continue-after-quit then PASSED (landed in 3 min, $1.87).
- On the flip commit 9918502 (default `mod`, no override), `harness/matrix.sh quick -j 3`, then the one flake rerun alone:

| cell | verdict | failing invariant | s to plan | dialogs | turns | US$ | min |
|---|---|---|---|---|---|---|---|
| continue-after-quit | PASS | | 52 | 1 | 1 | 1.34 | 3 |
| kill-mid-setup | FAIL → PASS on rerun | restart-named (layout flake) | 124 / 112 | 3 | 3 | 1.10 / 1.07 | 2 |
| leftover-pointer | PASS | | 49 | 1 | 1 | 0.20 | 1 |
| single-295-sonnet | PASS | | 88 | 3 | 2 | 1.23 | 2 |
| single-via-ccr | PASS | | 105 | 3 | 2 | 0.29 | 2 |
| user1-mono-clear-cd-retype | PASS | | 111 | 3 | 4 | 3.07 | 2 |
| user2-nogit-lazy-interrupt | PASS | | 98 | 3 | 3 | 2.60 | 2 |

  total $9.83 + $1.07. kill-mid-setup's first run: the `/cadre` answer was right ("Setup was interrupted · /cadre …") but the docked pane wrapped it
  over two lines and the oracle's one-line pattern missed it (setup phase, no drive: the spawner is not involved); it passed alone. No token-leak,
  error or refusal-loop invariant failed in any cell.
