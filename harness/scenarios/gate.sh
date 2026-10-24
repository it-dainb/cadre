# model-gate (S): the plan is approved with a refused model in the config; the drive does not start, no agent runs; Doctor names the cell once (oracle: gate)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; approve
sleep 8; send "/cadre doctor"; sleep 4
