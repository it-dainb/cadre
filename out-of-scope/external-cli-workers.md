# external-cli-workers — declined

Dispatching codex / gemini / antigravity workers alongside native subagents.

**Why not.** ~28,500 LOC of tmux and CLI-worker orchestration, and none of it benefits from the mechanisms that make cadre cheap: no per-role `tools:` scoping, no worktree isolation, no budgeted prompts. A second failure surface for capability the native Agent tool already provides.

Dropped at interview Round 0.
