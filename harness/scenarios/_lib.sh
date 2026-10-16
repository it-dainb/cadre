# sourced by the 0.14 cell scenarios (not a scenario itself). Evidence the cell dir lacks otherwise:
#   store/<ms>.json: cadre's $.store each time it or the task store's control doc changed; store/<ms>.state: the control doc's files (d/_control.<seq>, j/<n>),
#   folded by harness/oracle.mjs into keys `cadre:ctl:<key>` (run records `run:<agentId>`, budgets `budget:<taskId>`); a closed task's records are pruned, so only
#   snapshots taken during the run show them. stubbed.jsonl: what the stub proxy answered (S cells). Stops when the container is gone.
snapshots() {
  mkdir -p "$O/store"
  ( prev=; while docker exec "cadre-tui-$N" true 2>/dev/null; do
      cur=$(docker exec "cadre-tui-$N" sh -c 'cat /cchome/.claude/plugins/store/cadre_*.json' 2>/dev/null)
      st=$(docker exec "cadre-tui-$N" sh -c 'for f in /work/run/.cadre/state/d/_control.* /work/run/*/.cadre/state/d/_control.* /work/run/.cadre/state/j/[0-9]* /work/run/*/.cadre/state/j/[0-9]*; do [ -f "$f" ] && printf "%s\t%s\n" "${f#*/.cadre/state/}" "$(cat "$f")"; done' 2>/dev/null)
      [ -n "$cur" ] && [ "$cur$st" != "$prev" ] && { t=$(date +%s%3N); printf '%s' "$cur" >"$O/store/$t.json"; printf '%s' "$st" >"$O/store/$t.state"; prev=$cur$st; }
      cp "$D/out/stubbed.jsonl" "$O/" 2>/dev/null; sleep 2
    done ) &
}
until_debug() { local i; for i in $(seq "${2:-$(left)}"); do grep -qaE "$1" "$D"/out/debug*.log 2>/dev/null && return 0; sleep 1; done; log "budget: no $1"; return 1; }
approve() { until_plan "$@" && sleep 2 && key Enter && log "answer approve (scenario)"; }   # without LANDED=1 the watcher only records the plan dialog
