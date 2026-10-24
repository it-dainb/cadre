#!/bin/bash
# One matrix cell: fixtures -> interactive claude (tui.sh) -> scenario steps -> oracle verdict. See harness/README.md "Matrix".
#   harness/cell.sh <name> <fixtures> <scenario>      e.g.  cell.sh u1 "monorepo leftover" user1
# Env (passed to tui.sh): MODEL CC_VERSION VIA LAZY CWD SPIKE; cell: OUT_DIR (default harness/out/cells/<name>), BUDGET (s, 600), GOAL, DIALOG_WAIT (s before the
# watcher answers a dialog, 2), LANDED=1 (approve the plan and require it to land on dev), FAULT=interrupt|kill (after main's 2nd Bash call in the setup run: Esc, or SIGKILL Claude Code and start it again). Prints one verdict line; exit 0 = pass.
H=$(cd "$(dirname "$0")" && pwd); N=$1; FIX=$2; SCEN=$3
[ -f "$H/scenarios/$SCEN.sh" ] || { echo "no scenario $SCEN (harness/scenarios/)"; exit 2; }
export TUI_DIR=${TUI_DIR:-/tmp/cadre-tui}; D=$TUI_DIR/$N
O=$(realpath -m "${OUT_DIR:-$H/out/cells/$N}"); rm -rf "$O"; mkdir -p "$O/panes"
GOAL=${GOAL:-add titleCase(s) to the library: capitalise the first letter of each word, with node:test tests}
T0=$(date +%s%3N); echo "$T0" >"$O/t0"; echo "${DIALOG_WAIT:-2}" >"$O/dialog_wait"
log() { echo "$(date +%s%3N) $*" >>"$O/driver.log"; }
tui() { "$H/tui.sh" "$@"; }

# fixtures in order (a base, then overlays), then the machine-setup stamp: users run /cadre setup once per machine
S=$O/scaffold.sh; { for f in $FIX; do echo "bash '$H/fixtures/$f.sh' || exit 1"; done; echo ". '$H/fixtures/_base.sh'; seed cadre:setup '{\"at\":0}'"; } >"$S"
log "start fixtures=[$FIX] scenario=$SCEN model=${MODEL:-haiku} cc=${CC_VERSION:-image} via=${VIA:-direct} lazy=${LAZY:-0} cwd=${CWD:-.} fault=${FAULT:-none}"
SCAFFOLD=$S COLS=${COLS:-120} ROWS=${ROWS:-40} tui start "$N" >"$O/start.log" 2>&1 || { log "start failed"; cat "$O/start.log"; tui stop "$N" >/dev/null; echo "$N FAIL start"; exit 1; }
git -C "$D/work" for-each-ref --format='%(refname:short) %(objectname:short)' refs/heads >"$O/refs-before" 2>/dev/null

