---
name: hud
description: Show what cadre currently has in flight — active task, its state, configured mode and threshold. Use to orient at the start of a session or after a break.
---

# hud

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" status
```

One call instead of three file reads. It returns:

- `task` — the active task, or `null` if idle
- `status` — `in_progress`, `blocked`, `completed` or `cancelled`, and the question if blocked
- `config` — mode and threshold

Report it in a few lines. This is a read; it changes nothing.

If a task is `blocked`, the question is the useful part — surface it, then answer it or ask the user, and dispatch a fresh worker to resume.
