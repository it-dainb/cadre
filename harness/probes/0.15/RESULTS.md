# 0.15 probes: tool surface under the settings gate (2026-10-16, Claude Code 2.1.295 and 2.1.299, haiku, scripted)

Zero quota: `harness/scripted/run.sh probe <name> "tools main-agent"` with `SETTINGS=<json>` written to the work dir's
`.claude/settings.local.json` before Claude Code starts (bypassPermissions, `PROXY=1`, stub proxy). `/s0 tools` (a `command.run` frame of the
scripted mod, no cadre loaded) logs `$.tool.list()` names matching `Task*|Todo*|Agent`, runs the hard-link check in `/work/run/.cadre/state`, spawns a
`general-purpose` agent with `$.agent.spawn` (cadre's spawner makes the same call) whose scripted turn is a Bash call that never returns, and 20 s later
calls `$.tool.call({ tool: 'TaskStop', task_id })` from a `$.clock.after` timer. The prompt `S0-PROBE main-agent` makes main's scripted model call
`Agent` once. Every run: `effort.jsonl` 0 bytes.

| cell | settings.local | `$.tool.list()` (Task/Todo/Agent) | `$.agent.spawn` | TaskStop (timer) | main's `Agent` call |
|---|---|---|---|---|---|
| P0 | none | `Agent, TaskStop` | agent id | `Successfully stopped task`, agent `turn.complete reason=aborted` | (not run) |
| control | env `ENABLE_TODO_TOOLS=1` (0.14's) | `Agent, TaskCreate, TaskGet, TaskList, TaskStop, TaskUpdate` | agent id | stopped, `reason=aborted` | (not run) |
| P1 | env `ENABLE_TASKS=false`, `ENABLE_TODO_TOOLS=1` | `Agent, TaskStop, TodoWrite` | agent id | stopped, `reason=aborted` | runs: child `turn.complete reason=answer` |
| P2 | P1 + `permissions.deny ["Agent"]` | `TaskStop, TodoWrite` | **throws** `$.tool.call: no tool named "Agent" in this session` | nothing to stop | refused: `No such tool available: Agent. Agent is disabled for this session, in subagents as well as here.` |

Identical on 2.1.295 and 2.1.299.

## Verdicts
- **Env gate (P1): holds.** `CLAUDE_CODE_ENABLE_TASKS="false"` (string, from settings.local `env`) removes TaskCreate/Get/List/Update; with
  `ENABLE_TODO_TOOLS=1` TodoWrite is listed. TaskStop stays in both cells (it is not one of the task-list tools), and ends a `$.agent.spawn` agent
  from a timer frame under the gate.
- **Bare `deny ["Agent"]` (P2): blocks cadre.** The deny removes the Agent tool from the session, and `$.agent.spawn` goes through it: the spawn
  throws, so no worker, reviewer or explorer could start. The engine's own wording says subagents lose it too. TaskStop is still listed but has
  nothing to stop. **Open issue 1 is decided: no `deny` in settings.local; use the fallback, a `tool.call` deny of `Agent` for main only** (refuse
  when `!e.agentId`; cadre's `$.agent.spawn` calls come from its own frames and are not main's tool calls).
- **Hard links in `.cadre/state` (inside the container, ext4 bind mount): work.** `ln t.1 j.1` + `sync j.1` succeed; a second `ln t.2 j.1` is
  refused (EEXIST: the commit CAS holds); link count 2; `j.1 -ef t.1` true; content is the first writer's.

## For slices 3a/3b
- 3b init's `SANDBOX` writes the two env flags only, never `permissions.deny`. The S1 gate keys are `env.CLAUDE_CODE_ENABLE_TASKS` and
  `env.CLAUDE_CODE_ENABLE_TODO_TOOLS`; "Agent deny" in the Doctor crit row and toast becomes the guard's job, not a settings key.
- 3a/3b `policy/guards.ts` (or the `tool.call` gate): refuse `Agent` when there is no `e.agentId` with "use plan/task/explore"; a probe of
  `mcp__cadre__explore` replaces main's Agent. This also keeps non-cadre sessions in the repo able to use Agent (narrower than the settings deny).
- TaskStop needs no change: listed and working under the gate. The "Task* visible at start" crit checks TaskCreate/Get/List/Update, not TaskStop.
- `$.tool.list()` at `session.start` is a reliable check for the gate (Task* absent, TodoWrite present).

## Stub proxy
A typed prompt (`S0-PROBE main-agent`, the first non-command input) triggers one `generate_session_title` request (streamed, one user message
`<session> … </session>`, JSON output with a `"title"` field), which the first runs refused (effort.jsonl non-empty; the 500 cost nothing). Now a
named kind, `session_title`, answered `{"title":"Scripted session"}`; every later run logged it in `stubbed.jsonl` and left effort.jsonl empty.

## Runs (evidence in `harness/out/scripted/<name>/`, gitignored)
| run | build | effort.jsonl | stubbed |
|---|---|---|---|
| w15-p0-295 | 2.1.295 | 0 | quota_check 1 |
| w15-pc-295, w15-pc-299 | 2.1.295, 2.1.299 | 0 | quota_check 1 |
| w15-p1-295, w15-p1-299 | 2.1.295, 2.1.299 | 0 | quota_check 1, session_title 1 |
| w15-p2-295, w15-p2-299 | 2.1.295, 2.1.299 | 0 | quota_check 1, session_title 1 |
