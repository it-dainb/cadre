#!/bin/bash
# Interactive claude 2.1.295 in a container, driven through tmux. See harness/README.md.
#   tui.sh start <name> [--scenario <name>]   (--scenario: seed the board/events/secret/ui atoms from scenarios/<name>.ts; needs the CADRE_DEV session.start block)  env: NO_GIT_IDENT=1 (no git identity in the container); CADRE_SOURCE=marketplace (install from GitHub, CADRE_REF=<branch|tag>) instead of the local checkout; COLS=120 ROWS=40 MODEL=haiku PERM=bypassPermissions SCAFFOLD=<script> CLAUDE_ARGS="..." SESSION_ARGS (appended)
#   tui.sh send <name> <text...>   types text + Enter;  keys <name> <tmux keys...> (Up, Enter, C-c ...)
#   tui.sh type <name> <text>      types text, no Enter
#   tui.sh wait-for <name> <regex> [secs=60] [pane|jsonl|debug]   exit 0 on match (prints the match), 1 on timeout
#   tui.sh capture <name> [file]   pane text (to file or stdout);  jsonl <name>: transcript path(s);  debug <name>: debug log path
#   tui.sh resize <name> <cols> <rows>;  restart <name> (quit claude, start it again in the same container);  stop <name>  (keeps $T/<name> evidence)
#   more start env: CC_VERSION=2.1.296 (mount ~/.local/share/claude/versions/<v>), VIA=ccr (claude-code-router in between), LAZY=1 (lazy.txt appended to the system prompt), CWD=<subdir> (start there), SPIKE=<plugin checkout> (default: this repo)
#   a scaffold may leave .harness-store.json in the work dir: merged into the plugin's $.store file before claude starts
H=$(cd "$(dirname "$0")" && pwd); R=$(dirname "$H"); T=${TUI_DIR:-/tmp/cadre-tui}
. "$H/check.sh"
c=$1; n=$2; shift 2; C=cadre-tui-$n; D=$T/$n
tm() { docker exec "$C" tmux "$@"; }
ready() {   # deterministic dialog handling: Enter on any known first-run prompt until the composer shows
  for i in $(seq 60); do
    p=$(tm capture-pane -t q -p)
    if grep -q 'bypass permissions on\|? for shortcuts\|esc to interrupt' <<<"$p"; then echo ready; return 0; fi
    if grep -qi 'Bypass Permissions mode' <<<"$p"; then tm send-keys -t q Down Enter
    elif grep -qi 'trust\|Choose the text style\|Press Enter\|Yes, I accept\|Do you want to use this API key' <<<"$p"; then tm send-keys -t q Enter; fi
    sleep 1
  done; echo "not ready:"; tm capture-pane -t q -p; return 1
}
case $c in
start)
  rm -rf "$D"; mkdir -p "$D"/{plug,work,projects,out}; chmod 777 "$D"/{work,projects,out}
  git -C "${SPIKE:-$R}" archive HEAD | tar -x -C "$D/plug"
  [ -n "$LAZY" ] && cp "$H/lazy.txt" "$D/out/lazy.txt" && CLAUDE_ARGS="$CLAUDE_ARGS --append-system-prompt-file /out/lazy.txt"
  VOL=; [ -n "$CC_VERSION" ] && VOL="-v $HOME/.local/share/claude/versions/$CC_VERSION:/opt/claude/claude:ro"   # the host's build of that version over the image's
  [ "$1" = --scenario ] && { node --experimental-transform-types --no-warnings "$R/scripts/ui-dev.mjs" --dump "$2" >"$D/work/.cadre-dev-scenario.json" || exit 1; EXTRA_ENV="$EXTRA_ENV -e CADRE_DEV=1 -e CADRE_DEV_SCENARIO=/work/run/.cadre-dev-scenario.json"; }   # dev: seed the pane atoms from scenarios/<name>.ts (docs/dev/ui-dev.md)
  [ -n "$SCAFFOLD" ] && (cd "$D/work" && bash "$SCAFFOLD" >"$D/out/scaffold.log" 2>&1 || { cat "$D/out/scaffold.log"; exit 1; })
  git -C "$D/work" config user.email q@x 2>/dev/null
  ID='-e GIT_AUTHOR_NAME=cadre -e GIT_AUTHOR_EMAIL=cadre@localhost -e GIT_COMMITTER_NAME=cadre -e GIT_COMMITTER_EMAIL=cadre@localhost'; [ -n "$NO_GIT_IDENT" ] && ID=   # NO_GIT_IDENT=1: a machine with no git identity
  docker run -d --rm --name "$C" --user "$(id -u):$(id -g)" \
    $ID -e TERM=xterm-256color $EXTRA_ENV -e CADRE_REF \
    --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
    -v "$D/projects":/cchome/.claude/projects -v "${CRED:-$HOME/.claude/.credentials.json}":/cchome/.claude/.credentials.json \
    -v "$D/plug":/work/spike -v "$D/work":/work/run -v "$D/out":/out $VOL -w /work/run --entrypoint sleep cadre-harness infinity >/dev/null || exit 1
  # pre-seed first-run state: theme + onboarding done + folder trusted (no dialogs); anything else still appears -> handled below
  W=/work/run${CWD:+/$CWD}
  docker exec "$C" sh -c "echo '{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"/work/run\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true},\"$W\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true}}}' > /cchome/.claude.json"
  # plugin $.store (one JSON file per plugin; id = name_source-<sha256(name@source)[:12]>): the fixture's seed, e.g. the machine-setup stamp
  [ -f "$D/work/.harness-store.json" ] && { docker exec -i "$C" sh -c 'mkdir -p -m 700 /cchome/.claude/plugins/store && cat > /cchome/.claude/plugins/store/cadre_inline-8e6dc893c684.json' <"$D/work/.harness-store.json"; rm "$D/work/.harness-store.json"; }
  ENV=; [ "$VIA" = ccr ] && { K=$(docker exec -i "$C" bash -s <"$H/ccr-up.sh") || { echo "ccr: $K"; exit 1; }; ENV="ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=$K"; }
  PLUG="--plugin-dir /work/spike"
  if [ "$CADRE_SOURCE" = marketplace ]; then PLUG=
    docker exec "$C" sh -c 'claude plugin marketplace add "it-dainb/cadre${CADRE_REF:+#$CADRE_REF}" && claude plugin install cadre@cadre' || exit 1
  fi
  echo "$ENV claude $PLUG --debug-file /out/debug-\$(date +%s).log --model ${MODEL:-haiku} --permission-mode ${PERM:-bypassPermissions} $CLAUDE_ARGS; echo EXITED; sleep infinity" >"$D/cmd"
  tm new-session -d -s q -x "${COLS:-120}" -y "${ROWS:-40}" -c "$W" "$(cat "$D/cmd")"
  ready; exit;;
