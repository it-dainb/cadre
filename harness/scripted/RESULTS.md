# S0: scripted model (2026-10-14, Claude Code 2.1.295 and 2.1.299, haiku)

A harness-only mod (`hooks/register.ts`) answers every model request at `turn.step` (TM-04) without calling `next`: text, tool and input chunks,
then a stop chunk with a made-up usage (`model: scripted`, 7 in / 3 out = 22 token-equivalents a step). Each answer is a function of the loop's
transcript (`$.session.messages`, rows carry `toolUses[].tool`), never of a counter. `run.sh` drives it through the unchanged harness:
- `run.sh plan`: `cell.sh <name> "single ready" goal` with `LANDED=1`, cadre plus the scripted mod as a second `--plugin-dir` (after cadre's).
- `run.sh probe`: the scripted mod alone; `/s0 end|hb|wedge` spawns a `general-purpose` agent with `$.agent.spawn` from a `command.run` frame
  (cadre's spawner makes the same call) whose turn is scripted: `end` = text + `end_turn`, `hb` = text + a `SubagentHandback` chunk,
  `wedge` = a Bash call that never returns; 20 s later a `$.clock.after` timer calls `$.tool.call({ tool: 'TaskStop', task_id: agentId })`.

Zero quota: `PROXY=1` with `stub-proxy.mjs` in place of the effort proxy (same port and log, in the plugged copy only). It answers the named
request kinds that bypass `turn.step` (logged to `stubbed.jsonl`) and **refuses** any other `/v1/messages` request with a 500, logging its shape to
`effort.jsonl`: a missed kind costs nothing and still shows. Haiku everywhere by the harness pins (H0, `tui.sh`),
cadre routes pinned to haiku by `tui.sh pins`; `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`.

## Verdicts

| exit | verdict | evidence |
|---|---|---|
| (a) a `single` plan lands, zero quota | **met** | `run.sh plan`: goal → explorer → clarity → lite plan p-vea → approved → worker → reviewer → merged to dev → release v0.1.0 in 92 s; oracle PASS (1 dialog, 2 main turns, usd 0). `effort.jsonl` never created (0 bytes); stubbed: 1 `quota_check`. Debug log: one `[API REQUEST]` in the whole run, `source=quota_check` (stubbed); 15 × `turn.step: a hook answered without the request` |
| (b) the scripted mod is inner to cadre; children scripted | **met** | Debug: `hooks module cadre@inline, scripted@inline turn.step stream settled` (outer first) on every step, and `scripted (user) answered turn.step without next()`. cadre's step ran above it and read its result: task p-vea.1 `cadre.cost` = `{"tokens":154}` = 7 scripted steps × 22 (worker 4 + reviewer 3); the worker and reviewer steps arrive with `effort=high`, cadre's routed effort rewritten on the way down. Every child (explorer, worker, reviewer) answered by the fixture (`SCRIPTED step agent=<id> who=<role>`), none reached the proxy |
| (c) forced-exit forms, 2.1.295 and 2.1.299 | **met, form depends on the mode** | identical on both builds. **bypassPermissions**: text + `end_turn` ends the run at once (`turn.complete reason=answer`, 1 step); the `SubagentHandback` chunk is rejected (`No such tool available: SubagentHandback`, the tool exists in auto mode only). **auto**: the `SubagentHandback` chunk ends the run at once (1 step, `reason=answer`); text + `end_turn` is re-asked 3 times (`[handback-send-enforce] Your report has not been delivered…`) and then the run ends (`reason=answer`, 4 steps) |
| (d) TaskStop from a timer frame, auto and yolo | **met** | both modes, both builds: `{"message":"Successfully stopped task: <agentId> (s0 wedge)","task_type":"local_agent"}` → the wedged agent's `turn.complete reason=aborted`. The agentId is accepted as `task_id` (AG-29's open point, for a `$.agent.spawn` agent). `tool_dispatch_start tool=TaskStop … permissionDecisionMs=2`: no dialog (no `Do you want to` in the pane), no auto-mode classifier call. On an agent that already ended: an error result (`Task <id> is not running (status: completed)`), nothing else |

No fallback is needed: (a)–(b) keep the in-harness mod (no stub endpoint), (c) E ships forced exit on, (d) the backstop uses TaskStop.

## For slice E
- Forced exit form: in auto mode answer with text + a `SubagentHandback` chunk (`{"message": …}`); in every other mode text + `end_turn`. Text + `end_turn`
  alone also ends an auto-mode run, after 3 enforce re-asks (3 more `turn.step`s for the forced exit to answer, zero tokens).
- The handback chunk goes through cadre's own `tool.call` guard (`policy/guards.ts` `handback`): it passes once the agent called report, else it is
  refused up to `RETRIES` times. A forced exit on a spent budget (no report) must mark the agent handed first.
- The probe's TaskStop came from another plugin's timer. From cadre's own timer cadre's hooks are skipped (G6); from another plugin, cadre's main
  allowlist (`MAIN_TOOLS`, no TaskStop) would refuse it, so the probe ran without cadre.

## Requests that bypass `turn.step` (named; each run's log after the fix is empty)
| kind | what | handled |
|---|---|---|
| `quota_check` | startup probe, `max_tokens` 1, one user message `quota` | stubbed (one `.` answer) |
| `auto_mode_classifier` | auto mode's permission classifier (`source=side_query`, stage `xml_s1`, sonnet, ~138k chars of system prompt), one per classified tool call (`SubagentHandback`, `Bash`; not `TaskStop` or a plugin's `Agent`) | stubbed: `<block>no</block><severity>0</severity>` = allow, so a scripted run never sees a classifier refusal |
| `prompt_suggestion` | after a main turn, a fork of main's request (170 tools, streamed) | off: `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` (the proxy refused 33 of them in the run before) |

| `agent_summary` | the progress line of a background agent running > ~30 s: a fork of its transcript, streamed, asking to "Describe your most recent action in 3-5 words" (first seen in the dev-moved cell) | stubbed (streamed `Working on the task`) |
| `usage_limit` | not a leak: the usage-limit cell's scripted worker sends one request on purpose; while `<log dir>/limit` exists the proxy answers it with a 429 and the unified rate-limit headers | injected |

The rest of that side-query family (`away_summary`, `hook_prompt`) has not occurred; the proxy refuses any unstubbed request (500, logged with its shape and which known phrases its body holds, never the body), so a new kind costs nothing and shows in `effort.jsonl`.

Spend: before the refusing proxy, 5 requests reached the API: 1 `quota_check` (haiku, 1 output token) and 4 `auto_mode_classifier` (sonnet,
64 output tokens, ~35k input tokens each) in the first two auto probes; under US$0.5 at list price. Every later run: none.

## Runs (evidence in `harness/out/scripted/<name>/`, gitignored)
| run | build | mode | effort.jsonl | stubbed |
|---|---|---|---|---|
| probe-295-yolo | 2.1.295 | bypassPermissions | 0 | quota_check 1 |
| probe-295-auto | 2.1.295 | auto | 0 | quota_check 1, auto_mode_classifier 2 |
| probe-299-bypassPermissions | 2.1.299 | bypassPermissions | 0 | quota_check 1 |
| probe-299-auto | 2.1.299 | auto | 0 | quota_check 1, auto_mode_classifier 2 |
| plan-295 | 2.1.295 | bypassPermissions | 0 | quota_check 1 |
