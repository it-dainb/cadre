# flag-structured (S, the `flag-structured` script, yolo, LANDED=1): the worker asks for a spec change; main decides it with status {id, choice:"x"} and a reason that reads like
# "accept: ..."; the choice rules (the worker is told the change was rejected and conforms), the task lands (oracle: flag-structured)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "yolo $GOAL"; until_plan
