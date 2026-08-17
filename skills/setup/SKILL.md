---
name: setup
description: Choose how cadre behaves in this repo — gated by blast radius, or fully autonomous — and set the file threshold that trips the merge gate. Run once per project.
---

# setup

Ask two questions, write `.cadre/config.json`, stop.

**Mode.**
- `adaptive` (default) — work runs untouched until it gets large or destructive, then stops for approval.
- `automatron` — no human gate at all. The reviewer pass still runs; autonomy removes the human, not the checks.

**Threshold.** How many files a task may touch before the gate trips. Default 3. Destructive operations — merge, push, history rewrite, mass delete, dependency change, migration — always gate regardless of this number.

Write the config with `writeConfig`, which validates both values. An unknown mode or a non-numeric threshold fails here rather than silently defaulting and surprising someone at merge time.
