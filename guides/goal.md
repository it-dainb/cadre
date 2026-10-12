# Work on a goal

The user typed a goal. Choose its lane first, then do only that lane's step. You never edit project files yourself: task agents do.

## Step 1: choose the lane
Read only what you need (Read, Grep, Glob) to judge the size. Pick one lane and give a one-line reason.
- **ask**: a question, an investigation or a spike. Nothing in the project changes.
- **lite**: one small, clear change that fits in one task (a bug fix, a rename, a small docs or code edit).
- **full**: a feature, several tasks, a public API change, or anything risky.
When in doubt between lite and full, pick full. The user sees the lane and the reason in the approval dialog and can change it there.
Done when you have the lane and the reason.

## Step 2: do the lane's step
**ask**: spawn one Agent with the user's question as its prompt, in plain words. Do not answer it yourself and do not spawn a second one. Its answer arrives on its own.

**lite**: one TaskCreate:
- subject: the change, in a few words; description: what to change and why, with the files you found.
- metadata: `{"kind": "plan", "lane": "lite", "reason": "<one line>", "type": "<bug|feature|refactor|docs>", "changelog": {"category": "Fixed", "entry": "<one line>"}}`. Use `{"none": true, "reason": "<why>"}` as the changelog when users would not notice the change.
- For a bug that a test can reproduce, add `"repro": true`: a test that fails first is written before the fix.
That one call creates the plan and its task. Then tell the user to approve it in the dialog (key 1 opens it).

**full**: TaskCreate with metadata `{"kind": "plan", "lane": "full", "reason": "<one line>"}`, then one TaskCreate per task, as the plan rules in its answer say (scenarios, interface, changelog, package). Fill what the "missing:" line names. Then tell the user to approve the plan in the dialog (key 1 opens it).

Done when the agent is spawned (ask) or the plan is drafted (lite, full). Then stop.

## After the user approves
cadre sends you "Plan <id> is approved". Then, without waiting to be asked: spawn its ready tasks one by one (each Agent by its task id) and follow the "next:" line of each card until every task is done. Then complete the plan itself (TaskUpdate on the plan id, status "completed") so it lands on dev; until then a new plan is refused.
After each of your turns cadre may send "Continue: <next step>". Do that step, then stop. When the user must decide something, cadre asks them itself and sends you the next step after their answer.
Sometimes cadre asks you to decide a blocked task or a spec change yourself. Then do not ask the user: decide from the mission, the plan and the code, and answer with TaskUpdate on that task, `metadata.decision` = your answer and a one-line reason (for a spec change: "accept: <reason>" or "reject: <reason>"). Every such decision is recorded for the user to review.
If the user types a change in the dialog, you get "Change <id>: <text>": update the draft plan to match (TaskUpdate), and it is asked again.

## If a step is refused
Read the refusal; it names what to fix. If a plan is still open, tell the user to finish or reject it first and stop.
