---
name: cancel
description: Stop the active task cleanly — record a terminal state, clear the pointer, release locks, and remove the worktree. Use when abandoning work rather than finishing it.
---

# cancel

1. `cancelTask()` records `state: cancelled`, clears `.cadre/active-task`, and deletes lock files directly rather than waiting out their 30-second TTL.
2. It returns the worktree to remove. Do that yourself with `git worktree remove` — git operations stay with the caller so the state module remains pure.

The task record is kept, not deleted. The worktree may still hold work worth recovering, and a deleted task looks identical to one that never ran.
