#!/bin/bash
# Model x effort bench: runs a grid of (task, worker, tester, reviewer) x N headless through harness/run.sh (Docker, only the creds mount), judges each run, prints the table.
#   harness/bench/run.sh <grid.json> [-j N] [-n] [--go]    -n: cells + estimate only. A grid estimated over $5 runs only with --go.
# Env: MAIN_MODEL (sonnet), BUDGET (s per run, 1800; core plans x2), SPIKE (plugin checkout, default this repo: git archive HEAD),
#      CAP (US$: no new run starts once the judged runs spent this much; default: the estimate's upper bound).
H=$(cd "$(dirname "$0")/.." && pwd); B=$H/bench; G=$1; shift; J=4; DRY=; GO=
while [ $# -gt 0 ]; do case $1 in -j) J=$2; shift;; -n) DRY=1;; --go) GO=1;; esac; shift; done
[ -f "$G" ] || { echo "usage: run.sh <grid.json> [-j N] [-n] [--go]"; exit 2; }
RUNS=$(J=$J node "$B/bench.mjs" plan "$G" 2>"$B/.est") || exit 2; EST=$(cat "$B/.est"); rm -f "$B/.est"; echo "$EST"
[ -n "$DRY" ] && { cut -d'|' -f1 <<<"$RUNS" | sort | uniq -c; exit 0; }
HI=$(sed -E 's/.*US\$[0-9]+-([0-9]+).*/\1/' <<<"$EST"); [ "$HI" -gt 5 ] && [ -z "$GO" ] && { echo "estimate over \$5: rerun with --go once approved"; exit 3; }
SRC=${SPIKE:-$(dirname "$H")}; OUTD=$H/out/bench/$(basename "$G" .json)-$(date +%Y%m%d-%H%M%S); mkdir -p "$OUTD/plug"
git -C "$SRC" archive HEAD | tar -x -C "$OUTD/plug"; echo "plugin $(git -C "$SRC" rev-parse --short HEAD) · evidence $OUTD"
export H B OUTD CAP=${CAP:-$HI}
one() {   # <cell>|<task>|<k>|<roles json>
  IFS='|' read -r cell task k roles <<<"$1"; D=$OUTD/$cell/$task-$k
  spent=$(node "$B/bench.mjs" spent "$OUTD"); node -e "process.exit(+process.argv[1] >= +process.argv[2] ? 0 : 1)" "$spent" "$CAP" && { echo "$cell $task#$k skipped: \$$spent spent, cap \$$CAP"; return; }
  mkdir -p "$D/work" "$D/out" "$D/projects"
  (cd "$D/work" && node "$B/scaffold.mjs" "$B/tasks/$task" "$roles" >"$D/scaffold.json" 2>"$D/scaffold.err") || { echo "$cell $task#$k scaffold failed"; return; }
  n=$(node -p "require('$B/tasks/$task/plan.json').tasks.length"); bud=$(( ${BUDGET:-1800} * (n > 1 ? 2 : 1) )); name=bench-$$-$RANDOM
  P="Plan p-p1 is approved. Execute it: spawn the agent for each task as the board directs, close each task once its review passes, then tell me where things stand. Spawn every agent in the foreground (run_in_background false) and wait for its result: this is a headless run that ends when your turn ends."
  t0=$(date +%s%3N)
  WORK=$D/work OUT=$D/out SPIKE=$OUTD/plug PROJECTS=$D/projects EXTRA_DOCKER="--name $name" timeout -k 10 "$bud" "$H/run.sh" -p "$P" --plugin-dir /work/spike --model "${MAIN_MODEL:-sonnet}" \
    --permission-mode bypassPermissions --debug-file /out/debug.log --output-format stream-json --verbose >"$D/stream.jsonl" 2>"$D/stderr.log"; ex=$?
  [ $ex = 124 ] && docker kill "$name" >/dev/null 2>&1
  printf '{"cell":"%s","task":"%s","k":%s,"t0":%s,"t1":%s,"exit":%s}\n' "$cell" "$task" "$k" "$t0" "$(date +%s%3N)" "$ex" >"$D/meta.json"
  node "$B/bench.mjs" judge "$D" 2>>"$D/judge.err" || echo "$cell $task#$k judge failed"
}
export -f one
xargs -P "$J" -d '\n' -I{} bash -c 'one "$1"' _ {} <<<"$RUNS"
echo; node "$B/bench.mjs" table "$OUTD" | tee "$OUTD/table.txt"
