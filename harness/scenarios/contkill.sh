# continue-after-quit, S twin (`cont` script, LANDED=1): approve; when the worker's turn ends (its report is in), SIGKILL Claude Code before or while the reviewer
# waits, start it again and type /cadre continue: the same task goes on, the worker never runs again, one reviewer after the restart (oracle: continue)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
w=; until_debug 'SCRIPTED step agent=\S+ who=worker' && w=$(grep -ahoE 'SCRIPTED step agent=\S+ who=worker' "$D"/out/debug*.log | head -1 | sed -E 's/.*agent=(\S+) .*/\1/')
if [ -n "$w" ] && until_debug "SCRIPTED turn.complete agent=$w "; then
  docker exec "cadre-tui-$N" pkill -9 -x claude; log "fault kill (SIGKILL of Claude Code after the worker $w ended)"; sleep 2
  docker exec "cadre-tui-$N" tmux respawn-pane -k -t q "$(cat "$D/cmd")"; tui wait-for "$N" "\? for shortcuts|bypass permissions on" 30 >/dev/null; send "/cadre continue"
fi
