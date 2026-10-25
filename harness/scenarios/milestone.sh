# a goal of two separate features (the milestone lane): approve the roadmap (run with LANDED=1 EPIC_PLANNERS=2); each epic's tasks are planned by a planner
# agent, never by main (oracle: epic-planner); the milestone lands on dev
GOAL='add two separate features to the library, each with node:test tests: (1) wordCount(s) in src/words.mjs returns the number of words in s; (2) truncate(s, n) in src/truncate.mjs cuts s to n characters and ends it with "..." when it was longer'
LAND_RE='milestone|wordcount|truncate'
# the oracle modes read the store's snapshots (scenarios/_lib.sh): fold-vs-keep counts the rework rounds from them
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
