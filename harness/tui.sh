#!/bin/bash
# Interactive claude 2.1.295 in a container, driven through tmux. See harness/README.md.
#   tui.sh start <name> [--scenario <name>]   (--scenario: seed the board/events/secret/ui atoms from scenarios/<name>.ts; needs the CADRE_DEV session.start block)  env: NO_GIT_IDENT=1 (no git identity in the container); CADRE_SOURCE=marketplace (install from GitHub, CADRE_REF=<branch|tag>) instead of the local checkout; COLS=120 ROWS=40 MODEL=haiku (the only model live runs use) PERM=bypassPermissions SCAFFOLD=<script> CLAUDE_ARGS="..." SESSION_ARGS (appended) DEPS=1 (installs approved for the repo + uv mounted: the needs-setup cells)
#   tui.sh send <name> <text...>   types text + Enter;  keys <name> <tmux keys...> (Up, Enter, C-c ...)
#   tui.sh type <name> <text>      types text, no Enter
#   tui.sh wait-for <name> <regex> [secs=60] [pane|jsonl|debug]   exit 0 on match (prints the match), 1 on timeout
#   tui.sh capture <name> [file]   pane text (to file or stdout);  jsonl <name>: transcript path(s);  debug <name>: debug log path
#   tui.sh resize <name> <cols> <rows>;  restart <name> (quit claude, start it again in the same container);  stop <name>  (keeps $T/<name> evidence)
#   more start env: CC_VERSION=2.1.296 (mount ~/.local/share/claude/versions/<v>), VIA=ccr (claude-code-router in between), LAZY=1 (lazy.txt appended to the system prompt), CWD=<subdir> (start there), SPIKE=<plugin checkout> (default: this repo), PROXY=1 (effort-proxy.mjs logs each request's model + effort to out/effort.jsonl; not with VIA=ccr; PROXY_JS=<path in the plugin> runs another proxy, e.g. harness/scripted/stub-proxy.mjs)
#   a scaffold may leave .harness-store.json in the work dir: merged into the plugin's $.store file before claude starts
H=$(cd "$(dirname "$0")" && pwd); R=$(dirname "$H"); T=${TUI_DIR:-/tmp/cadre-tui}
# pins: the ~/.claude/cadre.json that puts every cadre route on haiku (H0). CLAUDE_CODE_SUBAGENT_MODEL_FORCE covers subagents only; these cover the rest of the routing keys.
# The reviewer's keys refuse haiku (registry floor), so they keep their defaults here and only the FORCE env puts reviewers on haiku (the oracle's routing check reads the same env).
if [ "$1" = pins ]; then exec node --experimental-transform-types --no-warnings --import "$R/tests/dev/register.mjs" -e '
const { REG } = await import(process.argv[1] + "/config/defaults.ts"), o = {}
for (const k of Object.keys(REG)) if (/^roles\.(?!reviewer\.)\w+\.(byRisk\.\w+\.(escalate\.)?)?model$/.test(k)) { let n = o; const p = k.split("."); for (const s of p.slice(0, -1)) n = n[s] ??= {}; n.model = "haiku" }
if (process.env.SPECIFIER === "1") (o.roles ??= {}).specifier = { enabled: true, model: "haiku" }   // the kept arm of fold-vs-keep: the specifier runs before each claim
o.limits = { limitWaitMinutes: 1 }   // a cell waits for the reported reset (90 s in the usage-limit cell), not the 15-min default
console.log(JSON.stringify(o))' --input-type=module "$R"; fi
. "$H/check.sh"
c=$1; n=$2; shift 2; C=cadre-tui-$n; D=$T/$n
# docker exec sometimes fails to start under load ("OCI runtime exec failed"): the command never ran, so run it again
dx() { local o r i; for i in 1 2 3 4 5; do o=$(docker exec "$@" 2>&1); r=$?; [[ $o == *"OCI runtime exec failed"* ]] || break; sleep 1; done; printf '%s\n' "$o"; return $r; }
tm() { dx "$C" tmux "$@"; }
ready() {   # deterministic dialog handling: Enter on any known first-run prompt until the composer shows
  for i in $(seq 120); do
    p=$(tm capture-pane -t q -p)
    if grep -q 'bypass permissions on\|auto mode on\|? for shortcuts\|esc to interrupt' <<<"$p"; then
      # the composer is drawn before the plugins' slash commands are registered (a line typed in between is lost): wait for them (<= 40 s)
      W=; want=0; [ -d "${SPIKE:-$R}/core" ] && { W='command.register \(cadre\)'; want=1; }; [[ $CLAUDE_ARGS == *scripted* ]] && { W="${W:+$W|}command.register \\(scripted\\)"; want=$((want + 1)); }
      for j in $(seq 80); do [ "$(grep -aEoh "$W" "$(ls -t "$D"/out/debug*.log 2>/dev/null | head -1)" 2>/dev/null | sort -u | wc -l)" -ge "$want" ] && break; sleep 0.5; done
      echo ready; return 0; fi
    if grep -qi 'Bypass Permissions mode' <<<"$p"; then tm send-keys -t q Down Enter
    elif grep -qi 'trust\|Choose the text style\|Press Enter\|Yes, I accept\|Do you want to use this API key' <<<"$p"; then tm send-keys -t q Enter; fi
    sleep 0.5
  done; echo "not ready:"; tm capture-pane -t q -p; return 1
}
case $c in
start)
  rm -rf "$D"; mkdir -p "$D"/{plug,work,projects,out}; chmod 777 "$D"/{work,projects,out}
  git -C "${SPIKE:-$R}" archive HEAD | tar -x -C "$D/plug"
  [ -n "$LAZY" ] && cp "$H/lazy.txt" "$D/out/lazy.txt" && CLAUDE_ARGS="$CLAUDE_ARGS --append-system-prompt-file /out/lazy.txt"
  VOL=; if [ -n "$CC_VERSION" ]; then   # the host's build of that version over the image's, else the harness's own copy (Claude Code prunes old host builds)
    CCB=$HOME/.local/share/claude/versions/$CC_VERSION; [ -f "$CCB" ] || CCB=$H/claude-$CC_VERSION
    [ -f "$CCB" ] || { echo "no Claude Code $CC_VERSION on the host or in harness/claude-$CC_VERSION" >&2; exit 1; }
    VOL="-v $CCB:/opt/claude/claude:ro"; fi
  [ -n "$DEPS" ] && VOL="$VOL -v $(readlink -f "$(command -v uv)"):/usr/local/bin/uv:ro -v $H/python-shim:/usr/local/bin/python:ro"   # DEPS=1: the install cells (needs-setup-*) need uv in the container, and `python` (the image has python3 only; a tester may write either)
  [ "$1" = --scenario ] && { node --experimental-transform-types --no-warnings "$R/scripts/ui-dev.mjs" --dump "$2" >"$D/work/.cadre-dev-scenario.json" || exit 1; EXTRA_ENV="$EXTRA_ENV -e CADRE_DEV=1 -e CADRE_DEV_SCENARIO=/work/run/.cadre-dev-scenario.json"; }   # dev: seed the pane atoms from scenarios/<name>.ts (docs/dev/ui-dev.md)
  [ -n "$SCAFFOLD" ] && (cd "$D/work" && bash "$SCAFFOLD" >"$D/out/scaffold.log" 2>&1 || { cat "$D/out/scaffold.log"; exit 1; })
  git -C "$D/work" config user.email q@x 2>/dev/null
  ID='-e GIT_AUTHOR_NAME=cadre -e GIT_AUTHOR_EMAIL=cadre@localhost -e GIT_COMMITTER_NAME=cadre -e GIT_COMMITTER_EMAIL=cadre@localhost'; [ -n "$NO_GIT_IDENT" ] && ID=   # NO_GIT_IDENT=1: a machine with no git identity
  echo '{"CLAUDE_CODE_SUBAGENT_MODEL":"haiku","CLAUDE_CODE_SUBAGENT_MODEL_FORCE":"1"}' >"$D/out/env.json"   # the forcing env below, for the oracle's routing check
  docker run -d --rm --name "$C" --user "$(id -u):$(id -g)" \
    $ID -e CLAUDE_CODE_SUBAGENT_MODEL=haiku -e CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 -e TERM=xterm-256color $EXTRA_ENV -e CADRE_REF \
    --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
    -v "$D/projects":/cchome/.claude/projects -v "${CRED:-$HOME/.claude/.credentials.json}":/cchome/.claude/.credentials.json \
    -v "$D/plug":/work/spike -v "$D/work":/work/run -v "$D/out":/out $VOL -w /work/run --entrypoint sleep cadre-harness infinity >/dev/null || exit 1
  # pre-seed first-run state: theme + onboarding done + folder trusted (no dialogs); anything else still appears -> handled below
  W=/work/run${CWD:+/$CWD}
  docker exec "$C" sh -c "echo '{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"/work/run\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true},\"$W\":{\"hasTrustDialogAccepted\":true,\"hasCompletedProjectOnboarding\":true}}}' > /cchome/.claude.json"
  # a fixture may leave .harness-roles.json (roles.custom of the user layer) in the work dir: merged into the pins
  "$0" pins | R="$D/work/.harness-roles.json" node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")),f=process.env.R;if(require("fs").existsSync(f))(o.roles??={}).custom=JSON.parse(require("fs").readFileSync(f,"utf8"));console.log(JSON.stringify(o))' | docker exec -i "$C" sh -c 'cat > /cchome/.claude/cadre.json' || exit 1   # every cadre route on haiku
  rm -f "$D/work/.harness-roles.json"
  # DEPS=1: the user's one-time approval of installs for this repo (user layer, keyed by the repo root), as after answering the dialog once
  [ -n "$DEPS" ] && echo '{"/work/run": true}' | docker exec -i "$C" sh -c 'mkdir -p /cchome/.claude/cadre && cat > /cchome/.claude/cadre/deps.json'
  # plugin $.store (one JSON file per plugin; id = name_source-<sha256(name@source)[:12]>): the fixture's seed, e.g. the machine-setup stamp
  [ -f "$D/work/.harness-store.json" ] && { docker exec -i "$C" sh -c 'mkdir -p -m 700 /cchome/.claude/plugins/store && cat > /cchome/.claude/plugins/store/cadre_inline-8e6dc893c684.json' <"$D/work/.harness-store.json"; rm "$D/work/.harness-store.json"; }
  ENV=; [ -n "$PROXY" ] && { docker exec -d "$C" node "/work/spike/${PROXY_JS:-harness/effort-proxy.mjs}" /out/effort.jsonl; ENV="ANTHROPIC_BASE_URL=http://127.0.0.1:8899"; }   # PROXY=1: log each request's model + effort (never content or headers)
  [ "$VIA" = ccr ] && { K=$(docker exec -i "$C" bash -s <"$H/ccr-up.sh") || { echo "ccr: $K"; exit 1; }; ENV="ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=$K"; }
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
