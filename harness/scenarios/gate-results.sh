# gate-results (S, the `gate-results` script, LANDED=1): the tester's first run writes JUnit itself with an <error> (a tester round, "errored instead of failing"), the second is the real
# runner: S1 fails, the held S2 passes; red holds through the report, the task lands (oracle: gate-results)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
