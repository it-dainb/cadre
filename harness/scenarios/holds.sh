# holds-scenario (S, the `holds` script, LANDED=1): a full-lane task whose S2 already holds: its test passes at red, S1's fails; the task lands (oracle: holds)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
