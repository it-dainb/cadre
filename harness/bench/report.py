#!/usr/bin/env python3
"""Summarise bench results.

Deliberately reports cost and pass-rate separately, and labels pass-rate
underpowered below 5 trials/task/arm. A pilot can settle cost (low variance
per task) long before it can settle capability (binary, high variance).
"""
import json, sys, collections, statistics

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]

# A run that varies `condition` (compaction settings) holds `arm` fixed, so
# grouping on arm alone pools control and treatment into one row and reports
# their average as if it were a result. Fold condition into the group label
# whenever a file actually contains more than one — single-condition runs keep
# the original bare-arm labels, so existing output is unchanged.
conditions = {r.get("condition") for r in rows}
multi_cond = len(conditions) > 1
def label(r):
    return f"{r['arm']}/{r.get('condition')}" if multi_cond else r["arm"]

AW = max([len(label(r)) for r in rows] + [len("arm")])

by = collections.defaultdict(list)
for r in rows:
    by[label(r)].append(r)

trials = collections.Counter((r["task"], label(r)) for r in rows)
min_trials = min(trials.values()) if trials else 0

print(f"{'arm':{AW}} {'pass':>8} {'cost/task':>11} {'total':>9} {'turns':>7} {'harness_err':>12}")
for arm, rs in sorted(by.items()):
    ok = [r for r in rs if r["status"] != "harness_error"]
    errs = len(rs) - len(ok)
    passes = sum(1 for r in ok if r["status"] == "pass")
    costs = [r["cost_usd"] for r in ok if r.get("cost_usd") is not None]
    turns = [r["num_turns"] for r in ok if r.get("num_turns") is not None]
    rate = f"{passes}/{len(ok)}" if ok else "-"
    mean = f"${statistics.mean(costs):.4f}" if costs else "-"
    tot = f"${sum(costs):.3f}" if costs else "-"
    tn = f"{statistics.mean(turns):.1f}" if turns else "-"
    print(f"{arm:{AW}} {rate:>8} {mean:>11} {tot:>9} {tn:>7} {errs:>12}")

models = sorted({m for r in rows for m in r.get("models", [])})
print(f"\nmodels resolved: {', '.join(models) or 'none recorded'}")
print(f"total spend: ${sum(r.get('cost_usd') or 0 for r in rows):.3f}")

if min_trials < 5:
    print(f"\nPASS-RATE IS UNDERPOWERED ({min_trials} trial(s)/task/arm). "
          "Cost numbers are usable; capability differences are not. "
          "Need >=5 trials before any pass-rate claim.")

# Per-cell (task, arm) breakdown. The arm-level table above pools across
# tasks, which hides a cell sitting at n=1 inside an arm that looks n=20 —
# exactly the condition that let a 6.5x association pass as a result before
# anyone checked how many trials actually backed each cell.
cells = collections.defaultdict(list)
for r in rows:
    if r["status"] != "harness_error" and r.get("cost_usd") is not None:
        cells[(r["task"], label(r))].append(r)

# `bnd` is the manipulation check, not decoration: an out-of-range
# CLAUDE_CODE_AUTO_COMPACT_WINDOW is silently replaced with a default rather
# than rejected, so a misconfigured treatment still runs, passes, and reports
# zero boundaries — indistinguishable from a genuine "compaction didn't help"
# null. Treatment must show bnd>0 and control bnd=0 before any cost delta
# between them means anything.
print(f"\n{'task':22} {'arm':{AW}} {'n':>3} {'median':>9} {'CV':>6} {'bnd':>5}  flag")
underpowered = 0
for (task, arm), rs in sorted(cells.items()):
    costs = [r["cost_usd"] for r in rs]
    bnd = sum(r.get("boundaries") or 0 for r in rs)
    n = len(costs)
    med = statistics.median(costs)
    cv = (statistics.stdev(costs) / statistics.mean(costs)) if n >= 2 else float("nan")
    flag = ""
    if n < 3:
        flag = "UNDERPOWERED (n<3)"
        underpowered += 1
    elif n >= 2 and cv > 0.5:
        flag = f"HIGH VARIANCE (CV={cv:.2f})"
    cv_str = f"{cv:.2f}" if n >= 2 else "-"
    print(f"{task:22} {arm:{AW}} {n:>3} ${med:>8.4f} {cv_str:>6} {bnd:>5}  {flag}")

if underpowered:
    print(f"\n{underpowered}/{len(cells)} (task, arm) cells have n<3. "
          "Any comparison touching these cells is noise, not a result.")

# Aborted trials leave a cell with fewer valid trials than the condition it is
# compared against, and the survivors are not a random sample — an autocompact
# thrash abort selects against exactly the expensive, context-heavy runs, so
# the surviving mean is biased low in the arm that failed. Silent when only the
# per-cell medians are read, so name it.
if multi_cond:
    # Count against the full label set, not just the cells that exist: a task
    # wiped out entirely in one condition has NO cell there, so keying only on
    # observed cells would score the total wipeout — the worst case — as
    # balanced.
    all_labels = {label(r) for r in rows}
    all_tasks = {r["task"] for r in rows}
    per_task = {t: {a: len(cells.get((t, a), [])) for a in all_labels}
                for t in all_tasks}
    skewed = {t: c for t, c in per_task.items() if len(set(c.values())) > 1}
    if skewed:
        print("\nUNEQUAL VALID-N ACROSS CONDITIONS — survivor bias, not a comparison:")
        for task, counts in sorted(skewed.items()):
            detail = ", ".join(f"{a}={n}" for a, n in sorted(counts.items()))
            print(f"  {task}: {detail}")
        print("  Aborted trials are not missing at random. Do not quote a ratio "
              "for these tasks; report the abort rate instead.")

fails = [r for r in rows if r["status"] == "harness_error"]
if fails:
    print("\nharness errors (NOT task failures):")
    for r in fails:
        print(f"  {r['task']}/{r['arm']}/{r['trial']}: {r.get('note','')[:120]}")
