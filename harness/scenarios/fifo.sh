# concurrency-fifo (S, LANDED=1, concurrency.default 1, `three` script): three tasks land one at a time, in the order they were admitted (oracle: fifo)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
