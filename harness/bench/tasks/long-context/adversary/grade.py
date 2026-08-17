#!/usr/bin/env python3
"""Regrade the scripted adversary against the fixture. Reproduces the 60.4%
per-record / 50.8% sum-error figures the task's design rests on.

The adversary was given every record's text plus 12 labelled examples (indices
0-5 and 80-85, standing in for an agent reading a handful of files by hand),
and told to write a script that generalizes rather than to read. Its answers are
in attack-output.json; the ground truth is the fixture itself. Held-out accuracy
excludes the 12 it was shown.

    python3 grade.py

The point is not the accuracy number on its own. A 60%-accurate parser lands the
*sum* half wrong, and the task's bar is one exact integer — which is why a
partially-correct rule buys nothing here.
"""
import json, pathlib

here = pathlib.Path(__file__).parent
key = {r['index']: r['minutes']
       for r in json.load(open(here.parent / 'fixture' / 'records.json'))['records']}
out = json.load(open(here / 'attack-output.json'))
per = out['per_index']
shown = {0, 1, 2, 3, 4, 5, 80, 81, 82, 83, 84, 85}

# Restricted to records the adversary actually answered. It ran when the
# fixture held 150 records; counting the later 50 as misses would score it
# for questions it was never asked.
held = [i for i in key if i not in shown and str(i) in per]
hits = sum(1 for i in held if str(per.get(str(i))) == str(key[i]))

# The adversary only covered the 150 records that existed when it ran; the
# fixture has since been completed to 200. Sum error is reported against the
# same 150 so the two numbers describe one experiment.
scored = [i for i in key if str(i) in per]
true_sum = sum(key[i] for i in scored)

print(f'held-out accuracy: {hits}/{len(held)} = {hits/len(held):.1%}')
print(f'records the adversary answered: {len(scored)}')
print(f'true sum over those: {true_sum}   adversary sum: {out["sum"]}   '
      f'error: {abs(out["sum"] - true_sum) / true_sum:.1%}')
print(f'adversary self-reported confidence: {out.get("confidence")}')
print(f'\nmethod it found:\n  {out.get("method")}')
