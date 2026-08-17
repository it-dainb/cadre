#!/bin/bash
# Three-arm pilot: vanilla CC vs CC+OMC vs CC+cadre.
#
# One container per (task, arm, trial). Fresh worktree, fresh .claude state.
# Measures cost from the CLI's own JSON, and pass/fail from the task's verify.sh.
#
# Harness errors are recorded as status=harness_error, NOT as task failures —
# conflating the two is how a broken runner reads as a weak arm.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TASKS_DIR=$ROOT/harness/bench/tasks
OUT=${BENCH_OUT:-$ROOT/.omc/bench}
TRIALS=${TRIALS:-1}
ARMS=${ARMS:-vanilla omc cadre}
TASKS=${TASKS:-$(ls "$TASKS_DIR")}
MAX_TURNS=${MAX_TURNS:-60}
TIMEOUT=${TIMEOUT:-900}

# Session env is held constant across arms by default. It is not the variable
# under test; the plugin is. Mirrors the user's ~/.claude/settings.json. The
# compaction pair is overridable so it can itself be A/B'd without editing
# this file.
SESSION_ENV=(
  -e ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5
  -e CLAUDE_CODE_EFFORT_LEVEL="${EFFORT:-medium}"
)
if [ -n "${COMPACT_WINDOW:-}" ]; then
  SESSION_ENV+=(-e CLAUDE_CODE_AUTO_COMPACT_WINDOW="$COMPACT_WINDOW")
fi
if [ -n "${COMPACT_PCT:-}" ]; then
  SESSION_ENV+=(-e CLAUDE_AUTOCOMPACT_PCT_OVERRIDE="$COMPACT_PCT")
fi
if [ -n "${DISABLE_AUTO_COMPACT:-}" ]; then
  SESSION_ENV+=(-e DISABLE_AUTO_COMPACT="$DISABLE_AUTO_COMPACT")
fi

mkdir -p "$OUT"
RESULTS=$OUT/results.jsonl

install_arm() {
  local c=$1 arm=$2
  case $arm in
    vanilla|sonnet|haiku) return 0 ;;
    cadre|cadre-work|cadre-auto)
      docker exec "$c" bash -c "claude plugin marketplace add /plugins/cadre >/dev/null 2>&1 && claude plugin install cadre@cadre >/dev/null 2>&1" ;;
    omc)
      docker exec "$c" bash -c "claude plugin marketplace add /plugins/omc >/dev/null 2>&1 && claude plugin install oh-my-claudecode@omc >/dev/null 2>&1" ;;
  esac
}

# Single source of truth for the condition label: the run directory path and
# the `condition` field in results.jsonl must agree, or rows and transcripts
# cannot be joined back together. Derived here in shell and passed to the row
# builder rather than computed in both places.
condition_slug() {
  if [ -n "${DISABLE_AUTO_COMPACT:-}" ]; then
    echo "compact-disabled"
  elif [ -n "${COMPACT_WINDOW:-}" ] || [ -n "${COMPACT_PCT:-}" ]; then
    echo "compact-w${COMPACT_WINDOW:-default}-p${COMPACT_PCT:-default}"
  else
    echo "compact-default"
  fi
}

