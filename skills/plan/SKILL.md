---
name: plan
description: Scope a task before building it — investigate the code, then write a plan with a Discovery section grounded in findings. Use when work is bigger than a single obvious edit, or when the shape of the code is unknown.
---

# plan

1. Dispatch `scout` if the relevant code is unfamiliar. Give it a specific question, not a topic.
2. Dispatch `planner` with the goal and whatever scout found.
3. The planner writes `.cadre/tasks/<id>/plan.md`.

The write gate rejects a plan whose `## Discovery` section is missing or under 100 characters. That check is in code, not prose — a plan built from assumptions gets stopped before anyone acts on it.

Read the plan yourself before dispatching work from it.
