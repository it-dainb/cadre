#!/bin/bash
# Run a tier of cells (harness/cell.sh) in parallel containers and print the verdict table. See harness/README.md "Matrix".
#   harness/matrix.sh quick|milestone|clarify|cells|scripted|full [-j N] [-n]      -n: print the cells and the estimate only.   env: SPIKE=<plugin checkout> (default this repo), FILTER=<regex on cell names>
# A cell: name | fixtures (base, then overlays) | scenario | env for tui.sh/cell.sh/oracle.mjs. Env knobs of the matrix itself:
#   S=1: the scripted model (harness/scripted: a second plugin answers every model request; the stub proxy refuses any request it has no stub for, so
#        an S cell costs no quota and oracle.mjs fails it on any refused request). An S cell <name> and its L twin <name>-live in one run must agree.
#   KNOWN=<slice>: the cell checks a slice that has not landed; a FAIL of its own oracle (ORACLE=…, not-landed) shows as known:<slice> and does not
#   fail the run; any other invariant (zero-quota, errors, …) still fails it.
H=$(cd "$(dirname "$0")" && pwd); TIER=${1:-quick}; shift; J=3; DRY=
while [ $# -gt 0 ]; do case $1 in -j) J=$2; shift;; -n) DRY=1;; esac; shift; done
quick() { cat <<'EOF'
user1-mono-clear-cd-retype|monorepo leftover|user1|MODEL=haiku CC_VERSION=2.1.296
user2-nogit-lazy-interrupt|nogit|goal|MODEL=haiku CC_VERSION=2.1.296 LAZY=1 FAULT=interrupt
leftover-pointer|single ready leftover|goal|MODEL=haiku CC_VERSION=2.1.296
continue-after-quit|single ready|continue|MODEL=haiku CC_VERSION=2.1.296 LANDED=1 BUDGET=1800 PROXY=1
single-295|single|goal|MODEL=haiku CC_VERSION=2.1.295
single-via-ccr|single|goal|MODEL=haiku CC_VERSION=2.1.296 VIA=ccr
kill-mid-setup|nogit|kill|MODEL=haiku CC_VERSION=2.1.296 FAULT=kill
EOF
}
milestone() { cat <<'EOF'
milestone-planners|single ready|milestone|MODEL=haiku CC_VERSION=2.1.295 LANDED=1 BUDGET=2700 PROXY=1 EPIC_PLANNERS=2
EOF
}
clarify() { cat <<'EOF'
clarify-vague|single ready landing|vague|MODEL=haiku CC_VERSION=2.1.296 CLARIFY=ask BUDGET=300
clarify-yolo|single ready landing|vague-yolo|MODEL=haiku CC_VERSION=2.1.296 CLARIFY=assumed BUDGET=300
clarify-deep|single ready landing|deep|MODEL=haiku CC_VERSION=2.1.296 CLARIFY=deep ORACLE_DIALOGS=10 ORACLE_TURNS=20 BUDGET=420
clarify-clear|single ready|goal|MODEL=haiku CC_VERSION=2.1.296 CLARIFY=none BUDGET=300
EOF
}
# the 0.14 cells (plan §3.1 "Cells (0.14)"): S every commit (tier scripted = the S cells only), L once per Claude Code version (needs the user's OK)
cells() { cat <<'EOF'
exit-every-role|single ready scripted/full|every|MODEL=haiku CC_VERSION=2.1.295 S=1 PERM=auto LANDED=1 BUDGET=600 ORACLE=every
exit-every-role-live|single ready|every|MODEL=haiku CC_VERSION=2.1.295 PERM=auto LANDED=1 BUDGET=1800 PROXY=1 ORACLE=every ORACLE_ROLES=worker,reviewer
forced-exit|single ready scripted/loop|forced|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=420 ORACLE=forced
underscore-id|scripted/underscore|underscore|MODEL=haiku CC_VERSION=2.1.295 S=1 CWD=my_lib REPO=my_lib LANDED=1 BUDGET=600 ORACLE=underscore
usage-limit|single ready scripted/limit|limit|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=1260 ORACLE=limit
report-less-end|single ready scripted/silent|silent|MODEL=haiku CC_VERSION=2.1.295 S=1 BUDGET=420 ORACLE=noreport
dev-moved|single ready scripted/slow|devmoved|MODEL=haiku CC_VERSION=2.1.295 S=1 LANDED=1 BUDGET=600 ORACLE=devmoved
clear-bg-agents|single ready|clear|MODEL=haiku CC_VERSION=2.1.295 LANDED=1 BUDGET=1800 PROXY=1 ORACLE=clear
EOF
}
scripted() { cells | grep -E '(^|[| ])S=1( |$)'; }
full() {   # the cross product, minus cells that cannot exist (user1 needs kit/, continue needs a set-up repo)
  local f s v via lz e m=haiku
  for f in single monorepo nogit "single gitignore" "single legacy-beads" "single red" "single ready leftover" "monorepo red"; do
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
n=$(wc -l <<<"$CELLS")
# live runs are haiku only (H0): a cell naming any other model is refused; tui.sh also forces every subagent and pins every cadre route to haiku
bad=$(grep -vE 'MODEL=haiku( |$)' <<<"$CELLS") && { echo "not haiku:"; echo "$bad"; exit 2; }
# estimate: US$ and minutes per cell, from the measured quick tier (README); a landed cell runs the whole plan (x4)
est() { awk -F'|' -v j="$J" '{ k = $4 ~ /LANDED/ ? 4 : 1; usd += ($4 ~ /(^| )S=1( |$)/ ? 0 : k * 0.4); min += k * 8 }
  END { printf "%d cells · about US$%.0f · about %d min with -j %d (%d min serial)\n", NR, usd, min / j + 8, j, min }' <<<"$CELLS"; }
echo "tier $TIER · plugin ${SPIKE:-$(dirname "$H")} @ $(git -C "${SPIKE:-$(dirname "$H")}" rev-parse --short HEAD)"; est
[ -n "$DRY" ] && { echo "models: main --model haiku · subagents CLAUDE_CODE_SUBAGENT_MODEL=haiku (FORCE=1) · cadre routes (pins, ~/.claude/cadre.json): $("$H/tui.sh" pins | node -e 'const o=JSON.parse(require("fs").readFileSync(0)),m=new Set,w=x=>x&&typeof x=="object"&&(x.model&&m.add(x.model),Object.values(x).forEach(w));w(o);console.log([...m].join(",")+" ("+JSON.stringify(o).length+" B, "+(JSON.stringify(o).match(/\"model\"/g)||[]).length+" keys)")') · reviewer: forced by env (its keys refuse haiku)"; cut -d'|' -f1,2,3,4 <<<"$CELLS" | column -t -s'|'; exit 0; }
RUN=$H/out/matrix/$TIER-$(date +%Y%m%d-%H%M%S); mkdir -p "$RUN"; echo "evidence: $RUN"
export H RUN
# each cell: its own container (tui name = cell name + run stamp), env from the 4th column
xargs -P "$J" -d '\n' -I{} bash -c 'IFS="|" read -r name fix scen envs <<<"$1"; echo "$envs" >"$RUN/$name.env"
  case " $envs " in *" S=1 "*) export PROXY=1 PROXY_JS=harness/scripted/stub-proxy.mjs CLAUDE_ARGS="--plugin-dir /work/spike/harness/scripted" EXTRA_ENV="-e CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false";; esac
  env $envs OUT_DIR="$RUN/$name" "$H/cell.sh" "m$$-$name" "$fix" "$scen" >"$RUN/$name.line" 2>"$RUN/$name.err"; cat "$RUN/$name.line"' _ {} <<<"$CELLS"
echo; node -e '
const fs = require("fs"), run = process.argv[1], rows = []
for (const c of fs.readdirSync(run)) { if (!fs.existsSync(`${run}/${c}.line`)) continue; const f = `${run}/${c}/verdict.json`; if (!fs.existsSync(f)) { if (fs.statSync(`${run}/${c}`).isDirectory()) rows.push([c, "-", "NO VERDICT", "", "", "", "", ""]); continue }
  const v = JSON.parse(fs.readFileSync(f)), s = v.stats, envs = fs.readFileSync(`${run}/${c}.env`, "utf8"), own = ["not-landed", (envs.match(/(?:^| )ORACLE=(\S+)/) ?? [])[1]]
  const known = v.fails.every(f => own.includes(f.invariant)) && (envs.match(/(?:^| )KNOWN=(\S+)/) ?? [])[1]   // known masks only the cell own oracle and its landing, never a leak or an error
  rows.push([c, v.pass ? "PASS" : known ? `known:${known}` : "FAIL", v.pass ? "" : [...new Set(v.fails.map(f => f.invariant))].join(","), s.secsToPlan ?? "-", s.dialogs, s.turns, s.usd, Math.round(s.secs / 60), v.pass ? "" : v.fails[0].evidence.slice(0, 90)]) }
const head = ["cell", "verdict", "failing invariant", "s to plan", "dialogs", "turns", "US$", "min", "evidence"]
const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? "").length)))
for (const r of [head, ...rows]) console.log(r.map((x, i) => String(x ?? "").padEnd(w[i])).join(" | "))
for (const r of rows) { const twin = rows.find(x => x[0] === `${r[0]}-live`); if (twin && twin[1] !== "-" && r[1] !== "-" && (r[1] === "PASS") !== (twin[1] === "PASS")) console.log(`${r[0]} | FAIL | twin-disagree | S ${r[1]}, L ${twin[1]}`) }
const t = rows.reduce((a, r) => a + (+r[6] || 0), 0); console.log(`total US$ ${t.toFixed(2)} · ${rows.filter(r => r[1] === "PASS").length}/${rows.length} pass`)' "$RUN" | tee "$RUN/table.txt"
! grep -q 'FAIL\|NO VERDICT' "$RUN/table.txt"
