# usage-limit (S, the `limit` script, LANDED=1, BUDGET covers the 90 s reset; the harness pins limits.limitWaitMinutes to 1): the proxy answers the first worker's request with a usage limit that resets in 20 s (the 1-minute floor of limitWaitMinutes then sets the wait) (oracle: limit)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
echo 20 >"$D/out/limit"
goal "$GOAL"; until_plan
