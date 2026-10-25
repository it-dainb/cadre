#!/bin/bash
# Run a tier of cells (harness/cell.sh) in parallel containers and print the verdict table. See harness/README.md "Matrix".
#   harness/matrix.sh quick|milestone|clarify|cells|release016|scripted|full [-j N] [-n]      -n: print the cells and the estimate only.   env: SPIKE=<plugin checkout> (default this repo), FILTER=<regex on cell names>
# A cell: name | fixtures (base, then overlays) | scenario | env for tui.sh/cell.sh/oracle.mjs. Env knobs of the matrix itself:
#   S=1: the scripted model (harness/scripted: a second plugin answers every model request; the stub proxy refuses any request it has no stub for, so
#        an S cell costs no quota and oracle.mjs fails it on any refused request). An S cell <name> and its L twin <name>-live in one run must agree.
#   CCV=<version>: every cell runs that Claude Code build instead of its own (the host's versions dir or harness/claude-<version>), e.g. CCV=2.1.310 harness/matrix.sh scripted
#   RUNS=N: the cell runs N times (evidence <name>.rK); its row is PASS only if every run passes; US$ and min are summed.
#   KNOWN=<slice>: the cell checks a slice that has not landed; a FAIL of its own oracle (ORACLE=…, not-landed) shows as known:<slice> and does not
#   fail the run; any other invariant (zero-quota, errors, …) still fails it.
H=$(cd "$(dirname "$0")" && pwd); TIER=${1:-quick}; shift; J=7; [ "$TIER" = scripted ] && J=6; DRY=   # scripted cells cost nothing: 6 at a time (measured under load 75: -j4 2m18, -j6 1m42, -j11 1m45)
while [ $# -gt 0 ]; do case $1 in -j) J=$2; shift;; -n) DRY=1;; esac; shift; done
quick() { cat <<'EOF'
user1-mono-clear-cd-retype|monorepo leftover|user1|MODEL=haiku CC_VERSION=2.1.299
user2-nogit-lazy-interrupt|nogit|goal|MODEL=haiku CC_VERSION=2.1.299 LAZY=1 FAULT=interrupt
leftover-pointer|single ready leftover|goal|MODEL=haiku CC_VERSION=2.1.299
continue-after-quit|single ready|continue|MODEL=haiku CC_VERSION=2.1.299 LANDED=1 BUDGET=1800 PROXY=1 RUNS=2
single-295|single|goal|MODEL=haiku CC_VERSION=2.1.295
single-via-ccr|single|goal|MODEL=haiku CC_VERSION=2.1.299 VIA=ccr
kill-mid-setup|nogit|kill|MODEL=haiku CC_VERSION=2.1.299 FAULT=kill
EOF
}
milestone() { cat <<'EOF'
milestone-planners|single ready|milestone|MODEL=haiku CC_VERSION=2.1.295 LANDED=1 BUDGET=2700 PROXY=1 EPIC_PLANNERS=2
EOF
}
clarify() { cat <<'EOF'
clarify-vague|single ready landing|vague|MODEL=haiku CC_VERSION=2.1.299 CLARIFY=ask BUDGET=300
clarify-yolo|single ready landing|vague-yolo|MODEL=haiku CC_VERSION=2.1.299 CLARIFY=assumed BUDGET=300
clarify-deep|single ready landing|deep|MODEL=haiku CC_VERSION=2.1.299 CLARIFY=deep ORACLE_DIALOGS=10 ORACLE_TURNS=20 BUDGET=420
clarify-clear|single ready|goal|MODEL=haiku CC_VERSION=2.1.299 CLARIFY=none BUDGET=300
EOF
}
# the 0.14 cells (plan §3.1 "Cells (0.14)"): S every commit (tier scripted = the S cells only), L once per Claude Code version (needs the user's OK)
cells() { cat <<'EOF'
exit-every-role|single ready scripted/full|every|MODEL=haiku CC_VERSION=2.1.295 S=1 PERM=auto LANDED=1 BUDGET=600 ORACLE=every
exit-every-role-live|single ready|every|MODEL=haiku CC_VERSION=2.1.295 PERM=auto LANDED=1 BUDGET=1800 PROXY=1 ORACLE=every ORACLE_ROLES=worker,reviewer
forced-exit|single ready scripted/loop|forced|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=420 ORACLE=forced
underscore-id|scripted/underscore|underscore|MODEL=haiku CC_VERSION=2.1.295 S=1 CWD=my_lib REPO=my_lib LANDED=1 BUDGET=600 ORACLE=underscore
# usage-limit is the one scripted cell over 60 s (~100 s): limits.limitWaitMinutes has a product floor of 1 min and a reported reset can only raise it
usage-limit|single ready scripted/limit|limit|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=600 ORACLE=limit
report-less-end|single ready scripted/silent|silent|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=420 ORACLE=noreport
shape-refusal-budget|single ready scripted/shape|shape|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=420 ORACLE=shape
dev-moved|single ready scripted/slow|devmoved|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=600 ORACLE=devmoved
clear-bg-agents|single ready|clear|MODEL=haiku CC_VERSION=2.1.295 LANDED=1 BUDGET=1800 PROXY=1 ORACLE=clear
# the 0.15 cells (plan "S cells named per slice"): S every commit
plan-tools-lite|single ready|plantools|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=600 ORACLE=plantools
plan-tools-full|single ready scripted/multi|plantools|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=900 ORACLE=plantools-full
tool-surface|single ready|surface|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=420 ORACLE=surface
submodule-unit|single ready scripted/submodule|submodule|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 LAND_RE=lib.to BUDGET=600 ORACLE=submodule
model-gate|single ready scripted/gate|gate|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=40 ORACLE=gate
concurrency-fifo|single ready scripted/fifo|fifo|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=150 ORACLE=fifo
continue-after-quit-s|single ready scripted/cont|contkill|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=600 ORACLE=continue
# the 0.16 cells
needs-explore|single ready scripted/needs|needs|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=150 ORACLE=needs-explore
lessons-pass|single ready|lessons|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=150 ORACLE=lessons
custom-role|single ready scripted/custom-role|custom-role|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=150 ORACLE=custom-role
planner-probe|single ready scripted/probe|probe|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=150 ORACLE=planner-probe EPIC_PLANNERS=1
# needs-setup-s: the setup path with the scripted model; npm installs ms from the real registry (no model, no quota)
needs-setup-s|single ready deps-node scripted/setup|needs-setup|MODEL=haiku CC_VERSION=2.1.295 S=1 DEPS=1 KIND=s ORACLE_DEP=ms LANDED=1 BUDGET=150 ORACLE=needs-setup
setup-stray-manifest|single ready deps-node scripted/stray|straymanifest|MODEL=haiku CC_VERSION=2.1.295 S=1 DEPS=1 KIND=s LANDED=1 BUDGET=150 ORACLE=straymanifest
EOF
}
# the 0.16 release gate (L, needs the user's OK; the quick tier runs apart): the two setup cells, the restart cell, exit-every-role live on 2.1.295 and on the newest build.
# The setup cells install from the real registry inside the container; DEPS=1 gives them the one-time approval and uv (tui.sh).
release016() {
  cat <<'EOF'
needs-setup-node|single ready deps-node|needs-setup|MODEL=haiku CC_VERSION=2.1.295 DEPS=1 KIND=node ORACLE_DEP=ms LANDED=1 BUDGET=900 PROXY=1 ORACLE=needs-setup
needs-setup-python|deps-py|needs-setup|MODEL=haiku CC_VERSION=2.1.295 DEPS=1 KIND=py ORACLE_DEP=six LANDED=1 BUDGET=900 PROXY=1 ORACLE=needs-setup
continue-after-quit|single ready|continue|MODEL=haiku CC_VERSION=2.1.299 LANDED=1 BUDGET=1800 PROXY=1 RUNS=2
EOF
  cells | grep '^exit-every-role-live|'
  cells | grep '^exit-every-role-live|' | sed -E 's/^exit-every-role-live\|/exit-every-role-live-new|/; s/CC_VERSION=[0-9.]+/CC_VERSION=2.1.310/'
}
scripted() { cells | grep -E '(^|[| ])S=1( |$)'; }
full() {   # the cross product, minus cells that cannot exist (user1 needs kit/, continue needs a set-up repo)
  local f s v via lz e m=haiku
  for f in single monorepo nogit "single gitignore" "single red" "single ready leftover" "monorepo red"; do
    for s in goal slow user1 continue; do
      [ $s = user1 ] && [[ $f != monorepo* ]] && continue; [ $s = continue ] && [[ $f != *ready* ]] && continue
      for v in 2.1.295 2.1.296; do for via in direct ccr; do for lz in 0 1; do
        e="MODEL=$m CC_VERSION=$v"; [ $via = ccr ] && e+=" VIA=ccr"; [ $lz = 1 ] && e+=" LAZY=1"; [ $s = continue ] && e+=" LANDED=1 BUDGET=1800"
        echo "${f// /+}-$s-$m-${v##*.}-$via$([ $lz = 1 ] && echo -lazy)|$f|$s|$e"
      done; done; done
    done
  done
}
CELLS=$($TIER | grep -E "^(${FILTER:-.*})\|" ) || { echo "no cells"; exit 2; }
[ -n "$CCV" ] && CELLS=$(sed -E "s/CC_VERSION=[0-9.]+/CC_VERSION=$CCV/" <<<"$CELLS")
# RUNS=N in a cell's env: N lines <name>.r1..rN (evidence dirs of their own); table.mjs folds them back into one row
CELLS=$(while IFS='|' read -r name fix scen envs; do r=1; [[ " $envs " =~ " RUNS="([0-9]+)" " ]] && r=${BASH_REMATCH[1]}; envs=$(sed -E 's/(^| )RUNS=[0-9]+//' <<<"$envs")
  for ((k = 1; k <= r; k++)); do echo "$name$([ "$r" -gt 1 ] && echo ".r$k")|$fix|$scen|$envs"; done; done <<<"$CELLS")
n=$(wc -l <<<"$CELLS")
# live runs are haiku only (H0): a cell naming any other model is refused; tui.sh also forces every subagent and pins every cadre route to haiku
bad=$(grep -vE 'MODEL=haiku( |$)' <<<"$CELLS") && { echo "not haiku:"; echo "$bad"; exit 2; }
# estimate: US$ and minutes per cell, from the measured quick tier (README); a landed cell runs the whole plan (x4)
est() { awk -F'|' -v j="$J" '{ s = $4 ~ /(^| )S=1( |$)/; k = s ? 1 : $4 ~ /LANDED/ ? 4 : 1; usd += (s ? 0 : k * 0.4); min += s ? 1 : k * 8; ns += s }   # an S cell costs no model and runs ~1 min (measured 24-49 s)
  END { printf "%d cells · about US$%.0f · about %d min with -j %d (%d min serial)\n", NR, usd, ns == NR ? (min + j - 1) / j : min / j + 8, j, min }' <<<"$CELLS"; }
echo "tier $TIER · plugin ${SPIKE:-$(dirname "$H")} @ $(git -C "${SPIKE:-$(dirname "$H")}" rev-parse --short HEAD)"; est
[ -n "$DRY" ] && { echo "models: main --model haiku · subagents CLAUDE_CODE_SUBAGENT_MODEL=haiku (FORCE=1) · cadre routes (pins, ~/.claude/cadre.json): $("$H/tui.sh" pins | node -e 'const o=JSON.parse(require("fs").readFileSync(0)),m=new Set,w=x=>x&&typeof x=="object"&&(x.model&&m.add(x.model),Object.values(x).forEach(w));w(o);console.log([...m].join(",")+" ("+JSON.stringify(o).length+" B, "+(JSON.stringify(o).match(/\"model\"/g)||[]).length+" keys)")') · reviewer: forced by env (its keys refuse haiku)"; cut -d'|' -f1,2,3,4 <<<"$CELLS" | column -t -s'|'; exit 0; }
RUN=$H/out/matrix/$TIER-$(date +%Y%m%d-%H%M%S); mkdir -p "$RUN"; echo "evidence: $RUN"
export H RUN
# each cell: its own container (tui name = cell name + run stamp), env from the 4th column
xargs -P "$J" -d '\n' -I{} bash -c 'IFS="|" read -r name fix scen envs <<<"$1"; echo "$envs" >"$RUN/$name.env"
  case " $envs " in *" S=1 "*) export PROXY=1 PROXY_JS=harness/scripted/stub-proxy.mjs CLAUDE_ARGS="--plugin-dir /work/spike/harness/scripted" EXTRA_ENV="-e CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false";; esac
  env $envs OUT_DIR="$RUN/$name" "$H/cell.sh" "m$$-$name" "$fix" "$scen" >"$RUN/$name.line" 2>"$RUN/$name.err"; cat "$RUN/$name.line"' _ {} <<<"$CELLS"
# no cell leaves a process behind (its watcher or watchdog): a leak is named, killed, and fails the run
LEFT=$(pgrep -f "cell.sh m$$-" || true)
echo; node "$H/table.mjs" "$RUN" | tee "$RUN/table.txt"
[ -n "$LEFT" ] && { echo "LEAK: cell processes alive after the run: $(echo $LEFT)" | tee -a "$RUN/table.txt"; kill $LEFT 2>/dev/null; }
! grep -q 'FAIL\|NO VERDICT\|LEAK' "$RUN/table.txt"
