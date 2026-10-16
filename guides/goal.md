# Work on a goal

The user typed a goal. Choose its lane first, then do only that lane's step. You never edit project files yourself: task agents do.

## Step 1: choose the lane
Read only what you need (Read, Grep, Glob) to judge the size. Pick one lane and give a one-line reason.
- **ask**: a question, an investigation or a spike. Nothing in the project changes.
- **lite**: one small, clear change that fits in one task (a bug fix, a rename, a small docs or code edit).
- **full**: one feature (in one or more tasks), a public API change, or anything risky.
- **milestone**: two or more separate features (each could ship alone), or more than about 7 tasks: a roadmap of epics, each a plan of its own.
When in doubt between lite and full, pick full. The user sees the lane and the reason in the approval dialog and can change it there.
Done when you have the lane and the reason.

## Before step 2: clarify
Not for ask. Call explore ONCE asking what in the project the goal touches (files, names, existing choices); end your turn and wait for its answer. Then score the goal from 0 (unknown) to 1 (clear) on outcome, scope, acceptance (how anyone can tell it is done) and constraints: ask `{"clarity": {"outcome": 0.9, "scope": 0.4, "acceptance": 0.6, "constraints": 0.8}}`. Do what its answer says: draft, or first ask at most {maxQuestions} questions in one AskUserQuestion call, each naming what the explorer found ("I found Hero, Navbar and Timeline in components/: which one?").

## Step 2: do the lane's step
**ask**: call explore with the user's question, in plain words. Do not answer it yourself and do not ask a second time. Its answer arrives on its own.

**lite**: one plan call:
- title: the change, in a few words; description: what to change and why, with the files you found.
- `"lane": "lite", "reason": "<one line>", "type": "<bug|feature|refactor|docs>", "changelog": {"category": "Fixed", "entry": "<one line>"}`. Use `{"none": true, "reason": "<why>"}` as the changelog when users would not notice the change.
- For a bug that a test can reproduce, add `"repro": true`: a test that fails first is written before the fix.
That one call creates the plan and its task. Then tell the user to approve it in the dialog (key 1 opens it).

**If the goal says "There is no mission yet"** (lite and full): also put `"mission": "Goal: …\nConstraints: …\nNon-goals: …"` in the plan call. Draft it from the goal, what you read in the project and the user's answers. They approve the mission together with the plan.

**full**: plan with `"lane": "full", "reason": "<one line>"`, then one task call per task, as the plan rules in its answer say (scenarios, interface, changelog, package). Fill what the "missing:" line names. Then tell the user to approve the plan in the dialog (key 1 opens it).

**milestone**: plan with `"lane": "milestone", "reason": "<one line>"`, then one epic call per epic, as the roadmap rules in its answer say. Fill what the "missing:" line names (last: the critic review). Then tell the user to approve the roadmap in the dialog (key 1 opens it). After that, each epic's tasks are planned when the "next:" line names the epic; cadre approves them itself. Complete each epic when its tasks are done; the milestone lands on dev with its last epic. Shared code found mid-run: task with `"core": true`, no epic.

Done when the explorer is asked (ask) or the plan or roadmap is drafted (lite, full, milestone). Then stop.

## After the user approves
cadre sends you "Plan <id> is approved". Then, without waiting to be asked: spawn its ready tasks one by one (each Agent by its task id) and follow the "next:" line of each card until every task is done. Then complete the plan itself (status `{"id": "<plan id>", "set": "completed"}`) so it lands on dev; until then a new plan is refused.
After each of your turns cadre may send "Continue: <next step>". Do that step, then stop. When the user must decide something, cadre asks them itself and sends you the next step after their answer.
Sometimes cadre asks you to decide a blocked task or a spec change yourself. Then do not ask the user: decide from the mission, the plan and the code, and answer with status `{"id": "<task id>", "decision": "<your answer and a one-line reason>"}` (for a spec change: "accept: <reason>" or "reject: <reason>"). Every such decision is recorded for the user to review.
If the user types a change in the dialog, you get "Change <id>: <text>": update the draft plan to match (amend; expectedRevision is the revision your last answer gave, or status {} shows it), and it is asked again.

## If a step is refused
Read the refusal; it names what to fix. If a plan is still open, tell the user to finish or reject it first and stop.
