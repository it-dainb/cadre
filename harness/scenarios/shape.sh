# shape-refusal-budget (S, the `shape` script, LANDED=1): the worker sends four reports with an over-long summary, then a valid one; each is refused for its form and counted on the task; it lands (oracle: shape)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
