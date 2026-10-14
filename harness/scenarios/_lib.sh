# sourced by the 0.14 cell scenarios (not a scenario itself). Evidence the cell dir lacks otherwise:
#   store/<ms>.json: cadre's $.store each time it changed (run records `cadre:<repo>:run:<agentId>`, budgets); a closed task's records are pruned, so only
#   snapshots taken during the run show them. stubbed.jsonl: what the stub proxy answered (S cells). Stops when the container is gone.
snapshots() {
  mkdir -p "$O/store"
  ( prev=; while docker exec "cadre-tui-$N" true 2>/dev/null; do
      cur=$(docker exec "cadre-tui-$N" sh -c 'cat /cchome/.claude/plugins/store/cadre_*.json' 2>/dev/null)
      [ -n "$cur" ] && [ "$cur" != "$prev" ] && { printf '%s' "$cur" >"$O/store/$(date +%s%3N).json"; prev=$cur; }
      cp "$D/out/stubbed.jsonl" "$O/" 2>/dev/null; sleep 2
    done ) &
}
until_debug() { local i; for i in $(seq "${2:-$(left)}"); do grep -qaE "$1" "$D"/out/debug*.log 2>/dev/null && return 0; sleep 1; done; log "budget: no $1"; return 1; }
approve() { until_plan "$@" && sleep 2 && key Enter && log "answer approve (scenario)"; }   # without LANDED=1 the watcher only records the plan dialog
