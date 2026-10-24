# cadre

**A Claude Code plugin that makes Claude plan, test, review and merge like a disciplined team, enforced in code, not prompts.**

- **You approve in a dialog.** Claude drafts a plan; nothing runs until you choose Approve in Claude Code's own question dialog.
- **Tests first.** A separate tester writes a failing test, then a worker makes it pass.
- **Isolated and reviewed.** Every task gets its own git worktree and an independent review before it merges.
- **A live board in your terminal.** See every task, step and agent without leaving Claude Code.
- **Works offline.** Tasks live in plain files on your machine, in `.cadre/state` (not committed). No database, no extra tool to install.

```text
[RUN] cadre · p3 auth-login · strict · contained ✓ · ctx 34% · cache 87%
  ✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done · ▶1 ⏸1 ◌1
[1] Epic  [7] Plan  [8] Doctor  ·  p3 · epic/p3-auth-login · 4/7 done
 ┌────────────────┐     ┏━━━━━━━━━━━━━━━━┓     ┌────────────────┐
 │a1 feat    [OK]✓│     ┃a2 feat   [RUN]▶┃     │a6 feat  [WAIT]⏸│
 │Add login       │━━┳━▶┃Session refresh ┃──┬─▶│Remember me     │
 │●●●●●● merged   │  ┃  ┃●●◉○○○ implement┃  ┃  │○○○○○○ waits a2 │
 └────────────────┘  ┃  ┗━━━━━━━━━━━━━━━━┛  ┃  └────────────────┘
```

## Quick start

```bash
claude plugin marketplace add it-dainb/cadre
claude plugin install cadre@cadre
```

Then, inside Claude Code:

1. `/cadre setup`: once per machine. Claude checks your tools and fixes what it can, in the open, and asks your default mode and limits; you confirm the settings in a dialog.
2. **Start work:** `/cadre <goal in plain words>`, e.g. `/cadre fix the off-by-one in src/page.ts`. In a repo cadre hasn't seen, one dialog asks to set it up first: Claude prepares the task store, your build and test commands and a changelog in the open, you confirm the safety settings (they also turn off Claude Code's built-in task tools for this project: Claude plans with cadre's own tools), and then the plan comes up with its mission for one approval. Claude picks a lane and says why:
   - **ask**: a question or investigation. An explorer answers it; nothing changes.
   - **lite**: one small, clear change. One task, drafted for you; choose **Approve** once and Claude runs it to the end: worker → review → merge (a bug a test can reproduce gets the failing test first).
   - **full**: a feature, several tasks, or a public API change. The full plan with scenarios and contracts.
   Before it plans, Claude sends one explorer through the code and scores how clear the goal is (outcome, scope, acceptance, constraints). A vague goal gets at most 3 questions in one round, naming what the explorer found ("I found Hero, Navbar and Timeline in components/: which one?"); a clear one gets none. Under yolo it asks nothing and the dialog lists what it assumed. `/cadre deep <goal>` talks it through instead: one question per round at the weakest point, with the scores shown, until it is clear, 8 rounds pass, or you say "enough". Settings → Planning.
   The lane shows in the approval dialog, with an option to change it; type something instead to ask Claude for a change. Breaking, security, public contract changes and plans of 3+ tasks are always full.

3. **After you approve, it runs by itself.** Two modes:
   - **auto** (`/cadre <goal>`): Claude carries the plan until it lands on dev and asks you only at the critical points: a change to the agreed spec, a question only you can answer, an integration that fails twice, a protected branch moved outside cadre, and the release.
   - **yolo** (`/cadre yolo <goal>`): after the approval nothing is asked. Claude decides spec changes and blocked questions itself and each decision is recorded (Activity, Doctor) for you to review. It stops, never releases, when the plan lands on dev.
   To make yolo your default, set **Drive → mode** to `yolo` in Settings (`9`); a repo's committed config can only force `auto`.
   Both stop by themselves when an agent moves a protected branch, the sandbox settings change, or a bound is hit (100 turns, $20, 240 minutes, or 3 turns without progress; Settings → Drive). The band shows `auto · turn 12/100 · $1.20 · 0: stop`; `0` stops and resumes.

`/cadre` alone opens the pane. Those forms (`/cadre`, `/cadre <goal>`, `/cadre yolo <goal>`, `/cadre deep <goal>`, `setup`, `init`, `doctor`, `continue`) are all you type; every decision is answered in a dialog. It opens once by itself; after that `1` (on the band or in the pane) opens it again, and the pane lists everything that needs you.

## How it works

```text
plan → your approval → tester (test goes red) → worker (goes green)
     → independent reviewer → merge into the epic branch
     → epic lands on dev → you release
```

| Who | Does |
|---|---|
| **You** | Approve plans, resolve flags, cut releases. Every one is a dialog answer. |
| **Main Claude** | Plans and manages with cadre's tools (`plan`, `task`, `epic`, `amend`, `explore`, `ask`, `status`). It never edits code, has no shell and starts no agent of its own to explore: it asks cadre's explorer. |
| **Worker agents** | Tester writes the test, worker writes the code, reviewer checks it. Each works in its own worktree. |
| **cadre itself** | Owns git (workers cannot commit or push), runs the checks, enforces every step; pushes only when you set `landing.mode` to `pr`. |

