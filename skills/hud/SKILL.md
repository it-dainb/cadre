---
name: hud
description: Show what cadre currently has in flight — active task, its state, configured mode and threshold. Use to orient at the start of a session or after a break.
---

# hud

Read and report:

- `.cadre/active-task` — the current task, or nothing if idle
- that task's `status.json` — `in_progress`, `blocked`, `completed` or `cancelled`, and the question if blocked
- `.cadre/config.json` — mode and threshold

Report it in a few lines. This is a read; it changes nothing.

If a task is `blocked`, the question is the useful part — surface it, then answer it or ask the user, and dispatch a fresh worker to resume.
