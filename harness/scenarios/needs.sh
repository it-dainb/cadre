# needs-explore (S, LANDED=1, the `needs` script): the worker asks the explore helper, its answer resumes the same worker, the task lands (oracle: needs-explore)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
