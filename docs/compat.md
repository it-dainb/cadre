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

2.0 changes the engine, not the Claude Code surface it uses. The offline scripted cells (`harness/matrix.sh scripted`) pass on 2.1.295. The live gate for 2.0 is run by the owner on its own account and is not part of the source tree: until it is recorded here, 2.0 has no live result in this table.

## Linux requirements

| Need | Why |
|---|---|
| Linux (`uname -s`) | on another OS cadre logs one line, registers nothing and stays off |
| `bwrap` (bubblewrap) | sandboxed checks; below 0.11 checks run in a copy jail |
| `socat` | Claude Code needs it to sandbox commands |
| `git` 2.17 or newer, with a name and email set | worktrees and commits |
| a filesystem with hard links | `.cadre/state` (not exFAT or some network mounts) |

Fixes for each: [troubleshooting](troubleshooting.md).