run_one() {
  local task=$1 arm=$2 trial=$3
  local c="bench-$task-$arm-$trial"
  local w; w=$(mktemp -d); chmod 777 "$w"
  # The condition MUST be in the path. Without it, running a second condition
  # into the same BENCH_OUT reuses trial numbers 1..N and silently overwrites
  # the previous condition's transcripts while its rows keep accumulating in
  # results.jsonl. That desync is invisible and destroys the evidence: vanilla
  # ended a session with 25 rows and 5 transcript dirs, all belonging to the
  # last condition written, which made a lead-vs-subagent context comparison
  # read across conditions and produce a confounded 1.24x.
  local rundir="$OUT/$task/$arm/$(condition_slug)/$trial"
  mkdir -p "$rundir"

  docker rm -f "$c" >/dev/null 2>&1
  docker run -d --name "$c" \
    -v /home/it-dainb/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro \
    -v "$ROOT/src:/plugins/cadre:ro" \
    -v "$ROOT/refs/oh-my-claudecode:/plugins/omc:ro" \
    -v "$w:/project" \
    "${SESSION_ENV[@]}" \
    cadre-harness:latest -c "sleep infinity" >/dev/null || { emit "$task" "$arm" "$trial" harness_error 0 "docker run failed"; return; }

  docker exec "$c" /usr/local/bin/seed.sh >/dev/null 2>&1

  bash "$TASKS_DIR/$task/setup.sh" "$w" || { emit "$task" "$arm" "$trial" harness_error 0 "setup failed"; docker rm -f "$c" >/dev/null; return; }
  docker exec "$c" bash -c 'cd /project && git init -q 2>/dev/null; git add -A 2>/dev/null; git -c user.email=b@b -c user.name=b commit -qm base 2>/dev/null' >/dev/null 2>&1

  install_arm "$c" "$arm"
  docker exec "$c" bash -c "claude plugin list 2>/dev/null" > "$rundir/plugins.txt" 2>&1

  # A plugin that installs but fails to load makes this arm silently identical
  # to vanilla — a null result that reads as a real one. Refuse to run it.
  case $arm in vanilla|sonnet|haiku) needs_plugin=no ;; *) needs_plugin=yes ;; esac
  if [ "$needs_plugin" = yes ]; then
    # ANSI-stripped: the status glyph is colourised.
    if ! sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$rundir/plugins.txt" | grep -qE 'Status:.*enabled'; then
      emit "$task" "$arm" "$trial" harness_error 0 "plugin not enabled: $(grep -o 'Error:.*' "$rundir/plugins.txt" | head -1)"
      docker rm -f "$c" >/dev/null 2>&1; rm -rf "$w"; return
    fi
  fi

  local prompt; prompt=$(python3 -c "import json;print(json.load(open('$TASKS_DIR/$task/task.json'))['prompt'])")

  # `cadre` measures the plugin installed and left to trigger on its own.
  # `cadre-work` measures the orchestration actually running.
  #
  # These are different questions and the first one nearly fooled us: with a
  # plain prompt, 8 of 10 cadre runs never spawned a worker and never wrote
  # .cadre/ state, so that arm was plain Claude Code plus the always-on tax,
  # sitting at parity with vanilla for the least interesting reason possible.
  if [ "$arm" = cadre-work ] || [ "$arm" = cadre-auto ]; then
    prompt="/cadre:work $prompt"
  fi

  # cadre-auto additionally runs in automatron mode.
  #
  # In the default adaptive mode, 4 of 5 headless runs merged nothing: the gate
  # correctly asked for a human on anything past the file threshold, no human
  # existed, and the worker's output stayed stranded in its worktree. That is
  # the gate working as designed and the task failing anyway, which makes the
  # default mode unmeasurable without a human in the loop.
  if [ "$arm" = cadre-auto ]; then
    docker exec "$c" bash -c \
      "mkdir -p /project/.cadre && printf '{\"mode\":\"automatron\",\"threshold\":3}' > /project/.cadre/config.json"
  fi

  # Model-tier arms: no plugin, just a cheaper model. These establish the floor
  # any orchestration layer has to beat — plain Claude Code runs mechanical work
  # on the opus tier, which is the only opening a router actually has.
  local model_flag=""
  case $arm in
    sonnet) model_flag="--model claude-sonnet-5" ;;
    haiku)  model_flag="--model claude-haiku-4-5" ;;
  esac

  docker exec "${SESSION_ENV[@]}" "$c" bash -c \
    "cd /project && timeout $TIMEOUT claude -p --output-format json --max-turns $MAX_TURNS --dangerously-skip-permissions $model_flag $(printf '%q' "$prompt")" \
    > "$rundir/agent.json" 2>"$rundir/agent.err"

  # What actually changed on disk. The agent's closing message is narration and
  # has been wrong in both directions — one arm reported the work blocked while
  # the suite passed. Keep the evidence, not the claim.
  # Diff against the base commit, not the worktree. An arm that edits in place
  # leaves dirty files; an arm that merges leaves a clean tree and a commit.
  # `git status` alone reports the second as "changed nothing".
  docker exec "$c" bash -c \
    "cd /project && echo '--- uncommitted ---' && git status --porcelain && \
     echo '--- vs base commit ---' && git diff --stat \$(git rev-list --max-parents=0 HEAD)..HEAD && \
     echo '--- commits ---' && git log --oneline | head -20" \
    > "$rundir/changed.txt" 2>&1

  # Did cadre's loop actually run? Kept for diagnostics, but no longer the
  # engagement signal itself — see below.
  docker exec "$c" bash -c "ls -R /project/.cadre 2>/dev/null" > "$rundir/cadre-state.txt" 2>&1

  # The full session transcript: every tool call, every subagent's own prompt
  # and turns, every hook firing and what it returned. Cost totals say a run was
  # expensive; only this says which turn bought what. Earlier diagnoses had to
  # be reconstructed from the agent's closing prose because the container —
  # and this — were destroyed at the end of each run. Pulled before the
  # engagement check below, which now reads it.
  docker exec "$c" bash -c "cd /home/node/.claude/projects 2>/dev/null && tar cf - . 2>/dev/null" \
    > "$rundir/transcripts.tar" 2>/dev/null
  docker exec "$c" bash -c "find /home/node/.claude/projects -name '*.jsonl' 2>/dev/null | head -50" \
    > "$rundir/transcript-index.txt" 2>&1

  # Machine-readable trace digest — peak_ctx, boundary count, and whether the
  # lead dispatched a subagent at all — captured into the row itself. Moved
  # ahead of verify.sh so the abort below can read `engaged` from it.
  python3 "$ROOT/harness/bench/trace.py" "$rundir" --summary-json > "$rundir/trace-summary.json" 2>/dev/null || true

  # Hard abort, not a warning: a cadre-work/cadre-auto trial that never
  # engaged is plain Claude Code plus the always-on tax, and spending on it
  # produces a null result that reads as a real one. Experiment B burned
  # $5.62 on nine such trials before anyone checked this flag.
  #
  # Signal is "the lead issued a Task dispatch" (trace.py's `engaged`, from
  # session splitting — a subagent transcript existing at all), not
  # `.cadre/tasks/<id>/` existing. That directory is written only by cadre's
  # escalated planner/worker/reviewer loop; cadre's own doer.md ladder rung 1
  # — "no worktree, no spec file, no handoff" — is the *default, most common*
  # path per work/SKILL.md ("most tasks end at step 1") and never touches it.
  # The old check read the common case as a harness error. Confirmed by
  # reading src/agents/doer.md and src/skills/work/SKILL.md, not assumed.
  if [ "$arm" = cadre-work ] || [ "$arm" = cadre-auto ]; then
    engaged=$(python3 -c "import json;print(json.load(open('$rundir/trace-summary.json')).get('engaged', False))" 2>/dev/null || echo False)
    if [ "$engaged" != "True" ]; then
      real_cost=$(python3 -c "import json;print(json.load(open('$rundir/agent.json')).get('total_cost_usd') or 0)" 2>/dev/null || echo 0)
      emit "$task" "$arm" "$trial" harness_error "$real_cost" "engagement precondition failed: lead never dispatched a subagent (Task tool) — this trial measures the always-on tax, not orchestration"
      docker rm -f "$c" >/dev/null 2>&1; rm -rf "$w"; return
    fi
  fi

  # Verify against the task's own check, in-container, ignoring agent claims.
  # Copy the script in rather than piping it. `docker exec` without -i does not
  # forward stdin, so `bash /dev/stdin` read an empty script, exited 0, and every
  # single run reported pass without the check ever executing.
  docker cp "$TASKS_DIR/$task/verify.sh" "$c:/tmp/verify.sh" >/dev/null 2>&1
  local verdict=fail
  if docker exec "$c" bash -c "cd /project && bash /tmp/verify.sh" > "$rundir/verify.txt" 2>&1; then
    verdict=pass
  fi

  # A verify that cannot fail is worse than no verify. Prove it can, in the same
  # container, by running it against a pristine copy of the task.
  docker exec "$c" bash -c "rm -rf /tmp/probe && mkdir -p /tmp/probe" >/dev/null 2>&1
  docker cp "$TASKS_DIR/$task/setup.sh" "$c:/tmp/setup.sh" >/dev/null 2>&1
  if docker exec "$c" bash -c "bash /tmp/setup.sh /tmp/probe && cd /tmp/probe && bash /tmp/verify.sh" >/dev/null 2>&1; then
    emit "$task" "$arm" "$trial" harness_error 0 "verify passes on unmodified task — check is inert"
    docker rm -f "$c" >/dev/null 2>&1; rm -rf "$w"; return
  fi

  # trace-summary.json was already captured above, ahead of the engagement
  # abort — not re-run here, transcripts.tar hasn't changed since.

  # Record the session env in the row itself. A results file that does not say
  # which compaction settings produced it cannot be compared against another
  # one later, and an invalid value fails silently (parseFloat drops a bad
  # PCT_OVERRIDE; a bad AUTO_COMPACT_WINDOW falls back to 100000), so the row
  # is the only place the intended value is visible after the fact.
  python3 - "$rundir" "$task" "$arm" "$trial" "$verdict" "$RESULTS" \
    "${EFFORT:-medium}" "${COMPACT_WINDOW:-}" "${COMPACT_PCT:-}" "${DISABLE_AUTO_COMPACT:-}" \
    "$(condition_slug)" <<'PY'
