# planner-probe (S, the `probe` script): a milestone of two epics; the roadmap is approved, the first epic's planner asks the probe helper, is answered, drafts its tasks (oracle: planner-probe)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
GOAL='add two separate features to the library, each with node:test tests: (1) wordCount(s) in src/words.mjs returns the number of words in s; (2) truncate(s, n) in src/truncate.mjs cuts s to n characters and ends it with "..." when it was longer'
# Each epic has its own planner (the second starts when the first epic lands), each asks the probe once and drafts once. The cell ends when both planners have drafted and every planner turn
# has completed (its request answered, its draft accepted): no probe is then mid-flight (the oracle counts one ended helper per answered request).
quiet() { local l; l=$(cat "$D"/out/debug*.log 2>/dev/null); [ "$(grep -ac 'SCRIPTED planner drafts' <<<"$l")" -ge 2 ] || return 1
  local a; for a in $(grep -aoE 'step agent=\S+ who=planner' <<<"$l" | sed -E 's/step agent=(\S+) .*/\1/' | sort -u); do [ "$(grep -ac "turn.complete agent=$a " <<<"$l")" -ge 2 ] || return 1; done; }
goal "$GOAL"; approve && until_debug 'SCRIPTED planner drafts'
for _ in $(seq "$(left)"); do quiet && break; sleep 1; done; quiet || log "budget: the second epic's planner never drafted"
