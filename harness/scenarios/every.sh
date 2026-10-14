# exit-every-role (run with PERM=auto LANDED=1; S: the `full` script, every role): the goal lands; every agent's run ends (oracle: every)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