# ---- watcher: a pane capture every 2 s (kept when it changed), answers dialogs (option 1) after DIALOG_WAIT s, presses 1 when asked to, types a line when asked to ----
# the main column's rows joined: a pane docked at the right is cut off, so a phrase the narrowed column wraps over two rows still reads as one
flat() { sed -E 's/^([^│]*[^ │]) +│.*$/\1/' <<<"$1" | tr -s ' \n' '  '; }
dialog() { grep -qE 'Enter to select|Ready to submit your answers' <<<"$(flat "$1")"; }   # a question dialog, or its review screen after 2+ questions
title() { awk '/☐/{f=1; next} f && /^ *❯ 1\./{exit} f{x=$0; sub(/^│ ?/,"",x); sub(/ *│.*$/,"",x); if (!n && x ~ /Submit *$/) next; if (x ~ /[^ ]/) {t=t (t?" ":"") x; if (++n==3) exit}} END{gsub(/  +/," ",t); sub(/^ /,"",t); print substr(t,1,120)}' <<<"$1"; }   # the question: up to 3 rows, wrapped, without the docked pane
# the band = the rows from the one ending in Claude Code's fold button [-] down to the composer; the status line = the rows under the composer
AWK_BAND='{L[NR]=$0} /^─{20}/{b[++nb]=NR} END{if(nb<2)exit; t=b[nb-1]; for(i=t-1;i>0&&i>t-8;i--)if(L[i]~/\[-\] *$/){for(j=i;j<t;j++)print L[j];break}; for(i=b[nb]+1;i<=NR;i++)print L[i]}'
band() { awk "$AWK_BAND" <<<"$1"; }
key() { for i in 1 2 3; do docker exec "cadre-tui-$N" tmux send-keys -t q "$@" 2>&1 | grep -q "OCI runtime exec failed" || break; sleep 1; done; }
comp() { awk '/^─{20}/{b[++nb]=NR} {L[NR]=$0} END{x=L[b[nb-1]+1]; sub(/^❯/,"",x); gsub(/[ \302\240]/,"",x); print x}' <<<"$1"; }   # what is typed in the composer
watcher() {
  local prev= seen= since=0 last1=0 lastt= tnew=0 bsince=0 bask= fault= cur p t now
  while :; do
    p=$(docker exec "cadre-tui-$N" tmux capture-pane -t q -p 2>/dev/null) || { sleep 2; continue; }
    now=$(date +%s%3N); [ "$p" != "$prev" ] && { printf '%s\n' "$p" >"$O/panes/$now.txt"; prev=$p; }
    cur=$(grep -E 'press 1|answer the dialog|1: answer' <<<"$p" | tail -1 | sed 's/  */ /g; s/^ //' | cut -c1-120)
    if [ -n "$FAULT" ] && [ -z "$fault" ] && grep -q 'init is running' <<<"$p" && [ "$(cat "$D"/out/debug*.log 2>/dev/null | grep -c 'tool_dispatch_start tool=Bash')" -ge 2 ]; then
      fault=1; case $FAULT in
        interrupt) key Escape; log "fault interrupt (Esc after main's 2nd Bash call in the setup run)";;   # the turn ends with no normal stop (Claude Code still reports it)
        kill) docker exec "cadre-tui-$N" pkill -9 -x claude; sleep 2; docker exec "cadre-tui-$N" tmux respawn-pane -k -t q "$(cat "$D/cmd")"
              log "fault kill (SIGKILL of Claude Code after main's 2nd Bash call in the setup run, then started again)";;   # the turn end never reaches the plugin
      esac
    fi
    if dialog "$p"; then
      lastt=$cur; tnew=0   # what asked for a dialog (shown before or with it) got one
      t=$(title "$p"); [ -z "$t" ] && grep -q 'Ready to submit your answers' <<<"$(flat "$p")" && t='submit answers'   # the review screen: Enter submits (not a dialog of its own)
      if grep -qiE '^approve (the mission|mission|plan|milestone)' <<<"$t"; then
        if [ "$seen" != "plan:$t" ]; then log "plan $t"; seen="plan:$t"; since=$now; [ -n "$LANDED" ] && { sleep 1; key Enter; log "answer $t"; }
        elif [ -n "$LANDED" ] && [ $((now - since)) -ge 15000 ]; then key Enter; log "answer $t"; since=$now   # re-asked (the draft changed under the first press: "it changed; review again")
        fi
      elif [ "$seen" != "$t" ]; then seen=$t; since=$now; log "$([ "$t" = 'submit answers' ] && echo submit || echo dialog) $t"
      elif [ $((now - since)) -ge $(( $(cat "$O/dialog_wait") * 1000 )) ]; then   # still open 10 s after an Enter: press again (a key can land mid-redraw)
        key Enter; log "answer $t"; since=$((now + 10000))
      fi
    else
      [ -n "$seen" ] && [ "${seen#plan:}" = "$seen" ] && seen=
      # like a user: a new "press 1" / "answer the dialog" (band, status line or Claude's words) gets 5 s to bring a dialog up, then 1 is pressed;
      # the band's "1: answer" too (5 s after it shows, then every 15 s while it stays). Only with nothing typed, no turn running, and not on hold.
      [ -z "$cur" ] && tnew=0; [ -n "$cur" ] && [ "$cur" != "$lastt" ] && [ $tnew = 0 ] && tnew=$now   # a text that scrolled away asks for nothing
      bask=$(band "$p" | grep -m1 '1: answer'); [ -z "$bask" ] && bsince=0; [ -n "$bask" ] && [ $bsince = 0 ] && bsince=$now
      if grep -q 'type anything' <<<"$(flat "$p")" && [ -z "$(comp "$p")" ] && ! grep -q 'esc to interrupt' <<<"$p" && [ $((now - last1)) -gt 15000 ] && [ ! -f "$O/hold" ]; then
        tui send "$N" "go on" >/dev/null; last1=$now; log "type go on"   # after an Esc the band asks for a typed line (its dialog has no retry): a user types one
      elif { { [ $tnew -gt 0 ] && [ $((now - tnew)) -ge 5000 ]; } || { [ $bsince -gt 0 ] && [ $((now - bsince)) -ge 5000 ]; }; } && [ -z "$(comp "$p")" ] && ! grep -q 'esc to interrupt' <<<"$p" && [ $((now - last1)) -gt 15000 ] && [ ! -f "$O/hold" ]; then
        key 1; last1=$now; lastt=$cur; tnew=0; log "press1 $cur"
      elif [ $last1 -gt 0 ] && [ $((now - last1)) -gt 6000 ] && [[ $(comp "$p") =~ ^1+$ ]]; then key C-u; log "typed 1 cleared"   # the 1 went into the composer: no dialog took it
      fi
    fi
    sleep 2
  done
}
watcher & W=$!
trap 'kill $W 2>/dev/null' EXIT

