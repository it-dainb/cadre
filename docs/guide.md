# User guide

## The workflow

```text
 /cadre <goal>
      │ lane: ask (answer only) · lite (one task) · full (several tasks, contracts)
      ▼
   PLAN ──▶ [Approve] ──▶ epic branch cut from dev
                              │
        ┌─────────────────────┴──────────────── per task, own worktree ──┐
        │  tester writes a test ─▶ RED ─▶ worker implements ─▶ GREEN      │
        │  ─▶ independent reviewer ─▶ merge into the epic branch          │
        └─────────────────────────────────────────────────────────────────┘
                              ▼
                  epic lands on dev ─▶ you release
```

1. **Goal.** `/cadre <goal>`. Claude sends one explorer through the code and scores how clear the goal is. A vague goal gets at most 3 questions in one round; `/cadre deep <goal>` talks it through one question per round instead.
2. **Plan.** A lite plan is one task. A full plan has epics and tasks with Given/When/Then scenarios, a changelog entry per task and an interface contract. Nothing runs until you choose **Approve** in the dialog.
3. **Tdd, red then green.** A tester writes a failing test in a folder that holds only docs and scenarios; cadre runs it and confirms it fails for the right reason. A worker then makes it pass without changing the locked tests.
4. **Review.** A reviewer who did not write the code judges the commit against the scenarios.
5. **Land.** The task merges into the epic branch; when the epic is done it lands on `dev`. The release is yours: cadre never releases on its own, not even under yolo.

Two modes after approval: **auto** (`/cadre <goal>`) asks only at critical points (a spec change, a question only you can answer, an integration that fails twice, a protected branch moved outside cadre, the release); **yolo** (`/cadre yolo <goal>`) asks nothing and records each decision it took, in Activity and Doctor. Both stop at a bound (100 turns, $20, 240 minutes, or 3 turns without progress; Settings, Drive).

## The board and the pane

`/cadre` opens the pane; after that, `1` on the band opens it again.

```text
[RUN] cadre · p3 auth-login · strict · contained ✓ · ctx 34% · cache 87%
  ✓a1 ✓a4 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done
```

`✓` merged, `▶` running, `⏸` waiting on a dependency or you, `◌` queued. Tabs: Epic (the task graph), Plan (the approval sheet), Doctor, Settings (`9`), Lessons. The band's keys: `1` the decision waiting for you, `0` stop or resume the run.

## Dialogs

Every decision is answered in Claude Code's own question dialog, never by typing a command.

| Dialog | Options | When |
|---|---|---|
| Plan | Approve · Reject (type a change instead) | a plan or gate is ready |
| **Keep going / Cancel task** | restart with a fresh agent from the last checkpoint · end the task | an agent stopped for good: attempts, no-report, stagnant, stale, loop |
| **Already holds** | records that named scenarios already pass · Retry · Cancel task | the tester's test passed at red |
| Spec change | Accept (tester amends, new red) · Reject | the worker asks to change the locked spec |
| Land | brings the work into your checked-out `dev`, keeping your edits | `dev` is checked out when work lands |
| Revert | two confirms, see below | `/cadre revert <id>` or press on a landed task |

Your checkout is never moved by cadre. Refused or stuck: [troubleshooting](troubleshooting.md).

### Revert

Select a landed task, epic or milestone, open its card (changelog entry, summary, result, tests), choose **revert to this point**. cadre previews what is lost (files, commits, later tasks that depend on it); the first confirm only shows it, the second reverts. The revert commits go through the same checks as an epic. A revert of a revert is refused; an epic that never landed is abandoned instead, removing only the branches cadre recorded.

## Stopping and continuing

- **Stop:** `0` on the band; `0: resume` starts again with a fresh budget.
- **`/clear` or compaction:** nothing to do; running agents carry on.
- **Quit or crash:** keep the terminal open while a plan runs. After a quit, `/cadre continue` (or `0`) respawns each task that was in flight from a checkpoint commit with the diff and the last failing check.
- **Usage limit:** the run waits for the reset and goes on by itself.

## Lessons

After a plan lands, a short side-model pass (`lessons.model`, at most `lessons.passesPerDay` a day; 0 turns lessons off) turns what went wrong, and what you changed, into short lessons. Later task briefs carry them by path, at most 1.5 KB per brief. A lesson reinforced `lessons.repeats` times in one repo, or seen in `lessons.repos` repos, moves to your user scope; unused ones decay (`lessons.decayDays`, `lessons.maxAgeDays`). The Lessons tab lists them; `x` prunes one for good, and it never comes back.

## Commands

[docs/commands.md](commands.md) lists every command (`setup`, `init`, `doctor`, `continue`, `revert`, `timeline`, `config`, `drive`, `release`, `status`, `open`), the config keys and the loop in detail.

## Metrics

`/cadre timeline` prints one line per repo: landed tasks, cost per task, first-try rate, rework and time per task, and exports the records to `.cadre/tmp/timeline.json` in the project. History starts at 1.0. A task you retried by hand can read as first-try ([limitations](limitations.md)).

## Your project config

`.cadre/config.json` (setup writes it): `units` (the parts that build and test on their own, each with `root`, `setup`, `runner`, `checks`) and `landing.mode`: `direct` (default) lands a finished plan on `dev` locally; `pr` pushes and opens one pull request into `dev` (needs `gh`, signed in).
