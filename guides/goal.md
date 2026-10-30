# Work on a goal

The user typed a goal. Choose its lane first, then do only that lane's step.

## Step 1: choose the lane
Read only what you need to judge the size. Pick one lane and give a one-line reason.
- **ask**: a question, an investigation or a spike. Nothing in the project changes.
- **lite**: one small, clear change that fits in one task (a bug fix, a rename, a small docs or code edit).
- **full**: one feature (in one or more tasks), a public API change, or anything risky.
- **milestone**: two or more separate features (each could ship alone), or more than about 7 tasks: a roadmap of epics, each a plan of its own.
When in doubt between lite and full, pick full.

## Before step 2: clarify
Not for ask. Call explore ONCE asking what in the project the goal touches (files, names, existing choices); end your turn and wait for its answer. Then score the goal from 0 (unknown) to 1 (clear) on outcome, scope, acceptance (how anyone can tell it is done) and constraints: ask `{"clarity": {"outcome": 0.9, "scope": 0.4, "acceptance": 0.6, "constraints": 0.8}}`. Its answer says what to do: draft, or first ask at most {maxQuestions} questions.

## Step 2: do the lane's step
**ask**: call explore with the user's question in plain words. Do not answer it yourself or ask twice. Its answer arrives on its own.

**lite**: one plan call: title, description (what to change and why, with the files you found), `"lane": "lite"`, `"reason"`, `"type": "<{types}>"`{lite}. A bug that needs a test that fails first goes in the full lane.

**If the goal says "There is no mission yet"** (lite and full): also put `"mission": "Goal: …\nConstraints: …\nNon-goals: …"` in the plan call, drafted from the goal, what you read and the user's answers. They approve it with the plan.

**full**: plan with `"lane": "full"` and a reason, then one task call per task, as the plan rules in its answer say. A task may carry `"risk"`: `light`, `standard`, `thorough` or `core` (shared code others build on); it sets how closely the task is reviewed and which models run it. Leave it out for standard.

**milestone**: plan with `"lane": "milestone"` and a reason, then one epic call per epic, as the roadmap rules in its answer say. Complete each epic when its tasks are done; the milestone lands on dev with its last epic. Shared code found mid-run: task with `"core": true`, no epic.

For lite, full and milestone, tell the user to approve the plan in the dialog (key 1 opens it). Then stop.

## After the user approves
If the user types a change in the dialog you get "Change <id>: <text>": amend the draft plan to match (expectedRevision is the revision your last answer gave, or status {} shows it); it is asked again.
