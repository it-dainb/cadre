#!/bin/bash
# cadre CI: the budget table is the acceptance test.
#
# Fails the build on any regression. This is the only mechanism observed to
# resist re-bloat — slim kept a written non-goals ledger and still had to
# revert a hardware-display integration.
#
#   ./harness/ci.sh          unit + budgets (fast, no container)
#   ./harness/ci.sh --full   + fresh-install smoke test (needs docker + creds)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CADRE="$REPO/cadre"
FAIL=0

row() { # name actual ceiling
  local name=$1 actual=$2 ceiling=$3
  if [ "$actual" -le "$ceiling" ]; then
    printf '  %-42s %8s  <= %-8s ok\n' "$name" "$actual" "$ceiling"
  else
    printf '  %-42s %8s  >  %-8s FAIL\n' "$name" "$actual" "$ceiling"
    FAIL=1
  fi
}

# `claude plugin details` prints on-invoke figures like "~1.7k" or "~200".
# Normalize to a plain integer so row() can compare it against a ceiling.
tok_to_int() {
  local s=${1#\~}
  if [[ "$s" == *k ]]; then
    awk -v n="${s%k}" 'BEGIN{printf "%d", n*1000}'
  else
    echo "${s//,/}"
  fi
}

echo "== unit + hook contract =="
if node --test "$CADRE"/*.test.mjs >/tmp/cadre-tests.log 2>&1; then
  echo "  $(grep -oE '^# pass [0-9]+|pass [0-9]+' /tmp/cadre-tests.log | head -1) tests"
else
  echo "  FAIL — see /tmp/cadre-tests.log"; FAIL=1
fi

echo
echo "== static budgets =="

# CLAUDE.md ceiling (spec §6). Absent is fine; oversized is not.
if [ -f "$CADRE/CLAUDE.md" ]; then
  row "CLAUDE.md bytes" "$(wc -c < "$CADRE/CLAUDE.md")" 1500
else
  printf '  %-42s %8s\n' "CLAUDE.md bytes" "absent"
fi

# Reviewer must carry zero MCP tools (spec §6).
REVIEWER_MCP=$(grep -c 'mcp__' "$CADRE/agents/reviewer.md" || true)
row "reviewer MCP tools" "$REVIEWER_MCP" 0

# Every agent must declare tools: — omitting it inherits the full pool, which
# is the entire cost defect cadre exists to fix.
UNSCOPED=$(for f in "$CADRE"/agents/*.md; do grep -q '^tools:' "$f" || echo "$f"; done | wc -l)
row "agents without a tools: line" "$UNSCOPED" 0

# No PostToolUse anywhere: its additionalContext persists into transcript
# history and is paid on every later turn.
POSTTOOL=$(grep -c 'PostToolUse' "$CADRE/hooks/hooks.json" || true)
row "PostToolUse hooks" "$POSTTOOL" 0

# NOT checked statically: "hooks must deny, not nudge". A grep for
# additionalContext cannot tell code from a comment saying the hook never
# emits one — it flagged write-gate.mjs for exactly that. The behaviour is
# asserted where it belongs, by tests that actually run the hooks and inspect
# their output.

# Spec commits to exactly four hook events. A missing one is how UserPromptSubmit
# went absent for six phases without anything noticing.
HOOK_EVENTS=$(node -e "const h=require('$CADRE/hooks/hooks.json').hooks; console.log(Object.keys(h).sort().join(','))" 2>/dev/null || echo "ERROR")
if [ "$HOOK_EVENTS" = "PreToolUse,SessionStart,Stop,UserPromptSubmit" ]; then
  printf '  %-42s %8s  ok\n' "hook events (4, exact)" "present"
else
  printf '  %-42s %8s  FAIL\n' "hook events (4, exact)" "$HOOK_EVENTS"
  FAIL=1
fi

# The budgeter must be reachable from a hook, not just from its own tests.
# A well-tested module nothing calls is gen2's failure mode with better coverage.
if grep -q "budget.mjs" "$CADRE"/hooks/*.mjs 2>/dev/null; then
  printf '  %-42s %8s  ok\n' "budgeter wired to a hook" "yes"
else
  printf '  %-42s %8s  FAIL\n' "budgeter wired to a hook" "no"
  FAIL=1
fi

# Every .mjs must be imported by something other than its own test.
DEAD=$(for f in "$CADRE"/*.mjs; do
  b=$(basename "$f")
  case "$b" in *.test.mjs) continue;; esac
  if ! grep -rq "from '\.\./$b'\|from '\./$b'" "$CADRE"/hooks/*.mjs "$CADRE"/*.mjs 2>/dev/null; then echo "$b"; fi
done | wc -l)
row "modules reachable only from tests" "$DEAD" 0

# hooks/hooks.json is loaded by convention. Declaring it in the manifest too
# registers it twice and the plugin refuses to load — it still installs, so
# only a load-status check catches it. Shipped that way in 1.0.0.
DUP=$(python3 -c "
import json
h = json.load(open('$CADRE/.claude-plugin/plugin.json')).get('hooks')
paths = [h] if isinstance(h, str) else (h or [])
print(sum(1 for p in paths if str(p).lstrip('./') == 'hooks/hooks.json'))
" 2>/dev/null || echo 1)
row "manifest re-declares auto-loaded hooks" "$DUP" 0

# harness/bench/run.sh's SESSION_ENV must carry these exact var names — matched
# by name, not by count, since counting `-e` flags passes even when every name
# is wrong. This matters because a typo doesn't fail loudly: an invalid
# CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is silently dropped by parseFloat and an
# invalid CLAUDE_CODE_AUTO_COMPACT_WINDOW silently falls back to 100,000 — so a
# misspelled var produces a run that looks like a clean treatment arm but is
# actually a baseline.
#
# Matched as `-e NAME=`, not as a bare name. A bare-name grep is satisfied by a
# comment: gutting the array to `-e WRONG_WINDOW=...` while leaving the real
# name in a nearby comment kept this row green with both vars actually wrong —
# demonstrated, not hypothesised. Only the flag form proves the name is wired.
RUN_SH="$REPO/harness/bench/run.sh"

# Every check below reads this comment-stripped copy, never the file directly.
# All three of these rows were originally defeated the same way: delete the
# real code, leave the string in a comment, stay green. Patching each row's
# pattern only fixes the instance — stripping comments once fixes the class.
RUN_SRC=$(sed 's/[[:space:]]#.*$//; /^[[:space:]]*#/d' "$RUN_SH")

MISSING_ENV=0
for v in ANTHROPIC_DEFAULT_OPUS_MODEL CLAUDE_CODE_EFFORT_LEVEL CLAUDE_CODE_AUTO_COMPACT_WINDOW CLAUDE_AUTOCOMPACT_PCT_OVERRIDE; do
  echo "$RUN_SRC" | grep -q -- "-e $v=" || MISSING_ENV=$((MISSING_ENV + 1))
done
row "run.sh missing canonical env var names" "$MISSING_ENV" 0

# SESSION_ENV was renamed from MODEL_ENV — a later edit reverting the rename
# should not pass silently.
OLD_NAME=$(echo "$RUN_SRC" | grep -c 'MODEL_ENV' || true)
row "run.sh still references old MODEL_ENV name" "$OLD_NAME" 0

# The var names existing isn't enough — run.sh must also record which
# compaction settings produced each result. A results row with no env block
# can't be compared against another one later, and the failure is silent
# (parseFloat drops a bad PCT_OVERRIDE, a bad AUTO_COMPACT_WINDOW falls back
# to 100000), so the row is the only place the intended value survives.
PY_INVOKE=$(echo "$RUN_SRC" | awk '/^  python3 -/,/<<.PY./')
ARGV_MISSING=0
for v in COMPACT_WINDOW COMPACT_PCT DISABLE_AUTO_COMPACT; do
  # `${VAR` — the expansion, not the bare name. Passing `"" "" ""` with the
  # names parked in a trailing comment satisfied a bare-name grep even after
  # the values stopped being forwarded.
  echo "$PY_INVOKE" | grep -q '\${'"$v" || ARGV_MISSING=$((ARGV_MISSING + 1))
done
row "run.sh python3 argv missing compaction vars" "$ARGV_MISSING" 0
row "run.sh missing row[\"env\"] assignment" \
  "$(echo "$RUN_SRC" | grep -q 'row\["env"\] *=' && echo 0 || echo 1)" 0

# Phase 0 instrumentation fixes (deep-interview-cadre-cost-context-v4 rollup):
# a results row that names its own arm ("vanilla") but hides its treatment
# only in `env` reads as blind to the manipulation in any group-by-arm
# analysis — this is exactly how the long-context experiment's arm means
# inverted sign. `condition` must be assigned directly off the compaction
# env vars, not merely mentioned.
# A single generic grep for `row["condition"] =` passes as long as ONE of
# the three branches (disabled / windowed / default) still assigns it — the
# other two could be silently deleted and this would stay green. Each branch
# checked by its own distinguishing literal.
# The three branches now live in the shell helper `condition_slug`, because
# the run directory path needs the same label the row carries — see the
# transcript-overwrite guard below. Still checked branch-by-branch: a single
# generic grep passes while two of the three are silently deleted.
COND_MISSING=0
echo "$RUN_SRC" | grep -q 'echo "compact-disabled"' || COND_MISSING=$((COND_MISSING + 1))
echo "$RUN_SRC" | grep -q 'echo "compact-w\${COMPACT_WINDOW' || COND_MISSING=$((COND_MISSING + 1))
echo "$RUN_SRC" | grep -q 'echo "compact-default"' || COND_MISSING=$((COND_MISSING + 1))
row "run.sh missing condition_slug branch (of 3)" "$COND_MISSING" 0

# The slug is only meaningful if it reaches the row. Checked separately from
# the branch count so deleting the plumbing cannot be masked by intact branches.
row "run.sh never passes condition_slug to the row builder" \
  "$(echo "$RUN_SRC" | grep -q '"\$(condition_slug)"' && echo 0 || echo 1)" 0

# A cadre-work/cadre-auto trial that never engaged the loop is the always-on
# tax measured as if it were orchestration — Experiment B spent $5.62 on nine
# such trials before anyone checked. This must be a hard abort (return before
# verify.sh runs), not merely a check for the word "engaged" existing
# somewhere in the file — hence: assert on `return` in the same conditional
# block as the read, not just their co-occurrence anywhere in the source.
#
# Signal is trace.py's `engaged` (a subagent transcript existing at all —
# true for cadre's default doer-only rung, which never writes
# .cadre/tasks/<id>/), not a grep for the literal word "tasks" in
# cadre-state.txt. That earlier version read cadre's own most common,
# cheapest path as a harness error 5/5 times on a real run before this fix —
# see doer.md ("no worktree, no spec file, no handoff") and
# work/SKILL.md ("most tasks end at step 1"). Anchored on the unique
# `trace-summary.json` read rather than a bare grep for "engaged", since that
# word alone would still match the reverted cadre-state.txt version too.
ENGAGE_BLOCK=$(echo "$RUN_SRC" | grep -A4 -- "trace-summary.json')).get('engaged'")
ENGAGE_OK=1
if echo "$RUN_SRC" | grep -q -- "trace-summary.json')).get('engaged'" && echo "$ENGAGE_BLOCK" | grep -q 'return'; then
  ENGAGE_OK=0
fi
row "run.sh engagement precondition missing read+abort" "$ENGAGE_OK" 0

# The old .cadre/tasks/ grep must actually be gone from the engagement
# decision, not just supplemented — a version that OR's both signals together
# would still read as "fixed" by the check above alone.
row "run.sh still gates engagement on .cadre/tasks grep" \
  "$(echo "$RUN_SRC" | grep -q -- '-q tasks ' && echo 1 || echo 0)" 0

# trace.py's engaged field must be derived from subagent session presence,
# not from re-deriving a task-dir check in Python — falsified by breaking the
# `startswith('subagent:')` line and confirming this goes RED.
row "trace.py engaged field not derived from subagent session presence" \
  "$(grep -q "engaged'\] = any(name.startswith('subagent:')" "$REPO/harness/bench/trace.py" && echo 0 || echo 1)" 0

# peak_ctx / boundary count must be pulled into the row via trace.py, not
# left recoverable only by re-running trace.py by hand against each rundir
# after the fact.
row "run.sh missing trace.py --summary-json call" \
  "$(echo "$RUN_SRC" | grep -q -- '--summary-json' && echo 0 || echo 1)" 0

TRACE_SRC="$REPO/harness/bench/trace.py"
row "trace.py missing summarize() function" \
  "$(grep -q '^def summarize(' "$TRACE_SRC" && echo 0 || echo 1)" 0

# Two conditions run into one BENCH_OUT reuse trial numbers 1..N. Without the
# condition in the run directory path, the second run overwrites the first
# run's transcripts while its rows keep appending to results.jsonl — 25 rows
# against 5 transcript dirs, with no error anywhere. Any later analysis that
# opens those transcripts then silently reads a different condition than the
# row says.
row "run.sh rundir path missing condition (transcripts overwrite across conditions)" \
  "$(echo "$RUN_SRC" | grep -qE 'rundir=.*condition_slug' && echo 0 || echo 1)" 0

# The path label and the row label must come from one derivation. If the row
# builder recomputes it, the two can disagree and rows stop joining to their
# own transcripts — the failure this whole guard exists to prevent.
row "run.sh row builder recomputes condition instead of using the path's slug" \
  "$(echo "$RUN_SRC" | grep -q 'row\["condition"\] = condition_slug' && echo 0 || echo 1)" 0

# code-context exists to measure post-compaction behaviour on a CODE workload,
# which requires the agent to actually read ~57k tokens of modules. If the
# migration is scriptable the agent never reads, peak_ctx stays at ~25k, no
# boundary fires, and every trial is void — the exact way long-context v1 died
# when the agent recovered the generator formula instead of reading.
#
# Behavioural, not a grep: run the two attacks that have already defeated a
# draft of this fixture and require both to fail, then require the read-the-doc
# solve to pass. A grep for "shared pool" would stay green against a fixture
# that had regressed to being solvable some other way.
CC_DIR=$(mktemp -d)
CC_KEY=$(mktemp)
if CODE_CONTEXT_ANSWER_KEY="$CC_KEY" \
   bash "$REPO/harness/bench/tasks/code-context/setup.sh" "$CC_DIR" >/dev/null 2>&1; then
  export CODE_CONTEXT_ANSWER_KEY="$CC_KEY"
  cat > "$CC_DIR/attack.mjs" <<'ATKEOF'
// argv[2] = 'positional' | 'semantic'
//
// 'semantic' stands in for the intended solution — an agent that reads what
// each constant is documented to mean. It applies the generator's answer key
// rather than matching authored phrases, because hardcoding 51 sentences here
// would break the moment one is reworded and would report a REWORDING as an
// unsolvable fixture. The key comes from CODE_CONTEXT_ANSWER_KEY, which only
// CI ever sets.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const mode = process.argv[2];
const KEY = mode === 'semantic'
  ? JSON.parse(readFileSync(process.env.CODE_CONTEXT_ANSWER_KEY, 'utf8'))
  : null;
for (const f of readdirSync('src/modules')) {
  const p = `src/modules/${f}`;
  const name = f.replace(/\.mjs$/, '');
  let s = readFileSync(p, 'utf8');
  let at = null;
  if (mode === 'positional') {
    // "the last 13-digit const before the export" — killed by shuffling decls.
    const ms = [...s.matchAll(/const (\w+) = (\d{13});/g)];
    at = ms.length ? ms[ms.length - 1][1] : null;
  } else {
    at = KEY[name];
  }
  if (at === null || at === undefined) continue;
  s = s.replace('import { logMsg }', 'import { emit }');
  s = s.replace(/return logMsg\('(\w+)', (.+)\);/,
    (_, l, t) => `return emit({ level: '${l}', text: ${t}, at: ${at} });`);
  writeFileSync(p, s);
}
ATKEOF
  cc_try() {
    local mode=$1 work="$CC_DIR-$1"
    rm -rf "$work"; cp -r "$CC_DIR" "$work"
    ( cd "$work" && node attack.mjs "$mode" >/dev/null 2>&1 \
      && node test.mjs 2>&1 | grep -q PASS ) && echo 1 || echo 0
  }
  # Must be 0: a scriptable fixture measures nothing.
  row "code-context solvable by positional attack (no reading required)" "$(cc_try positional)" 0
  # Must be 1: an unsolvable fixture measures nothing either.
  row "code-context NOT solvable by reading the docs (fixture is broken)" \
    "$(( 1 - $(cc_try semantic) ))" 0
  # A per-module digest is invertible against the ~8 candidates per file, which
  # is a complete no-read solution. Only the aggregate may appear.
  row "code-context test.mjs exposes per-module digests" \
    "$(grep -q 'const DIGESTS' "$CC_DIR/test.mjs" && echo 1 || echo 0)" 0

  # Attack 3, generalised. A measured pilot solved every module with
  # /evictExpired\((\w+)\)/ because the answer was the only constant passed to a
  # function. Any asymmetry in HOW a timestamp is referenced is the same leak,
  # so require every one to appear exactly twice: its declaration and its entry
  # in the uniform Clocks export. Appearing once would be just as bad — an
  # unused constant is itself the tell.
  # Heredoc, not `node -e '...'`: backslash escapes inside a single-quoted -e
  # survive into the JS source mangled, and the resulting regex matched nothing
  # and scored every constant as a leak. Same escaping class that has produced a
  # spurious GREEN here before.
  cat > "$CC_DIR/symmetry.mjs" <<'SYMEOF'
import { readdirSync, readFileSync } from 'node:fs';
let bad = 0;
for (const f of readdirSync('src/modules')) {
  const s = readFileSync(`src/modules/${f}`, 'utf8');
  const body = s.replace(/^\s*\/\/.*$/gm, '');
  for (const m of s.matchAll(/^const (\w+) = \d{13};/gm)) {
    const hits = [...body.matchAll(new RegExp(`\\b${m[1]}\\b`, 'g'))].length;
    if (hits !== 2) bad += 1;
  }
}
console.log(bad);
SYMEOF
  row "code-context timestamp referenced asymmetrically (structural tell)" \
    "$(cd "$CC_DIR" && node symmetry.mjs)" 0
  # The attack that actually defeated this fixture in a measured n=5 run: the
  # agent read three modules, recovered the full set of answer phrasings, and
  # matched the rest with wildcard regexes. peak_ctx fell 45k -> 31k and 4 of 5
  # trials stopped crossing the trigger. The defence is that every module's
  # answer sentence is structurally distinct, so a sample generalises to
  # nothing — which holds only if they really are all distinct. REAL_DOC's
  # length assert does not cover this: indexing the pool wrongly (REAL_DOC[0],
  # or pick()) keeps the pool large while collapsing what is emitted.
  cat > "$CC_DIR/distinct.mjs" <<'DISTEOF'
import { readdirSync, readFileSync } from 'node:fs';
const key = JSON.parse(readFileSync(process.env.CODE_CONTEXT_ANSWER_KEY, 'utf8'));
const seen = new Set();
let n = 0;
for (const f of readdirSync('src/modules')) {
  const name = f.replace(/\.mjs$/, '');
  const src = readFileSync(`src/modules/${f}`, 'utf8');
  for (const m of src.matchAll(/((?:^\/\/.*\n)+)const (\w+) = (\d{13});/gm)) {
    if (Number(m[3]) !== key[name]) continue;      // decoy, ignore
    // Blank the variable name so two identical sentences differing only by
    // which constant they describe still count as one phrasing.
    seen.add(m[1].replace(/\/\//g, '').replace(/\s+/g, ' ').replace(m[2], 'VAR').trim());
    n += 1;
  }
}
console.log(n - seen.size);   // 0 when every module's answer sentence is unique
DISTEOF
  row "code-context reuses an answer phrasing across modules" \
    "$(cd "$CC_DIR" && node distinct.mjs)" 0

  # The answer key must exist ONLY when CI asks for it and ONLY outside the
  # project tree. A key generated by default, or written under $root, would ship
  # a complete no-read solution inside the fixture the agent is handed.
  CC_CLEAN=$(mktemp -d)
  unset CODE_CONTEXT_ANSWER_KEY
  bash "$REPO/harness/bench/tasks/code-context/setup.sh" "$CC_CLEAN" >/dev/null 2>&1
  row "code-context ships an answer key inside the project tree" \
    "$(grep -rlE '"(auth|billing|cache)": *17[0-9]{11}' "$CC_CLEAN" 2>/dev/null | wc -l)" 0
  rm -rf "$CC_DIR" "$CC_DIR-positional" "$CC_DIR-semantic" "$CC_CLEAN" "$CC_KEY"
else
  echo "  FAIL — code-context setup.sh did not run"; FAIL=1
fi

REPORT_SRC="$REPO/harness/bench/report.py"
row "report.py missing per-cell n/median/CV breakdown" \
  "$(grep -q 'UNDERPOWERED (n<3)' "$REPORT_SRC" && echo 0 || echo 1)" 0

# Compaction runs vary `condition` while holding `arm` fixed, so a report that
# groups on arm alone averages control together with treatment and prints the
# midpoint as a result — the failure is silent and looks like a small effect.
# Behavioural, not a grep: feed it two conditions and require two distinct rows
# with the two distinct costs, which a pooling implementation cannot produce.
COND_FIX=$(mktemp); COND_OUT=$(mktemp)
python3 - "$COND_FIX" <<'PYEOF'
import json, sys
rows = []
for i in range(5):
    rows.append({"task":"t","arm":"vanilla","trial":i,"status":"pass",
                 "condition":"ctl","cost_usd":0.10,"num_turns":5,"boundaries":0})
    rows.append({"task":"t","arm":"vanilla","trial":i,"status":"pass",
                 "condition":"trt","cost_usd":0.40,"num_turns":7,"boundaries":2})
open(sys.argv[1], "w").write("\n".join(json.dumps(r) for r in rows))
PYEOF
python3 "$REPORT_SRC" "$COND_FIX" >"$COND_OUT" 2>&1 || true
COND_OK=1
if grep -q 'vanilla/ctl' "$COND_OUT" && grep -q 'vanilla/trt' "$COND_OUT" \
   && grep -q '\$0\.1000' "$COND_OUT" && grep -q '\$0\.4000' "$COND_OUT"; then
  COND_OK=0
fi
row "report.py pools distinct conditions into one arm row" "$COND_OK" 0

# The boundary count is the manipulation check for every compaction trial — an
# out-of-range window is silently replaced rather than rejected, so a broken
# treatment reports boundaries=0 and reads as a genuine null. It has to reach
# the per-cell table or nobody sees the manipulation failed.
row "report.py per-cell table missing boundary (bnd) column" \
  "$(grep -q "'bnd':>5" "$REPORT_SRC" && echo 0 || echo 1)" 0

# An autocompact-thrash abort selects against the expensive, context-heavy
# runs, so the surviving trials in the failing condition are biased low and a
# ratio computed over them understates the damage. The hard case is a task
# wiped out completely in one condition: it leaves no cell at all, so a naive
# check over observed cells scores the total wipeout as balanced. Fixture
# encodes exactly that (5-vs-3 partial AND 5-vs-0 wipeout).
SKEW_FIX=$(mktemp); SKEW_OUT=$(mktemp)
python3 - "$SKEW_FIX" <<'PYEOF'
import json, sys
rows = []
for i in range(5):
    rows.append({"task":"partial","arm":"v","trial":i,"status":"pass",
                 "condition":"ctl","cost_usd":0.10,"num_turns":5,"boundaries":0})
    rows.append({"task":"wipeout","arm":"v","trial":i,"status":"pass",
                 "condition":"ctl","cost_usd":0.10,"num_turns":5,"boundaries":0})
    # partial: 3 survive, 2 abort. wipeout: all 5 abort, leaving no cell.
    rows.append({"task":"partial","arm":"v","trial":i,
                 "status":"pass" if i < 3 else "harness_error",
                 "condition":"trt","cost_usd":0.40,"num_turns":7,"boundaries":2})
    rows.append({"task":"wipeout","arm":"v","trial":i,"status":"harness_error",
                 "condition":"trt","cost_usd":0.70,"num_turns":9,"boundaries":3})
open(sys.argv[1], "w").write("\n".join(json.dumps(r) for r in rows))
PYEOF
python3 "$REPORT_SRC" "$SKEW_FIX" >"$SKEW_OUT" 2>&1 || true
SKEW_OK=1
if grep -q 'UNEQUAL VALID-N' "$SKEW_OUT" \
   && grep -qE 'partial:.*=3' "$SKEW_OUT" && grep -qE 'wipeout:.*=0' "$SKEW_OUT"; then
  SKEW_OK=0
fi
row "report.py misses survivor bias from aborted trials" "$SKEW_OK" 0
rm -f "$COND_FIX" "$COND_OUT" "$SKEW_FIX" "$SKEW_OUT"

echo
if [ "${1:-}" = "--full" ]; then
  echo "== fresh-install smoke test =="
  # agent-hive shipped a plugin that passed every automated check and would
  # not install. The only check that catches that is a real install.
  if PLUGIN_DIR="$CADRE" PLUGIN_ID=cadre@cadre "$REPO/harness/measure.sh" >/tmp/cadre-measure.log 2>&1; then
    TOK=$(grep -oE 'Always-on:[[:space:]]+~?([0-9,]+) tok' /tmp/cadre-measure.log | grep -oE '[0-9,]+' | tr -d ,)
    if [ -n "$TOK" ]; then
      row "always-on tokens (fresh install)" "$TOK" 1000
    else
      echo "  FAIL — could not read always-on from a fresh install"; FAIL=1
    fi

    # A number that only holds once isn't a budget, it's a coincidence. An
    # always-on block that varies between installs can't be cached across
    # sessions, and the whole cost model assumes it is byte-stable — so a
    # second fresh install must report the exact same token count, not
    # merely a close one. Blind spot: `claude plugin details`' always-on
    # figure tracks each component's catalog `description:` line, not full
    # file bytes, so this row won't catch an always-on file whose body grows
    # without its description changing.
    if PLUGIN_DIR="$CADRE" PLUGIN_ID=cadre@cadre "$REPO/harness/measure.sh" >/tmp/cadre-measure2.log 2>&1; then
      TOK2=$(grep -oE 'Always-on:[[:space:]]+~?([0-9,]+) tok' /tmp/cadre-measure2.log | grep -oE '[0-9,]+' | tr -d ,)
      if [ -n "$TOK2" ]; then
        row "always-on tokens (stable across 2 installs)" "$(( TOK > TOK2 ? TOK - TOK2 : TOK2 - TOK ))" 0
      else
        echo "  FAIL — could not read always-on from the second fresh install"; FAIL=1
      fi
    else
      echo "  FAIL — plugin did not install on second run; see /tmp/cadre-measure2.log"; FAIL=1
    fi

    # cadre/skills/work/SKILL.md, read off the same `claude plugin details`
    # on-invoke figure measure.sh already captured above — not a local
    # character-count estimate, which would pass even if the real
    # measurement had bloated past ceiling.
    WORK_ONINVOKE=$(grep -E '^  work[[:space:]]' /tmp/cadre-measure.log | awk '{print $NF}')
    if [ -n "$WORK_ONINVOKE" ]; then
      row "work skill on-invoke tokens" "$(tok_to_int "$WORK_ONINVOKE")" 5000
    else
      echo "  FAIL — could not read work skill on-invoke tokens"; FAIL=1
    fi
  else
    echo "  FAIL — plugin did not install; see /tmp/cadre-measure.log"; FAIL=1
  fi
  echo
fi

[ "$FAIL" -eq 0 ] && echo "BUDGETS GREEN" || echo "BUDGETS RED"
exit "$FAIL"