import json, sys
rundir, task, arm, trial, verdict, results = sys.argv[1:7]
effort, compact_window, compact_pct, disable_auto_compact = sys.argv[7:11]
condition_slug = sys.argv[11]
row = {"task": task, "arm": arm, "trial": int(trial), "status": verdict}
row["env"] = {"opus_model": "claude-opus-5", "effort": effort}
if compact_window:
    row["env"]["compact_window"] = compact_window
if compact_pct:
    row["env"]["compact_pct"] = compact_pct
if disable_auto_compact:
    row["env"]["disable_auto_compact"] = disable_auto_compact

# `condition` names the manipulation directly, so a group-by on this field
# alone separates treatment from control. Before this, all long-context rows
# carried arm=vanilla and the compaction settings lived only in `env`, which
# meant a group-by-arm was blind to the one thing the experiment manipulated.
# Taken verbatim from the shell that built the run directory path, so the row
# and its transcripts always carry the same label and can be joined.
row["condition"] = condition_slug

try:
    trace = json.load(open(f"{rundir}/trace-summary.json"))
    row["engaged"] = trace.get("engaged", False)
    row["peak_ctx"] = trace.get("peak_ctx")
    row["boundaries"] = trace.get("boundaries")
    row["microcompacts"] = trace.get("microcompacts")
