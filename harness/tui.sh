#!/bin/bash
# Interactive claude 2.1.295 in a container, driven through tmux. See harness/README.md.
#   tui.sh start <name>      env: CADRE_SOURCE=marketplace (install from GitHub, CADRE_REF=<branch|tag>) instead of the local checkout; COLS=120 ROWS=40 MODEL=haiku PERM=bypassPermissions SCAFFOLD=<script> CLAUDE_ARGS="..." SESSION_ARGS (appended)
#   tui.sh send <name> <text...>   types text + Enter;  keys <name> <tmux keys...> (Up, Enter, C-c ...)
#   tui.sh type <name> <text>      types text, no Enter
#   tui.sh wait-for <name> <regex> [secs=60] [pane|jsonl|debug]   exit 0 on match (prints the match), 1 on timeout
#   tui.sh capture <name> [file]   pane text (to file or stdout);  jsonl <name>: transcript path(s);  debug <name>: debug log path
#   tui.sh resize <name> <cols> <rows>;  stop <name>  (keeps $T/<name> evidence)
H=$(cd "$(dirname "$0")" && pwd); R=$(dirname "$H"); T=${TUI_DIR:-/tmp/cadre-tui}
c=$1; n=$2; shift 2; C=cadre-tui-$n; D=$T/$n
tm() { docker exec "$C" tmux "$@"; }
case $c in
start)
  rm -rf "$D"; mkdir -p "$D"/{plug,work,projects,out}; chmod 777 "$D"/{work,projects,out}
  git -C "$R" archive HEAD | tar -x -C "$D/plug"
  [ -n "$SCAFFOLD" ] && (cd "$D/work" && bash "$SCAFFOLD" >"$D/out/scaffold.log" 2>&1 || { cat "$D/out/scaffold.log"; exit 1; })
  git -C "$D/work" config user.email q@x 2>/dev/null
  docker run -d --rm --name "$C" --user "$(id -u):$(id -g)" \
    -e GIT_AUTHOR_NAME=cadre -e GIT_AUTHOR_EMAIL=cadre@localhost -e GIT_COMMITTER_NAME=cadre -e GIT_COMMITTER_EMAIL=cadre@localhost -e TERM=xterm-256color $EXTRA_ENV -e CADRE_REF \
    --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
    -v "$D/projects":/cchome/.claude/projects -v "${CRED:-$HOME/.claude/.credentials.json}":/cchome/.claude/.credentials.json \
    -v "$D/plug":/work/spike -v "$D/work":/work/run -v "$D/out":/out -w /work/run --entrypoint sleep cadre-harness infinity >/dev/null || exit 1
  # pre-seed first-run state: theme + onboarding done + folder trusted (no dialogs); anything else still appears -> handled below
  docker exec "$C" sh -c 'echo "{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"/work/run\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true}}}" > /cchome/.claude.json'
  PLUG="--plugin-dir /work/spike"
  if [ "$CADRE_SOURCE" = marketplace ]; then PLUG=
    docker exec "$C" sh -c 'claude plugin marketplace add "it-dainb/cadre${CADRE_REF:+#$CADRE_REF}" && claude plugin install cadre@cadre' || exit 1
  fi
  tm new-session -d -s q -x "${COLS:-120}" -y "${ROWS:-40}" -c /work/run \
    "claude $PLUG --debug-file /out/debug.log --model ${MODEL:-haiku} --permission-mode ${PERM:-bypassPermissions} $CLAUDE_ARGS; echo EXITED; sleep infinity"
  # deterministic dialog handling: Enter on any known first-run prompt until the composer shows
  for i in $(seq 60); do
    p=$(tm capture-pane -t q -p)
    if grep -q 'bypass permissions on\|? for shortcuts\|esc to interrupt' <<<"$p"; then echo ready; exit 0; fi
    if grep -qi 'Bypass Permissions mode' <<<"$p"; then tm send-keys -t q Down Enter
    elif grep -qi 'trust\|Choose the text style\|Press Enter\|Yes, I accept' <<<"$p"; then tm send-keys -t q Enter; fi
    sleep 1
  done; echo "not ready:"; tm capture-pane -t q -p; exit 1;;
send) tm send-keys -t q -l "$*"; sleep 0.3; tm send-keys -t q Enter;;
type) tm send-keys -t q -l "$*";;
keys) tm send-keys -t q "$@";;
resize) tm resize-window -t q -x "$1" -y "$2";;
capture) if [ -n "$1" ]; then tm capture-pane -t q -p >"$1"; else tm capture-pane -t q -p; fi;;
jsonl) find "$D/projects" -name '*.jsonl' | sort;;
debug) echo "$D/out/debug.log";;
wait-for)
  re=$1; t=${2:-60}; src=${3:-pane}
  for i in $(seq "$t"); do
    case $src in
      pane) o=$(tm capture-pane -t q -p -S -200);;
      jsonl) o=$(find "$D/projects" -name '*.jsonl' -exec cat {} + 2>/dev/null);;
      debug) o=$(cat "$D/out/debug.log" 2>/dev/null);;
    esac
    m=$(grep -aEo -m1 "$re" <<<"$o") && { echo "$m"; exit 0; }
    sleep 1
  done; echo "timeout: $re" >&2; exit 1;;
stop) docker rm -f "$C" >/dev/null 2>&1; echo "stopped (evidence in $D)";;
*) sed -n 2,9p "$0"; exit 2;;
esac
