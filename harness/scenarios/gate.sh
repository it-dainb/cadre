# model-gate (S): the plan is approved with a refused model in the config; the drive does not start, no agent runs; Doctor names the cell once (oracle: gate)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; approve
until_log "answer approve" 20; sleep 3; send "/cadre doctor"; for _ in $(seq 20); do tui capture "$N" | grep -q "drive stopped: roles" && break; sleep 1; done; sleep 2   # the Doctor row shows a moment after the command
