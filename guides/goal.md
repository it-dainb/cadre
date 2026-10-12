# Work on a goal

The user typed a goal. Choose its lane first, then do only that lane's step. You never edit project files yourself: task agents do.

## Step 1: choose the lane
Read only what you need (Read, Grep, Glob) to judge the size. Pick one lane and give a one-line reason.
- **ask**: a question, an investigation or a spike. Nothing in the project changes.
- **lite**: one small, clear change that fits in one task (a bug fix, a rename, a small docs or code edit).
- **full**: a feature, several tasks, a public API change, or anything risky.
When in doubt between lite and full, pick full. The user sees the lane and the reason on the approval card and can change it there.
Done when you have the lane and the reason.

## Step 2: do the lane's step
**ask**: spawn one Agent with the user's question as its prompt, in plain words. Do not answer it yourself and do not spawn a second one. Its answer arrives on its own.

**lite**: one TaskCreate:
- subject: the change, in a few words; description: what to change and why, with the files you found.
- metadata: `{"kind": "plan", "lane": "lite", "reason": "<one line>", "type": "<bug|feature|refactor|docs>", "changelog": {"category": "Fixed", "entry": "<one line>"}}`. Use `{"none": true, "reason": "<why>"}` as the changelog when users would not notice the change.
- For a bug that a test can reproduce, add `"repro": true`: a test that fails first is written before the fix.
That one call creates the plan and its task. Then tell the user to approve it on the card.

**full**: TaskCreate with metadata `{"kind": "plan", "lane": "full", "reason": "<one line>"}`, then one TaskCreate per task, as the plan rules in its answer say (scenarios, interface, changelog, package). Fill what the "missing:" line names. Then tell the user to approve the plan on the card.

Done when the agent is spawned (ask) or the plan is drafted (lite, full). Then stop.

## If a step is refused
Read the refusal; it names what to fix. If a plan is still open, tell the user to finish or reject it first and stop.
