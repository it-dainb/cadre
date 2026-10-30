# Out of scope and known limitations

## Out of scope (v1)
| Item | Why | Ever? |
|---|---|---|
| Parsing shell command text or stderr; deny lists of channels | Brittle; layers decide on effects, not text | never |
| Language/ecosystem presets in code | Stack specifics are discovered and validated config | never |
| Magic keywords, Stop-hook loops, `/goal`, statusLine HUD command, skills | One loop authority | never |
| Op-log sync queue | Sync is state-based reconciliation | never |
| Pane teammates, agent teams, workflow agents | Unseen or rewrite-proof | roadmap (in-process teammates) |
| Creating remote projects or custom fields | Admin actions; setup maps to what exists | roadmap flag |
| Everything on the DESIGN §15 roadmap line | Budget, YAGNI | roadmap |

cadre stops **model drift**, not the user: a user-tier mod can be switched off. It never pushes.

## Known limitations
From the M0 spike ([ADR 0001](docs/adr/0001-m0-results.md)):
- **PENDING-HUMAN smokes** (need an interactive TUI): S22 (background workers across `/clear`), S37 (`!` raises no `tool.call`), S48 interactive `/goal`, S49 trigger (`$.session.compact()` is unavailable headless, so the 60 % context hint is a toast, not an automatic compact). S41's MCP grant is rechecked at M3.
- **A restored `/goal` is undetectable** (S48, A27). After `/resume` with drive on, a one-time band hint appears. Do not combine a restored `/goal` with `/cadre drive on`: two loops would run. `/goal` typed in the session is observed as prompt text and pauses drive.
- **No bwrap overlay** (needs ≥ 0.11; hosts have 0.8/0.9). Checks run in a **copy-jail**: a throwaway copy of the worktree, writable, network off. The cache audit uses an empty scratch `HOME` listing.
- **bd 1.3.1 has no `--if-revision`.** Drive and sync leases live as metadata on the `cadre-control` issue, with read-check-write-reread (guarded by `--if-assignee/--if-status`). Drive continues after `/clear` (DESIGN §9).
- **Tester has Read/Write/Edit only** (this build exposes no Grep/Glob, S45); briefs name the paths. Plan B (ADR 0004) is not needed.
- **Headless (`-p`) runs end with main's turn** (a background agent is killed): spawn agents in the foreground. `plugin eval --allow-tools` refuses `mcp__*`: name `mcp__cadre__report mcp__cadre__inspect mcp__cadre__run_check`. Live results: [ADR 0005](docs/adr/0005-live-results.md).
- **`!` shell commands** in a human session may bypass the hooks (A20 unverified); the effect check treats such changes as human.
- **A stale explore intent can hold a goal stop.** A question queued for an explorer that never started stays queued, and the goal stop waits on it. No run has shown it fail, so it is a known limit, not a fix.
- **`human.retry` resets the rework count** (`core/lifecycle.reset`), so a task the human retried can read as first-try in the `/cadre timeline` metrics. A retry is itself a rework signal; no second counter is kept. Metrics history starts at 1.0 (no backfill); a task's start time is its first metered usage (run records carry no time).
- Per-repo state: the mod's policy (repo, worktree root, locks) is keyed per repo, so two repos in one user config do not share it.
- Workers cannot `git add/commit` (repo-level `denyWrite`, S24): the mod commits. `/tmp` is not writable for subagents; use `$TMPDIR`.
- Per-agent 1 h cache TTL needs plugin agent files and may be ignored on accounts without usage credits; cadre reads the usage fields to detect it.
- **Linux only.** On another OS (`uname -s` is not Linux) cadre logs one line, registers nothing and stays off.
- **Keep going has no restart cap.** An agent that keeps stopping (`attempts`, `no-report`, `stagnant`, `stale`, `loop`) is restarted on every Keep going; the human ends the loop with Cancel task.
- **Already holds is lost on a re-asked red dialog** after `/clear`: the passing ids are not stored, so the dialog comes back with Retry only.
- **Red and green read the check's exit code and, when the runner writes one, a JUnit report (2.0, B1-B3, B14, B18, B19).** cadre never reads test output text. A runner reports to `$CADRE_JUNIT` (cadre sets the path for each run). A test that errors instead of failing is not a red: the tester makes it compile and run (B1). With declared tests and no report, red and green stop as a gate error for the human, never as a red or a pass (B2, B3). A check that declares no tests (a type without a red step) is judged by its exit code alone: the accepted weaker mode, and "Already holds" is not offered without results. A check can write any report it likes, no worse than the exit code it already controls. `/cadre init` runs each unit's test check once and records whether it wrote valid JUnit (B18); a unit with no test check is written without one and the first test-driven task sets one up (B19: only a run that wrote valid JUnit and failed as red needs is adopted).
- **Decisions are structured (2.0, B4, B17).** A flag is answered by the option's key (the dialog, `/cadre resolve <id> <key>`, or main's `status {id, choice}` under yolo); the `accept:` / `reject:` text prefix is gone, and a `reason` is recorded, never read. An answer emits one `flag.resolved` per flag that left the task, so cancelling a task now closes its flags' events too.
- **Delivery hooks and landing modules run with the user's powers (2.0, B6, B8, B21).** A hook, a landing provider and a module run on the host through one runner (`core/modrun.ts`): an argument list, no shell, a fixed environment (`PATH`, `LANG`, `HOME`, `TMPDIR`, the two `CADRE_*` paths and the names the caller's `envPass` lists). That keeps a credential out of logs and input files; it is hygiene, not a boundary: a hook of the same user can read `/proc/<pid>/environ`. What a hook changes is committed by cadre after an audit against the fixed protected paths (`.git/`, `.cadre/`, `.claude/`, `.mcp.json`) and lands by CAS, never by the hook itself.
- **Task commits carry their changelog entry on the epic branch (2.0, B6).** Each closed task adds one `docs(changelog)` commit. In a milestone two epics that both add entries conflict at the second merge, like any two edits of one hunk: the resolve task handles it.
- **A unit that is its own git repository (a submodule) is not landed (2.0, B7).** Init and integration refuse it with one line; a parent whose checks only read a submodule is fine.