# ---- scenario steps (harness/scenarios/<name>.sh is sourced: plain bash with these) ----
busy() { local p; p=$(tui capture "$N"); grep -q 'esc to interrupt' <<<"$p" || dialog "$p"; }
idle() { local i n=0; for i in $(seq "${1:-300}"); do if busy; then n=0; else n=$((n + 1)); [ $n -ge 3 ] && return 0; fi; sleep 1; done; log "idle timeout"; }
# an Enter Claude Code drops while it still starts up (the composer drawn, under load) leaves the line typed: press it again, up to 5 times
send() { local i t; log "send $*"; tui send "$N" "$*"; sleep 2; t=${*//[ $'\302\240']/}
  for i in 1 2 3 4 5; do [ -n "$t" ] && [[ "$(comp "$(tui capture "$N")")" == "${t:0:20}"* ]] || return 0; log "enter again"; key Enter; sleep 2; done; }
# the user types a goal; a line typed while Claude Code still starts up can vanish without a trace: when no command ran within 20 s, type it again (<= 3 times)
goal() { local i n; for i in 1 2 3; do n=$(cat "$D"/out/debug*.log 2>/dev/null | grep -ac 'answered command\.run'); send "/cadre $*"
  for _ in $(seq 20); do [ "$(cat "$D"/out/debug*.log 2>/dev/null | grep -ac 'answered command\.run')" -gt "$n" ] && return 0; sleep 1; done; log "goal not taken"; done; }
clear_() { send "/clear"; sleep 3; }                            # /clear (a name of its own: `clear` is the shell's)
shell_cd() { send "Run exactly this one Bash command and nothing else: cd $1 && pwd"; idle 120; }   # main's shell moves (a Bash cd)
hold() { echo "$1" >"$O/dialog_wait"; log "hold dialogs ${1}s"; }   # the human looks away: dialogs stay unanswered that long
pause1() { touch "$O/hold"; }; resume1() { rm -f "$O/hold"; }  # stop / restart pressing 1 on the band
restart() { log "restart"; tui restart "$N" >>"$O/start.log" 2>&1; }   # quit Claude Code and start it again in the same container
seen() { grep -qE "$1" "$O/driver.log"; }
until_log() { local i; for i in $(seq "${2:-$(left)}"); do seen "$1" && return 0; sleep 1; done; return 1; }
until_plan() { until_log '^[0-9]+ plan ' "${1:-$(left)}" || log "budget: no plan dialog"; }
left() { echo $(( ${BUDGET:-600} - ($(date +%s%3N) - T0) / 1000 )); }
landed() { while [ "$(left)" -gt 0 ]; do git -C "$D/work" log --oneline dev 2>/dev/null | grep -qiE "${LAND_RE:-titlecase|title}" && { log "landed"; return 0; }; sleep 1; done; log "budget: not landed"; }

. "$H/scenarios/$SCEN.sh"
[ -n "$LANDED" ] && landed
pause1; sleep 7; kill $W 2>/dev/null; wait $W 2>/dev/null; log "end"   # no press in the last 7 s: a press before it gets its 5 s to bring a dialog up

# ---- evidence (harness/out is gitignored), then the verdict ----
cp "$D"/out/debug*.log "$O/" 2>/dev/null; mkdir -p "$O/jsonl"; find "$D/projects" -name '*.jsonl' -exec cp --parents {} "$O/jsonl" \; 2>/dev/null
cp "$D/out/effort.jsonl" "$D/out/env.json" "$O/" 2>/dev/null; cp "$D/work/.cadre/config.json" "$O/cadre-config.json" 2>/dev/null   # PROXY=1: the requests and the repo settings for the routing invariant
git -C "$D/work" for-each-ref --format='%(refname:short) %(objectname:short)' refs/heads >"$O/refs-after" 2>/dev/null
(cd "$D/work" && find . -name .cadre | grep -v '^./.cadre$' >"$O/stray-state"; true)
# no credential may reach a mounted dir or the evidence (ccr keeps its copy of the login in the container's own filesystem, gone with --rm)
TOK=$(node -e 'try{const c=require(process.argv[1]).claudeAiOauth;console.log([c.accessToken,c.refreshToken].filter(Boolean).map(t=>t.slice(0,24)).join("\n"))}catch{}' "${CRED:-$HOME/.claude/.credentials.json}")
{ [ -n "$TOK" ] && grep -rlF -f <(echo "$TOK") "$D/work" "$D/out" "$D/projects" "$O" 2>/dev/null; grep -rlE 'sk-ant-(oat|ort|api)[0-9]{2}-' "$D/work" "$D/out" "$D/projects" "$O" 2>/dev/null; } | sort -u >"$O/leak"
tui stop "$N" >/dev/null
node "$H/oracle.mjs" "$O" ${LANDED:+--landed}