restart) tm send-keys -t q C-c; sleep 0.5; tm send-keys -t q C-c; sleep 2; tm respawn-pane -k -t q "$(cat "$D/cmd")"; ready; exit;;
send) tm send-keys -t q -l "$*"; sleep 0.3; tm send-keys -t q Enter;;
type) tm send-keys -t q -l "$*";;
keys) tm send-keys -t q "$@";;
resize) tm resize-window -t q -x "$1" -y "$2";;
capture) if [ -n "$1" ]; then tm capture-pane -t q -p >"$1"; else tm capture-pane -t q -p; fi;;
jsonl) find "$D/projects" -name '*.jsonl' | sort;;
debug) ls -t "$D"/out/debug*.log | head -1;;
wait-for)
  re=$1; t=${2:-60}; src=${3:-pane}
  for i in $(seq "$t"); do
    case $src in
      pane) o=$(tm capture-pane -t q -p -S -200);;
      jsonl) o=$(find "$D/projects" -name '*.jsonl' -exec cat {} + 2>/dev/null);;
      debug) o=$(cat "$D"/out/debug*.log 2>/dev/null);;
    esac
    m=$(grep -aEo -m1 "$re" <<<"$o") && { echo "$m"; exit 0; }
    sleep 1
  done; echo "timeout: $re" >&2; exit 1;;
stop) docker rm -f "$C" >/dev/null 2>&1; echo "stopped (evidence in $D)";;
*) sed -n 2,9p "$0"; exit 2;;
esac
