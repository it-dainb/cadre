# clear-bg-agents (L, LANDED=1): /clear while the worker runs; the run records after it say which agents were kept and which lost (oracle: clear)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
until_log '^[0-9]+ answer approve' 60 && { for i in $(seq 300); do grep -rqs 'Worker brief' --include='*.jsonl' "$D/projects" && break; sleep 1; done; sleep 5; clear_; }
