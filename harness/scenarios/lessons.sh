# lessons-pass (S, LANDED=1, the default script): the plan's approval is the one input; the pass runs before the worker's brief, one side-model request, and the briefs carry the lesson (oracle: lessons)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan; until_debug "lesson.added" 20
