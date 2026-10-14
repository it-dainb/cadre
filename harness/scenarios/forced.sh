# forced-exit (S, the `loop` script: the worker calls the same tool until the breaker spends its run): approve, then wait for cadre to answer the worker's request itself (oracle: forced)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; approve
until_debug 'cadre \(user\) answered turn\.step without next' && sleep 20
