# Compatibility

cadre has no compatibility freeze: a Claude Code update may break it. `/cadre doctor` warns on a build newer than the tested one and fails below the minimum.

| Claude Code | Status | Live cells (L) | Offline cells (S) | Account mode |
|---|---|---|---|---|
| 2.1.295 (MIN) | **PENDING** | live: pending | | Max / Team: pending |
| 2.1.299 | tested offline | none | `CCV=2.1.299 harness/matrix.sh scripted` | none (no login needed) |
| 2.1.310 | **PENDING** | live: pending | | Max / Team: pending |

**PENDING** cells are filled by the 1.0 release gate (one `harness/matrix.sh` batch per version, run serially) in the commit that records the results and the account mode. Results compare only within one account mode: a Team login seats another Stop hook outermost than a Max login does, which changes hook order.

On 2.1.310 the `single-295` and `milestone-planners` cells are not 295 cells: `CCV=` replaces every cell's own version pin.

## Linux requirements

| Need | Why |
|---|---|
| Linux (`uname -s`) | on another OS cadre logs one line, registers nothing and stays off |
| `bwrap` (bubblewrap) | sandboxed checks; below 0.11 checks run in a copy jail |
| `socat` | Claude Code needs it to sandbox commands |
| `git` 2.17 or newer, with a name and email set | worktrees and commits |
| a filesystem with hard links | `.cadre/state` (not exFAT or some network mounts) |

Fixes for each: [troubleshooting](troubleshooting.md).
