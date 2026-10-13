#!/bin/bash
# Run a tier of cells (harness/cell.sh) in parallel containers and print the verdict table. See harness/README.md "Matrix".
#   harness/matrix.sh quick|milestone|full [-j N] [-n]      -n: print the cells and the estimate only.   env: SPIKE=<plugin checkout> (default this repo), FILTER=<regex on cell names>
# A cell: name | fixtures (base, then overlays) | scenario | env for tui.sh/cell.sh
H=$(cd "$(dirname "$0")" && pwd); TIER=${1:-quick}; shift; J=3; DRY=
while [ $# -gt 0 ]; do case $1 in -j) J=$2; shift;; -n) DRY=1;; esac; shift; done
quick() { cat <<'EOF'
user1-mono-clear-cd-retype|monorepo leftover|user1|MODEL=opus CC_VERSION=2.1.296
user2-nogit-lazy-interrupt|nogit|goal|MODEL=opus CC_VERSION=2.1.296 LAZY=1 FAULT=interrupt
leftover-pointer|single ready leftover|goal|MODEL=sonnet CC_VERSION=2.1.296
continue-after-quit|single ready|continue|MODEL=sonnet CC_VERSION=2.1.296 LANDED=1 BUDGET=1800 PROXY=1
single-295-sonnet|single|goal|MODEL=sonnet CC_VERSION=2.1.295
single-via-ccr|single|goal|MODEL=opus CC_VERSION=2.1.296 VIA=ccr
kill-mid-setup|nogit|kill|MODEL=sonnet CC_VERSION=2.1.296 FAULT=kill
EOF
}
milestone() { cat <<'EOF'
milestone-planners|single ready|milestone|MODEL=sonnet CC_VERSION=2.1.295 LANDED=1 BUDGET=2700 PROXY=1 EPIC_PLANNERS=2
EOF
}
full() {   # the cross product, minus cells that cannot exist (user1 needs kit/, continue needs a set-up repo)
  local f s m v via lz e
  for f in single monorepo nogit "single gitignore" "single legacy-beads" "single red" "single ready leftover" "monorepo red"; do
    for s in goal slow user1 continue; do
      [ $s = user1 ] && [[ $f != monorepo* ]] && continue; [ $s = continue ] && [[ $f != *ready* ]] && continue
      for m in haiku sonnet opus; do for v in 2.1.295 2.1.296; do for via in direct ccr; do for lz in 0 1; do
        e="MODEL=$m CC_VERSION=$v"; [ $via = ccr ] && e+=" VIA=ccr"; [ $lz = 1 ] && e+=" LAZY=1"; [ $s = continue ] && e+=" LANDED=1 BUDGET=1800"
        echo "${f// /+}-$s-$m-${v##*.}-$via$([ $lz = 1 ] && echo -lazy)|$f|$s|$e"
      done; done; done; done
    done
  done
}
CELLS=$($TIER | grep -E "^(${FILTER:-.*})\|" ) || { echo "no cells"; exit 2; }
n=$(wc -l <<<"$CELLS")
# estimate: US$ and minutes per cell by model, from the measured quick tier (README); a landed cell runs the whole plan (x4)
est() { awk -F'|' -v j="$J" '{ m = $4 ~ /opus/ ? "opus" : $4 ~ /sonnet/ ? "sonnet" : "haiku"; k = $4 ~ /LANDED/ ? 4 : 1
  usd += k * (m == "opus" ? 1.5 : m == "sonnet" ? 1.2 : 0.4); min += k * 8 }
  END { printf "%d cells · about US$%.0f · about %d min with -j %d (%d min serial)\n", NR, usd, min / j + 8, j, min }' <<<"$CELLS"; }
echo "tier $TIER · plugin ${SPIKE:-$(dirname "$H")} @ $(git -C "${SPIKE:-$(dirname "$H")}" rev-parse --short HEAD)"; est
[ -n "$DRY" ] && { cut -d'|' -f1,2,3,4 <<<"$CELLS" | column -t -s'|'; exit 0; }
RUN=$H/out/matrix/$TIER-$(date +%Y%m%d-%H%M%S); mkdir -p "$RUN"; echo "evidence: $RUN"
export H RUN
# each cell: its own container (tui name = cell name + run stamp), env from the 4th column
xargs -P "$J" -d '\n' -I{} bash -c 'IFS="|" read -r name fix scen envs <<<"$1"; env $envs OUT_DIR="$RUN/$name" "$H/cell.sh" "m$$-$name" "$fix" "$scen" >"$RUN/$name.line" 2>"$RUN/$name.err"; cat "$RUN/$name.line"' _ {} <<<"$CELLS"
echo; node -e '
const fs = require("fs"), run = process.argv[1], rows = []
for (const c of fs.readdirSync(run)) { if (!fs.existsSync(`${run}/${c}.line`)) continue; const f = `${run}/${c}/verdict.json`; if (!fs.existsSync(f)) { if (fs.statSync(`${run}/${c}`).isDirectory()) rows.push([c, "-", "NO VERDICT", "", "", "", "", ""]); continue }
  const v = JSON.parse(fs.readFileSync(f)), s = v.stats
  rows.push([c, v.pass ? "PASS" : "FAIL", v.pass ? "" : [...new Set(v.fails.map(f => f.invariant))].join(","), s.secsToPlan ?? "-", s.dialogs, s.turns, s.usd, Math.round(s.secs / 60), v.pass ? "" : v.fails[0].evidence.slice(0, 90)]) }
const head = ["cell", "verdict", "failing invariant", "s to plan", "dialogs", "turns", "US$", "min", "evidence"]
const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? "").length)))
for (const r of [head, ...rows]) console.log(r.map((x, i) => String(x ?? "").padEnd(w[i])).join(" | "))
const t = rows.reduce((a, r) => a + (+r[6] || 0), 0); console.log(`total US$ ${t.toFixed(2)} · ${rows.filter(r => r[1] === "PASS").length}/${rows.length} pass`)' "$RUN" | tee "$RUN/table.txt"
! grep -q 'FAIL\|NO VERDICT' "$RUN/table.txt"
