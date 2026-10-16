#!/bin/bash
# S0 scripted runs: zero quota by design. Every model request is answered by the scripted mod (hooks/register.ts); PROXY=1 logs any request that
# still reaches the network to effort.jsonl, which must stay empty. Haiku everywhere as the fallback (H0).
#   harness/scripted/run.sh plan  [name]          (commit first: the plugin is HEAD) one `single` plan (fixtures "single ready", scenario goal, LANDED=1) with cadre + the scripted mod (inner)
#   harness/scripted/run.sh probe [name] [tags]   the scripted mod alone: /s0 end, /s0 hb, /s0 wedge (forced-exit forms; TaskStop from a timer),
#     /s0 tools (tool list, hard links in .cadre/state, spawn + TaskStop), tag main-agent (main's model calls Agent)
# Env: CC_VERSION=<host build> PERM=auto|bypassPermissions (probe) SETTINGS=<json> (probe: the work dir's .claude/settings.local.json) BUDGET (plan, s). Evidence: harness/out/scripted/<name>/
H=$(cd "$(dirname "$0")/.." && pwd); R=$(dirname "$H"); S=$H/scripted
c=$1; n=${2:-s0-$c}; O=$H/out/scripted/$n; rm -rf "$O"; mkdir -p "$O"
# prompt suggestions are a forked request outside turn.step (source=prompt_suggestion): off, as the proxy would refuse each one
export EXTRA_ENV="$EXTRA_ENV -e CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false" PROXY=1 TUI_DIR=${TUI_DIR:-/tmp/cadre-tui}   # haiku pins: tui.sh (H0)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; docker ps --format "{{.Names}}" | grep -x "cadre-tui-$n" | xargs -r docker rm -f >/dev/null' EXIT
snap() { git -C "$1" add -A && git -C "$1" -c user.email=s0@localhost -c user.name=s0 commit -qm s0 --allow-empty; }   # tui.sh plugs `git archive HEAD` of SPIKE
leak() {   # the zero-quota check: the proxy ran, and logged nothing
  local f=$1; echo "proxy: $2 · stubbed $(cat "$(dirname "$f")/stubbed.jsonl" 2>/dev/null | node -e 'const r=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);const n={};for(const x of r)n[x.kind]=(n[x.kind]??0)+1;console.log(JSON.stringify(n))') · effort.jsonl $( [ -s "$f" ] && wc -c <"$f" || echo 0) bytes" | tee -a "$O/verdict.txt"
  [ -s "$f" ] && { echo "LEAK: $(node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);console.log([...new Set(r.map(x=>`${x.path} model=${x.model} max_tokens=${x.max_tokens} stream=${x.stream} messages=${x.n} tools=${x.tools} keys=${x.keys}`))].join("\n"))' "$f")" | tee -a "$O/verdict.txt"; return 1; }; return 0
}
case $c in
plan)
  PROXY_JS=harness/scripted/stub-proxy.mjs CLAUDE_ARGS="--plugin-dir /work/spike/harness/scripted" OUT_DIR=$O/cell LANDED=1 BUDGET=${BUDGET:-600} "$H/cell.sh" "$n" "single ready" goal | tee "$O/cell.txt"
  # (b): cadre's ledger saw the scripted usage (it sits above the scripted mod); the store is in the work dir, read with bd in a shell container
  SHELL_MODE=1 WORK=$TUI_DIR/$n/work OUT=$O "$H/run.sh" -c 'cd /work/run && BEADS_DIR=.cadre/store bd list --all --json 2>/dev/null | node -e "for (const t of JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))) console.log(t.id, t.status, (t.metadata||{})[\"cadre.cost\"] ?? \"-\")"; git log --oneline dev | head -5' >"$O/store.txt" 2>&1
  cp "$TUI_DIR/$n/out/stubbed.jsonl" "$O/cell/" 2>/dev/null; cat "$O/store.txt"; grep -h 'SCRIPTED\|turn.step' "$O"/cell/debug-*.log | grep -c SCRIPTED | sed 's/^/scripted lines: /'
  leak "$O/cell/effort.jsonl" "$(grep -c 'ANTHROPIC_BASE_URL=http://127.0.0.1:8899' "$TUI_DIR/$n/cmd") cmd line(s) via 127.0.0.1:8899";;
probe)
  mkdir -p "$TMP/p/harness/bench" && cp -a "$S/.claude-plugin" "$S/hooks" "$TMP/p/" && cp "$S/stub-proxy.mjs" "$TMP/p/harness/bench/effort-proxy.mjs" && git -C "$TMP/p" init -q && snap "$TMP/p" || exit 1
  [ -n "$SETTINGS" ] && { printf 'mkdir -p .claude && cat > .claude/settings.local.json <<"EOF"\n%s\nEOF\n' "$SETTINGS" >"$TMP/settings.sh"; export SCAFFOLD=$TMP/settings.sh; }
  SPIKE=$TMP/p "$H/tui.sh" start "$n" >"$O/start.txt" 2>&1 || grep -q "auto mode on" "$O/start.txt" || { cat "$O/start.txt"; exit 1; }   # tui.sh waits for the bypass footer; auto shows its own
  up=$(docker exec "cadre-tui-$n" sh -c 'cat /proc/[0-9]*/cmdline 2>/dev/null | tr "\0" " " | grep -c effort-proxy')
  for t in ${3:-end hb wedge}; do [ "$t" = main-agent ] && "$H/tui.sh" send "$n" "S0-PROBE main-agent" || "$H/tui.sh" send "$n" "/s0 $t"; sleep 3; done
  "$H/tui.sh" wait-for "$n" 'SCRIPTED TaskStop .*' 60 debug >/dev/null; sleep 20
  "$H/tui.sh" capture "$n" "$O/pane.txt"; D=$TUI_DIR/$n; cp "$D"/out/debug*.log "$O/"; cp "$D/out/effort.jsonl" "$D/out/stubbed.jsonl" "$O/" 2>/dev/null
  grep -h 'SCRIPTED' "$O"/debug*.log | sed 's/^[^ ]* //' | tee "$O/scripted.txt"
  grep -qiE 'Do you want to' "$O/pane.txt" && echo "pane shows a permission prompt" | tee -a "$O/verdict.txt"
  "$H/tui.sh" stop "$n" >/dev/null
  leak "$O/effort.jsonl" "$up process(es)";;
*) sed -n 2,6p "$0"; exit 2;;
esac
