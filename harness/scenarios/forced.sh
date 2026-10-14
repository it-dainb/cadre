# forced-exit (S, the `silent` script: the worker never reports): approve, then wait for cadre to answer the worker's request itself (oracle: forced)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; approve
until_debug 'cadre \(user\) answered turn\.step without next' && sleep 20
