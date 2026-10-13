# $.agent.spawn probe (2026-10-13, Claude Code 2.1.295, haiku)

A standalone plugin (`hooks/register.ts`): S (a turn.complete registration) spawns g1 at main's turn end and g2 at g1's turn end; C (/probe, command.run) spawns g3.
Other registrations only observe: A (turn.complete), X (agent.spawn, rewrites cwd to sub/), G (tool.call guard, denies `forbidden`), R (the report tool), T (turn.step), P (prompt.submit).

Interactive (`harness/tui.sh`, SPIKE=a git copy of this dir), every probe passed:
- X saw each spawn (agent.spawn chain minus S) and its cwd rewrite held (`probe-g*.txt` in `sub/`).
- G fired on every child tool call and its deny held ("refused by the probe guard"); T fired on every child step; R handled every report.
- S saw g1's turn.complete and spawned g2; g2 was still fully guarded (`nested in probe#2`, nothing left out). The child's turn.complete is not nested in the
  spawner's origin: S saw g2's too, so the turn.complete chain does not accumulate frames.
- C (/probe, command.run) spawned g3, guarded the same.
- main's transcript: only the human prompt and its answer. No task-notification turn, no prompt.submit with origin task-notification.
- `$.agent.spawn` raises a `tool.call` for `Agent` WITHOUT agentId (looks like main's) with a `toolu_plugin_…` id: main-side guards must let it through.

Headless one-shot (`claude -p "…"`): FAILED for chaining. g1 ran (guarded, reported, permission fine under bypassPermissions), but -p exits as soon as the
background task list is empty, which happens BEFORE the child's turn.complete hooks run: S logged g1's turn.complete and the process exited mid-spawn.
- Variant: chain from classic.SubagentStop (fires before the task ends): g2 spawned, but SubagentStop IS nested and the origin accumulates
  (`classic.SubagentStop skipped: re-entry (origin probe#2 > probe#8)`): the spawner never sees its own child's stop, so the chain dies at depth 2.
- Headless with `--input-format stream-json` and stdin kept open: the turn.complete chain works (g1 -> g2), as interactive.
