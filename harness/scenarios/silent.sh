# report-less-end (S, the `silent` script: the worker stops without a report every time): approve, then wait for its run to end blocked (oracle: noreport)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; approve
until_debug 'SCRIPTED step agent=\S+ who=worker' && until_log 'answer .*no-report' && sleep 3