More: [the loop in detail](docs/commands.md#the-loop-in-detail).

## Commands

| Type this | What it does |
|---|---|
| `/cadre setup` | One-time machine setup. [Details](docs/setup-details.md) |
| `/cadre` | One line: where things stand and what to type next; opens the pane. |
| `/cadre init` | Re-run the repo setup on purpose (a first `/cadre <goal>` does it for you). A project set up by an older cadre asks for it once (a toast and a Doctor line); restart Claude Code after its confirm. |
| `/cadre doctor` | Read-only health check. Safe any time. |
| `/cadre <goal>` · `/cadre yolo <goal>` | Start work; after approval it runs to dev, asking at the critical points (auto) or not at all (yolo). |
| `/cadre deep <goal>` | Talk the goal through first (one question per round, scores shown), then the plan comes up as usual. |
| `/cadre continue` | Pick up a plan an earlier session left (also `0` on the band). |
| `/cadre open` · `/cadre status` | Open the board pane · print the board as text. |
| Settings | Press `9` in the pane: every setting, where its value comes from, and buttons to change it. |

Every decision is a dialog (`1` opens it). The typed fallbacks, config keys and the extension protocol are in [docs/commands.md](docs/commands.md).

## Your project: units and landing

Set in `.cadre/config.json` (the setup writes it; edit it by hand to change it):

- **`units`**: the parts of the repo that build and test on their own, each with its `root`, its `setup` command, its `runner` (`junit` or `text`), an optional `concurrency` cap and its `checks` (`test`, …). A unit has a `kind` (`package`, `service`, `submodule`, `app`); `packages` was renamed to `units`; a git submodule is a unit with `ownGit: true`, and its work lands in its own repository before the parent's pointer moves. A task belongs to the units its files fall in; a task that spans several runs every one's checks before it merges. `routing.<role>` picks a model and effort for that unit's agents.
- **`landing.mode`**: `direct` (default) lands a finished plan on `dev` locally. `pr` pushes it to `landing.remote` and opens one pull request into `dev` (needs `gh`, signed in); cadre merges it when the checks pass (and, with `landing.review: true`, once it is approved), and takes the usual red path when they fail. cadre never pushes in `direct` mode.

## Stopping and continuing

- **Stop the run:** press `0` on the band (`0: stop`); `0: resume` starts it again with a fresh budget.
- **`/clear` or compaction:** nothing to do. Running agents keep working and the run goes on.
- **Quit, crash, or `claude --continue` later:** the new session shows `Unfinished plan … · /cadre continue to pick it up` and `0: continue` on the band. Nothing restarts by itself. `/cadre continue` (or `0`) re-arms the run in its mode (auto or yolo) and respawns each task that was in flight. Each new agent starts from a checkpoint commit of the old one's worktree, with the diff and the last failing check, so nothing is redone. No waiting for old claims to expire.
- **What a quit can lose:** only work that was not on disk yet (the agent's unwritten next step). Every file it had written is kept.
- **Two sessions on one repo:** a session that is still running keeps its plan and its tasks; `/cadre continue` elsewhere says so and takes nothing.
- **Usage limit:** the run stops with the time it resets (`usage limit until HH:MM UTC` on the band) and goes on by itself then; nothing is charged to the task. `0: resume` goes on at once.
- **Your checkout is never moved.** If you have `dev` (or `main`) checked out when work lands, cadre leaves your branch, index and files alone and asks in one dialog: **Land** brings it into your checkout, keeping your commits and your uncommitted edits (an edit to the same file refuses, and the dialog says so). Switch to another branch and it lands by itself. A release waits until it is in.
- **An agent can always end.** Once an agent has handed in its work, cadre ends its turn itself (no tokens); one that repeats the same call 20 times is stopped and its task asks you. `limits.silentRuns` (runs without a report before a task blocks) and `limits.startFails` (failed starts before the run stops) are in Settings.

## Requirements

- Claude Code **2.1.295** (tested; newer usually works and only warns)
- `git`
- A filesystem with hard links for the project (any normal Linux or macOS disk; not exFAT or some network mounts), where `.cadre/state` lives.
- Linux: `bwrap` (bubblewrap) and `socat` for sandboxed checks. macOS: setup tells you what is needed.

## Troubleshooting

- **Run `/cadre doctor` first.** It lists every failing check and how to fix it. The full report is in the pane's Doctor tab.
- **"Ready when you are"**: cadre isn't set up in this repo yet; `/cadre <goal>` sets it up and plans the goal.
- **Ubuntu 24.04+ blocks bwrap (AppArmor).** cadre never runs root commands for you. It writes a fix script to `~/.cache/cadre/fix/`. Read it, then run the line Claude shows you, e.g. `sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh`.
- Known limits: [docs/limitations.md](docs/limitations.md).

## Philosophy

- **Enforced by code.** Hooks deny what the rules forbid. A prompt can be ignored; a denial cannot.
- **Main plans, never edits.** The agent that talks to you cannot touch your source.
- **Computed beats claimed.** Tests pass because cadre ran them, not because an agent said so.
- **Local first.** Your tasks and git history stay on your machine. cadre pushes only when you choose pull-request landing (`landing.mode: pr`).
- **Calm UI, zero token cost.** The board is drawn by the plugin. It adds nothing to Claude's context.

Read more: [DESIGN](docs/design/DESIGN.md) · [UI design](docs/design/UI-DESIGN.md) · [decisions (ADRs)](docs/adr) · [UI dev loop](docs/dev/ui-dev.md) · [test harness](harness/README.md) · [module contracts](docs/CONTRACTS.md)

## Development

You need the Claude Code 2.1.295 binary (not whatever `claude` is on PATH).

```bash
CC=<path to claude 2.1.295>
node scripts/budget.mjs                      # size budget
$CC plugin validate --strict . && $CC plugin test .
$CC --plugin-dir .                           # try it in the repo you want to manage
node --experimental-transform-types scripts/ui-dev.mjs   # the pane in your terminal, hot reload
```

Live runs go through Docker: `harness/run.sh` (see [harness/README.md](harness/README.md)).

## Status

Version 0.14.0. Pre-1.0, pinned to Claude Code 2.1.295 (agent exits tested up to 2.1.299). License: not chosen yet.
