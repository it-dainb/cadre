# planner-probe (S, the `probe` script): a milestone of two epics; the roadmap is approved, the first epic's planner asks the probe helper, is answered, drafts its tasks (oracle: planner-probe)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
GOAL='add two separate features to the library, each with node:test tests: (1) wordCount(s) in src/words.mjs returns the number of words in s; (2) truncate(s, n) in src/truncate.mjs cuts s to n characters and ends it with "..." when it was longer'
goal "$GOAL"; approve && until_debug 'SCRIPTED planner plan accepted'
