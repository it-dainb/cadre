# flag-structured (S, the `flag-structured` script, LANDED=1): the worker asks for a spec change; the dialog is answered by its option key (Reject: a lite task has no tester to amend the spec),
# the worker is told the change was rejected and conforms, the task lands (oracle: flag-structured). Yolo's main decision (status {choice}) needs contained agents, which the container lacks: tests/drive.test.ts
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