except Exception:
    row["engaged"] = False
try:
    d = json.load(open(f"{rundir}/agent.json"))
    row["cost_usd"] = d.get("total_cost_usd")
    row["num_turns"] = d.get("num_turns")
    row["duration_ms"] = d.get("duration_ms")
    row["models"] = sorted((d.get("modelUsage") or {}).keys())
    if d.get("is_error"):
        row["status"] = "harness_error"
        row["note"] = d.get("result", "")[:200]
except Exception as e:
    row["status"] = "harness_error"
    row["note"] = f"unparseable agent.json: {e}"
with open(results, "a") as f:
    f.write(json.dumps(row) + "\n")
print(json.dumps(row))
PY

  docker rm -f "$c" >/dev/null 2>&1
  rm -rf "$w"
}

emit() {
  python3 -c "
import json,sys
print(json.dumps({'task':sys.argv[1],'arm':sys.argv[2],'trial':int(sys.argv[3]),'status':sys.argv[4],'cost_usd':float(sys.argv[5]),'note':sys.argv[6]}))
" "$@" | tee -a "$RESULTS"
}

for task in $TASKS; do
  for arm in $ARMS; do
    for t in $(seq 1 "$TRIALS"); do
      echo "--- $task / $arm / trial $t"
      run_one "$task" "$arm" "$t"
    done
  done
done

echo
echo "=== summary ==="
python3 "$ROOT/harness/bench/report.py" "$RESULTS"
