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
# hard wall cap: a cell never outlives BUDGET + 300 s (or its parent: the matrix, or the shell that started it); then its container goes and the cell dies. A hung scenario step does not stop at BUDGET by itself.
PP=$PPID; ( while sleep 5; do
    [ $(( $(date +%s%3N) - T0 )) -gt $(( (${BUDGET:-600} + 300) * 1000 )) ] && w="wall cap" || { kill -0 "$PP" 2>/dev/null && continue; w="parent gone"; }
    echo "$(date +%s%3N) $w: stopping $N" >>"$O/driver.log"; "$H/tui.sh" stop "$N" >/dev/null 2>&1; pkill -P $$ 2>/dev/null; kill $$ 2>/dev/null; break
  done ) & WALL=$!
trap 'kill $WALL 2>/dev/null' EXIT

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
# a toast docked over the dialog's top rows hides its title (live: "╰───╯ library: capitalise…"); a draft plan alone offers "Lane →", so that names it.
# The name must match isplan, or the watcher logs a dialog and no "plan" event comes (the cell waits for it: no-plan)
qtitle() { local t; t=$(title "$1"); [ -z "$t" ] && ! grep -q '☐' <<<"$1" && ! grep -q 'Ready to submit' <<<"$(flat "$1")" && grep -q '❯ 1\. ' <<<"$(flat "$1")" && grep -q 'Enter to select' <<<"$(flat "$1")" && { t=$(title "$(printf '☐\n%s' "$1")"); t=$(sed -E 's/[╭╮╰╯─│←]+//g; s/^ +//; s/  +/ /g' <<<"$t"); [ ${#t} -ge 8 ] || t=; }; printf '%s' "$t"; }   # a narrow pane scrolls the tab bar's ☐ row off of a real question (numbered options, its footer, not the review screen): the question then starts at the top row
isplan() { grep -qiE '^approve (the mission|mission|plan|milestone)' <<<"$1"; }
plantitle() { if grep -qiE '^approve ' <<<"$1"; then printf '%s' "$1"; elif grep -q '[0-9]\. Lane → ' <<<"$(flat "$2")"; then printf 'approve plan (title covered)'; else printf '%s' "$1"; fi; }
band() { awk "$AWK_BAND" <<<"$1"; }
# the key press that answers a dialog: Enter on the default (option 1); the red dialog that offers "Already holds" gets that option (the tests pin existing behaviour), else Retry (1)
answer() { local n c; n=$(flat "$1" | grep -oE '[0-9]+\. Already holds' | head -1 | cut -d. -f1); c=$(grep -oE '❯ [0-9]+\.' <<<"$1" | head -1 | grep -oE '[0-9]+'); if [ -n "$n" ] && [ -n "$c" ] && grep -q 'cannot be made red' <<<"$2"; then for ((i = c; i < n; i++)); do key Down; done; fi; key Enter; }   # from the cursor the pane shows now, so a repeat press never moves past the option
key() { for i in 1 2 3; do docker exec "cadre-tui-$N" tmux send-keys -t q "$@" 2>&1 | grep -q "OCI runtime exec failed" || break; sleep 1; done; }
comp() { awk '{L[NR]=$0; x=$0; gsub(/\033\[[0-9;]*m/,"",x)} x ~ /^─{20}/{b[++nb]=NR}
  END{x=L[b[nb-1]+1]; o=""; d=dim=inv=gr=0
    while(match(x,/\033\[[0-9;]*m/)){ if(!d)o=o substr(x,1,RSTART-1); n=split(substr(x,RSTART+2,RLENGTH-3),a,";"); if(n==0)a[n=1]=0
      for(i=1;i<=n;i++){c=a[i]+0; if(c==0)dim=inv=gr=0; else if(c==2)dim=1; else if(c==22)dim=0; else if(c==7)inv=1; else if(c==27)inv=0; else if(c==90||c==39)gr=(c==90); else if(c==38){ if(a[i+1]==5){g=a[i+2]+0; gr=(g>=240&&g<=250||g==8); i+=2} else if(a[i+1]==2){g=a[i+2]+0; gr=(g==a[i+3]&&g==a[i+4]&&g>=60&&g<=200); i+=4} } else if(c==48){ if(a[i+1]==5)i+=2; else if(a[i+1]==2)i+=4 } else if(c>=30&&c<=37)gr=0 }
      d=dim||inv||gr; x=substr(x,RSTART+RLENGTH)}
    if(!d)o=o x; sub(/^❯/,"",o); gsub(/[ \302\240]/,"",o); print o}' <<<"$1"; }   # what is typed in the composer. Given a `capture-pane -e` pane it leaves out dim, inverse (the cursor) and grey text: Claude Code'"'"'s prompt suggestion ("approve the plan") is not a draft (CC 2.1.310). A plain pane has no styles: all of it counts
# Claude Code keeps only the last ~2 min of a debug log once a run idles for long (live: a 28 min stall left 03:31-03:33 of a run that began 03:05): the watcher
# appends the lines newer than the last kept one to keep-<log> every 10 s, so the stall window survives (about the size of the log itself per cell).
# One awk pass reads the log once: it prints the new lines (a continuation line follows its timestamped line) and writes its state in END: the last timestamp and
# the lines kept at it (>= with a dedupe: two lines in one millisecond are neither lost nor kept twice)
keeplogs() { local f n; for f in "$D"/out/debug*.log; do [ -f "$f" ] || continue; n=${f##*/}; touch "$O/.ts-$n"
  awk -v st="$O/.ts-$n" 'BEGIN { getline t < st; while ((getline l < st) > 0) seen[l] = 1; close(st); m = t; delete at }
    /^20[0-9-]+T/ { keep = ($1 > t) || ($1 == t && !($0 in seen)); if (keep) { if ($1 > m) { m = $1; delete at } if ($1 == m) at[$0] = 1 } }
    keep { print }
    END { if (m != "") { print m > st ".new"; for (l in at) print l >> st ".new"; if (m == t) for (l in seen) if (!(l in at)) print l >> st ".new" } close(st ".new") }' "$f" >>"$O/keep-$n"
  [ -f "$O/.ts-$n.new" ] && mv "$O/.ts-$n.new" "$O/.ts-$n"; done; }
watcher() {
  local pe prev= seen= since=0 last1=0 lastt= tnew=0 bsince=0 bask= fault= kept=0 cur p t now
  while kill -0 "$CELL" 2>/dev/null; do   # the cell is gone: so is the watcher, whatever left it running
    p=$(docker exec "cadre-tui-$N" tmux capture-pane -t q -p 2>/dev/null) || { sleep 2; continue; }
    pe=$(docker exec "cadre-tui-$N" tmux capture-pane -t q -p -e 2>/dev/null); [ -n "$pe" ] || { sleep 2; continue; }   # with styles, for comp: the composer's ghost text is dim/grey
    now=$(date +%s%3N); [ $((now - kept)) -ge 10000 ] && { keeplogs; kept=$now; }
    [ "$p" != "$prev" ] && { printf '%s\n' "$p" >"$O/panes/$now.txt"; prev=$p; }
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
      t=$(qtitle "$p"); [ -z "$t" ] && grep -q 'Ready to submit your answers' <<<"$(flat "$p")" && t='submit answers'   # the review screen: Enter submits (not a dialog of its own)
      t=$(plantitle "$t" "$p")
      if isplan "$t"; then
        if [ "$seen" != "plan:$t" ]; then log "plan $t"; seen="plan:$t"; since=$now; [ -n "$LANDED" ] && { sleep 1; key Enter; log "answer $t"; }
        elif [ -n "$LANDED" ] && [ $((now - since)) -ge 15000 ]; then key Enter; log "answer $t"; since=$now   # re-asked (the draft changed under the first press: "it changed; review again")
        fi
      elif [ "$seen" != "$t" ]; then seen=$t; since=$now; log "$([ "$t" = 'submit answers' ] && echo submit || echo dialog) $t"
      elif [ $((now - since)) -ge $(( $(cat "$O/dialog_wait") * 1000 )) ]; then   # still open 10 s after an Enter: press again (a key can land mid-redraw)
        answer "$p" "$t"; log "answer $t"; since=$((now + 10000))
      fi
    else
      [ -n "$seen" ] && [ "${seen#plan:}" = "$seen" ] && seen=
      # like a user: a new "press 1" / "answer the dialog" (band, status line or Claude's words) gets 5 s to bring a dialog up, then 1 is pressed;
      # the band's "1: answer" too (5 s after it shows, then every 15 s while it stays). Only with nothing typed, no turn running, and not on hold.
      [ -z "$cur" ] && tnew=0; [ -n "$cur" ] && [ "$cur" != "$lastt" ] && [ $tnew = 0 ] && tnew=$now   # a text that scrolled away asks for nothing
      bask=$(band "$p" | grep -m1 '1: answer'); [ -z "$bask" ] && bsince=0; [ -n "$bask" ] && [ $bsince = 0 ] && bsince=$now
      if grep -q 'type anything' <<<"$(flat "$p")" && [ -z "$(comp "$pe")" ] && ! grep -q 'esc to interrupt' <<<"$p" && [ $((now - last1)) -gt 15000 ] && [ ! -f "$O/hold" ]; then
        tui send "$N" "go on" >/dev/null; last1=$now; log "type go on"   # after an Esc the band asks for a typed line (its dialog has no retry): a user types one
      elif { { [ $tnew -gt 0 ] && [ $((now - tnew)) -ge 5000 ]; } || { [ $bsince -gt 0 ] && [ $((now - bsince)) -ge 5000 ]; }; } && [ -z "$(comp "$pe")" ] && ! grep -q 'esc to interrupt' <<<"$p" && [ $((now - last1)) -gt 15000 ] && [ ! -f "$O/hold" ]; then
        key 1; last1=$now; lastt=$cur; tnew=0; log "press1 $cur"
      elif [ $last1 -gt 0 ] && [ $((now - last1)) -gt 6000 ] && [[ $(comp "$pe") =~ ^1+$ ]]; then key C-u; log "typed 1 cleared"   # the 1 went into the composer: no dialog took it
      fi
    fi
    sleep 2
  done
}
# WATCH, not W: a scenario that sets W (devmoved did: W=$D/work) left the watcher running for hours after the cell
CELL=$$; watcher & WATCH=$!
trap 'kill $WATCH $WALL 2>/dev/null' EXIT

# ---- scenario steps (harness/scenarios/<name>.sh is sourced: plain bash with these) ----
busy() { local p; p=$(tui capture "$N"); grep -q 'esc to interrupt' <<<"$p" || dialog "$p"; }
idle() { local i n=0; for i in $(seq "${1:-300}"); do if busy; then n=0; else n=$((n + 1)); [ $n -ge 3 ] && return 0; fi; sleep 1; done; log "idle timeout"; }
# an Enter Claude Code drops while it still starts up (the composer drawn, under load) leaves the line typed: press it again, up to 5 times
send() { local i t; log "send $*"; tui send "$N" "$*"; sleep 2; t=${*//[ $'\302\240']/}
  for i in 1 2 3 4 5; do [ -n "$t" ] && [[ "$(comp "$(tui capture "$N")")" == "${t:0:20}"* ]] || return 0; log "enter again"; key Enter; sleep 2; done; }
# the user types a goal; a line typed while Claude Code still starts up can vanish without a trace, or reach the model as text: when no command ran within 30 s, type it again (<= 3 times)
# a line typed into a running turn (user1: the goal typed while the setup run goes on) is queued by Claude Code until that turn ends: only the budget bounds that wait, and it is never Escaped;
# typed at an idle prompt, cadre answers within 30 s or the line was lost (or went to the model as text)
waitfor() { [ -n "$1" ] && echo "$2" || echo 30; }
# the plugin registers /cadre while its session.start runs (5-8 s): a line typed before that reaches the model as plain text (live: main began coding the goal, was refused
# 3-6 times, and the oracle's refusal-loop counted them). The newest debug log says when it is done.
ready() { local i f; for i in $(seq "${1:-90}"); do f=$(ls -t "$D"/out/debug*.log 2>/dev/null | head -1); [ -n "$f" ] && grep -qa 'cadre@inline.*session.start settled' "$f" && return 0; sleep 1; done; log "plugin not ready after ${1:-90} s"; return 1; }
goal() { local i n d b; ready || log "goal: typed without the plugin's start line (waited 90 s)"; for i in 1 2 3; do n=$(cat "$D"/out/debug*.log 2>/dev/null | grep -ac 'answered command\.run'); d=$(taken); b=; busy && b=1; send "/cadre $*"
  # taken = cadre answered the command, or anything of cadre's showed up (a dialog the watcher logged, a plan): the onboarding dialog is such an answer
  for _ in $(seq "$(waitfor "$b" "$(left)")"); do { [ "$(cat "$D"/out/debug*.log 2>/dev/null | grep -ac 'answered command\.run')" -gt "$n" ] || [ "$(taken)" -gt "$d" ]; } && return 0; sleep 1; done
  # Claude Code busy and nothing of cadre's after the 30 s is not "taken": a line typed 1-2 s after the plugin loaded reached the model as plain text (live: main
  # began coding the goal itself, without the goal guide, and was refused three times); stop that turn and type it again
  p=$(tui capture "$N"); dialog "$p" && { log "goal working: a dialog is open"; return 0; }   # main's question (or any of cadre's) is open: that is cadre answering, never Escaped
  isplain "$p" && { log "goal ran as plain text: stopped, typed again"; key Escape; sleep 2; continue; }; log "goal not taken"; done
  log "goal-failed no command answered it in 3 tries"; return 1; }   # the oracle fails the cell on this line
# a turn is running and no dialog is open: the line reached the model as plain text
isplain() { grep -q 'esc to interrupt' <<<"$1" && ! dialog "$1"; }
taken() { grep -cE '^[0-9]+ (dialog|plan|press1|submit) ' "$O/driver.log" 2>/dev/null; }
clear_() { send "/clear"; sleep 3; }                            # /clear (a name of its own: `clear` is the shell's)
shell_cd() { send "Run exactly this one Bash command and nothing else: cd $1 && pwd"; idle 120; }   # main's shell moves (a Bash cd)
hold() { echo "$1" >"$O/dialog_wait"; log "hold dialogs ${1}s"; }   # the human looks away: dialogs stay unanswered that long
pause1() { touch "$O/hold"; }; resume1() { rm -f "$O/hold"; }  # stop / restart pressing 1 on the band
restart() { log "restart"; tui restart "$N" >>"$O/start.log" 2>&1; ready || log "restart: the plugin's start line never showed (waited 90 s)"; }   # quit Claude Code and start it again in the same container
seen() { grep -qE "$1" "$O/driver.log"; }
until_log() { local i; for i in $(seq "${2:-$(left)}"); do seen "$1" && return 0; sleep 1; done; return 1; }
until_plan() { until_log '^[0-9]+ plan ' "${1:-$(left)}" || log "budget: no plan dialog"; }
left() { echo $(( ${BUDGET:-600} - ($(date +%s%3N) - T0) / 1000 )); }
landed() { while [ "$(left)" -gt 0 ]; do git -C "$D/work" log --oneline dev 2>/dev/null | grep -qiE "${LAND_RE:-titlecase|title}" && { log "landed"; return 0; }; sleep 1; done; log "budget: not landed"; }

. "$H/scenarios/$SCEN.sh"
[ -n "$LANDED" ] && landed
pause1; sleep 7; kill $WATCH 2>/dev/null; wait $WATCH 2>/dev/null; keeplogs; log "end"   # no press in the last 7 s: a press before it gets its 5 s to bring a dialog up

# ---- evidence (harness/out is gitignored), then the verdict ----
cp "$D"/out/debug*.log "$O/" 2>/dev/null; mkdir -p "$O/jsonl"; find "$D/projects" -name '*.jsonl' -exec cp --parents {} "$O/jsonl" \; 2>/dev/null
cp "$D/out/effort.jsonl" "$D/out/env.json" "$O/" 2>/dev/null; cp "$D/work/.cadre/config.json" "$O/cadre-config.json" 2>/dev/null   # PROXY=1: the requests and the repo settings for the routing invariant
git -C "$D/work" for-each-ref --format='%(refname:short) %(objectname:short)' refs/heads >"$O/refs-after" 2>/dev/null
git -C "$D/work" worktree list >"$O/worktrees-after" 2>/dev/null
git -C "$D/work" rev-list --count --no-merges main..dev >"$O/dev-commits" 2>/dev/null; git -C "$D/work" log --format='%s' main..dev >"$O/dev-log" 2>/dev/null; git -C "$D/work" show dev:CHANGELOG.md >"$O/dev-changelog" 2>/dev/null   # what cadre landed on dev (fold-vs-keep counts it)
(cd "$D/work" && find . -name .cadre | grep -v '^./.cadre$' >"$O/stray-state"; true)
# no credential may reach a mounted dir or the evidence (ccr keeps its copy of the login in the container's own filesystem, gone with --rm)
TOK=$(node -e 'try{const c=require(process.argv[1]).claudeAiOauth;console.log([c.accessToken,c.refreshToken].filter(Boolean).map(t=>t.slice(0,24)).join("\n"))}catch{}' "${CRED:-$HOME/.claude/.credentials.json}")
{ [ -n "$TOK" ] && grep -rlF -f <(echo "$TOK") "$D/work" "$D/out" "$D/projects" "$O" 2>/dev/null; grep -rlE 'sk-ant-(oat|ort|api)[0-9]{2}-' "$D/work" "$D/out" "$D/projects" "$O" 2>/dev/null; } | sort -u >"$O/leak"
tui stop "$N" >/dev/null
node "$H/oracle.mjs" "$O" ${LANDED:+--landed}
