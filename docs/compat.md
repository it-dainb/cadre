# Compatibility

cadre has no compatibility freeze: a Claude Code update may break it. `/cadre doctor` warns on a build newer than the tested one and fails below the minimum.

| Claude Code | Status | Live cells (L) | Offline cells (S) | Account mode |
|---|---|---|---|---|
| 2.1.295 (MIN) | tested live | 13 L cells over 1.0 candidates RC1-RC4: 12 passed live at least once (milestone-planners, clarify-vague and needs-setup-node after the fixes they found); needs-setup-python passed only on an offline re-judge of its first run (later runs hit host timeouts, a revoked login and the spec-change loop fixed in RC5) and passes live on 2.1.310; the RC5 spec-change fix was proven live on 2.1.310 only | scripted 24/24 | Team |
| 2.1.299 | tested offline | none | `CCV=2.1.299 harness/matrix.sh scripted` | none (no login needed) |
| 2.1.310 | tested live | 13 L cells: 11/13 on the first batch on 1.0.0 (RC5); both failures were harness faults, fixed; needs-setup-python passed on the 1st rerun, needs-setup-node on the 2nd | scripted 24/24 | Max |

Results come from the 1.0 release gate: one `harness/matrix.sh` batch per version, run serially, all roles on haiku, at most two reruns of a failing cell. Results compare only within one account mode: a Team login seats another Stop hook outermost than a Max login does, which changes hook order.

On 2.1.310 the `single-295` and `milestone-planners` cells are not 295 cells: `CCV=` replaces every cell's own version pin.

## 2.0

2.0 changes the engine, not the Claude Code surface it uses. Release gate 2026-10-31: one `harness/matrix.sh` batch per version (12 L cells, `continue-after-quit` twice: 13 cell-runs), all roles on haiku, Team login on both versions (so its 2.1.310 results do not compare with the 1.0 row above, which ran Max). Scripted cells 24/24 on the release head (2.1.295).

| Claude Code | First batch | After fixes and reruns | Failures and what they were |
|---|---|---|---|
| 2.1.295 | 11/12 | 12/12 | `continue-after-quit` r1: the planner made the protected CHANGELOG.md a task path and acceptance item, and the worker blocked. A gap since 1.0.1 (only epics were checked); fixed: a task whose paths name a protected file is refused at plan time. r2: a resumed session stopped its drive within 10 s with "no progress in 3 turns". Since 1.0.1 (progress was compared across sessions); fixed. Passed both runs on a clean rerun (a second rerun, after two matrix runs shared one evidence folder). |
| 2.1.310 | 11/12 | 12/12 | `milestone-planners`: haiku planned an acceptance item no task could meet (`npm test` run inside a `node --test` test); the worker blocked and the harness can only press Keep. Rerun 1 failed differently: a plan-quality loop (a locked test that already passed on the base commit) and, from minute 10, a store fault: the file store's journal passed 4 MiB, the host cuts a command's output at 4 MiB, so scans and compaction's own scan failed and hooks timed out. Since 1.0.1, not seen in 1.0 runs; fixed (the store folds by size, and a failed fold is logged). Rerun 2 passed, but on code without that fix (a shorter run: 285 store writes against 931), so that rerun had no fix behind it. A run on the release head, with the fix, passed (US$0.26, 6 min). |

Re-run on the release head, after the fixes above (2026-10-31): `milestone-planners` passed on 2.1.310; on 2.1.295, `exit-every-role-live` and `profile-docs-live` first failed. `profile-docs-live` showed a 2.0 fault: a task planned without a type was given the default profile's `feature`, which the docs profile does not have, so its writer was never started (fixed: such a task gets the profile's first type). `exit-every-role-live` was haiku plan quality: an ambiguous acceptance item ("each word" against "a string"), then a worker question the harness can only Keep. Both passed on the rerun, with the fix.

Classification (a separate verifier lane over the evidence): one 2.0 fault, the task type default above, found by the re-run and fixed; reviewing it found two more of its kind, fixed offline (a task sent back after the plan moved, and a turn-end checkpoint, both named the default profile's worker step, so docs and analysis tasks could not be reworked or checkpointed); no other failure was a 2.0 regression. Engine faults, all present in 1.0.1: drive progress across sessions (fixed), the plan-time check for protected task paths (fixed for paths; see [limitations](limitations.md)), and file-store compaction (fixed). Harness faults found and fixed on the way: a bypass-mode dialog keypress that turned a typed `/cadre` into text, an oracle stack overflow on long logs (its first fix broke the cost sum; fixed), and two matrix runs of one tier in the same second sharing an evidence folder.

## Linux requirements

| Need | Why |
|---|---|
| Linux (`uname -s`) | on another OS cadre logs one line, registers nothing and stays off |
| `bwrap` (bubblewrap) | sandboxed checks; below 0.11 checks run in a copy jail |
| `socat` | Claude Code needs it to sandbox commands |
| `git` 2.17 or newer, with a name and email set | worktrees and commits |
| a filesystem with hard links | `.cadre/state` (not exFAT or some network mounts) |

Fixes for each: [troubleshooting](troubleshooting.md).
