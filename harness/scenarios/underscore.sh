# underscore-id (run with CWD=my_lib LANDED=1 on fixtures/scripted/underscore): ids with `_` resolve; no explorer but main's one (oracle: underscore)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
