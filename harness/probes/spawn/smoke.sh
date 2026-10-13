#!/bin/bash
# Mod-mode bench smoke (ADR 0018) without touching harness/bench: one bench task, one mode, headless, judged by harness/bench/bench.mjs.
#   harness/probes/spawn/smoke.sh <out dir> <task> <main|mod> '<roles json>'
# main: what the bench does (-p, main drives every step). mod: stream-json stdin held open; the user types `/cadre continue` (a command frame: drive arms
# and cadre starts the agents), stdin closes once the plan landed (the drive's "landed on dev" toast) or the budget ran out.
H=$(cd "$(dirname "$0")/../.." && pwd); B=$H/bench; D=$1; T=$2; M=$3; R=$4
mkdir -p "$D/work" "$D/out" "$D/projects"; (cd "$D/work" && node "$B/scaffold.mjs" "$B/tasks/$T" "$R" >"$D/scaffold.json") || exit 1
PLUG=$(mktemp -d); git -C "${SPIKE:-$(dirname "$H")}" archive HEAD | tar -x -C "$PLUG"; git -C "${SPIKE:-$(dirname "$H")}" rev-parse HEAD >"$D/plugin-commit"
name=smoke-$$-$RANDOM; t0=$(date +%s%3N); bud=${BUDGET:-1500}
common=(--plugin-dir /work/spike --model "${MAIN_MODEL:-sonnet}" --permission-mode bypassPermissions --debug-file /out/debug.log --output-format stream-json --verbose)
if [ "$M" = main ]; then
  P="Plan p-p1 is approved. Execute it: spawn the agent for each task as the board directs, close each task once its review passes, then tell me where things stand. Spawn every agent in the foreground (run_in_background false) and wait for its result: this is a headless run that ends when your turn ends."
  WORK=$D/work OUT=$D/out SPIKE=$PLUG PROJECTS=$D/projects EXTRA_DOCKER="--name $name -e CADRE_SPAWN=main" timeout -k 10 "$bud" "$H/run.sh" -p "$P" "${common[@]}" >"$D/stream.jsonl" 2>"$D/stderr.log"; ex=$?
else
  { printf '%s\n' '{"type":"user","message":{"role":"user","content":"/cadre continue"}}'
    for i in $(seq $((bud / 5))); do grep -qa 'landed on dev; drive finished\|drive stopped' "$D/out/debug.log" 2>/dev/null && break; sleep 5; done; sleep 5; } |
  WORK=$D/work OUT=$D/out SPIKE=$PLUG PROJECTS=$D/projects EXTRA_DOCKER="--name $name -e CADRE_SPAWN=mod" timeout -k 10 "$((bud + 30))" "$H/run.sh" -p --input-format stream-json "${common[@]}" >"$D/stream.jsonl" 2>"$D/stderr.log"; ex=$?
fi
[ $ex = 124 ] && docker kill "$name" >/dev/null 2>&1
printf '{"cell":"%s","task":"%s","k":1,"t0":%s,"t1":%s,"exit":%s}\n' "$M" "$T" "$t0" "$(date +%s%3N)" "$ex" >"$D/meta.json"
node "$B/bench.mjs" judge "$D"; rm -rf "$PLUG"
