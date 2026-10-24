# sourced by the 0.14 cell scenarios (not a scenario itself). Evidence the cell dir lacks otherwise:
#   store/<ms>.json: cadre's $.store each time it or the task store's control doc changed; store/<ms>.state: the control doc's files (d/_control.<seq>, j/<n>),
#   folded by harness/oracle.mjs into keys `cadre:ctl:<key>` (run records `run:<agentId>`, budgets `budget:<taskId>`); a closed task's records are pruned, so only
#   snapshots taken during the run show them. stubbed.jsonl: what the stub proxy answered (S cells). Stops when the container is gone.
snapshots() {
  mkdir -p "$O/store"
  # one docker exec per round (it is the costly part under load): the store file, which also tells the container is gone; the control doc is read from the work dir on the host
  ( prev=; while :; do
      cur=$(docker exec "cadre-tui-$N" sh -c 'cat /cchome/.claude/plugins/store/cadre_*.json 2>/dev/null; true' 2>/dev/null) || { docker ps -q -f "name=^cadre-tui-$N\$" | grep -q . && { sleep 1; continue; }; break; }   # an exec that failed to start is tried again
      st=$(cd "$D/work" && for f in ./.cadre/state/d/_control.* ./*/.cadre/state/d/_control.* ./.cadre/state/j/[0-9]* ./*/.cadre/state/j/[0-9]*; do [ -f "$f" ] && printf "%s\t%s\n" "${f#*/.cadre/state/}" "$(cat "$f")"; done; true)
      [ -n "$cur" ] && [ "$cur$st" != "$prev" ] && { t=$(date +%s%3N); printf '%s' "$cur" >"$O/store/$t.json"; printf '%s' "$st" >"$O/store/$t.state"; prev=$cur$st; }
      cp "$D/out/stubbed.jsonl" "$O/" 2>/dev/null; sleep 2
    done ) &
}
until_debug() { local i; for i in $(seq "${2:-$(left)}"); do grep -qaE "$1" "$D"/out/debug*.log 2>/dev/null && return 0; sleep 1; done; log "budget: no $1"; return 1; }
approve() { until_plan "$@" && sleep 1 && key Enter && log "answer approve (scenario)"; }   # without LANDED=1 the watcher only records the plan dialog
