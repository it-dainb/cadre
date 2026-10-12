# cadre

**A Claude Code plugin that makes Claude plan, test, review and merge like a disciplined team, enforced in code, not prompts.**

- **You approve in a dialog.** Claude drafts a plan; nothing runs until you choose Approve in Claude Code's own question dialog.
- **Tests first.** A separate tester writes a failing test, then a worker makes it pass.
- **Isolated and reviewed.** Every task gets its own git worktree and an independent review before it merges.
- **A live board in your terminal.** See every task, step and agent without leaving Claude Code.
- **Works offline.** Tasks live in [beads](https://github.com/gastownhall/beads) (`bd`) on your machine.

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

1. `/cadre setup`: once per machine. Claude checks your tools and fixes what it can, in the open; you confirm the settings in a dialog.
2. `/cadre init`: once per repo. Claude sets up the task store, your build and test commands, and a changelog; you approve the mission and the safety settings, each in a dialog.
3. **Start work:** `/cadre <goal in plain words>`, e.g. `/cadre fix the off-by-one in src/page.ts`. Claude picks a lane and says why:
   - **ask**: a question or investigation. An explorer answers it; nothing changes.
   - **lite**: one small, clear change. One task, drafted for you; choose **Approve** once and Claude runs it to the end: worker → review → merge (a bug a test can reproduce gets the failing test first).
   - **full**: a feature, several tasks, or a public API change. The full plan with scenarios and contracts.
   The lane shows in the approval dialog, with an option to change it; type something instead to ask Claude for a change. Breaking, security, public contract changes and plans of 3+ tasks are always full.

4. **After you approve, it runs by itself.** Two modes:
   - **auto** (`/cadre <goal>`): Claude carries the plan until it lands on dev and asks you only at the critical points: a change to the agreed spec, a question only you can answer, an integration that fails twice, a protected branch moved outside cadre, and the release.
   - **yolo** (`/cadre yolo <goal>`): after the approval nothing is asked. Claude decides spec changes and blocked questions itself and each decision is recorded (Activity, Doctor) for you to review. It stops, never releases, when the plan lands on dev.
   Both stop by themselves when an agent moves a protected branch, the sandbox settings change, or a bound is hit (100 turns, $20, 240 minutes, or 3 turns without progress; Settings → Drive). The band shows `auto · turn 12/100 · $1.20 · 2: stop`; `2` stops and resumes.

`/cadre` alone opens the pane. Those six forms (`/cadre`, `/cadre <goal>`, `/cadre yolo <goal>`, `setup`, `init`, `doctor`) are all you type; every decision is answered in a dialog. It opens once by itself; after that `1` (on the band or in the pane) opens it again, and the pane lists everything that needs you.

## How it works

```text
plan → your approval → tester (test goes red) → worker (goes green)
     → independent reviewer → merge into the epic branch
     → epic lands on dev → you release
```

| Who | Does |
|---|---|
| **You** | Approve plans, resolve flags, cut releases. Every one is a dialog answer. |
| **Main Claude** | Plans and manages. It never edits code and has no shell. |
| **Worker agents** | Tester writes the test, worker writes the code, reviewer checks it. Each works in its own worktree. |
| **cadre itself** | Owns git (workers cannot commit or push), runs the checks, enforces every step, never pushes. |

More: [the loop in detail](docs/commands.md#the-loop-in-detail).

## Commands

| Type this | What it does |
|---|---|
| `/cadre setup` | One-time machine setup. [Details](docs/setup-details.md) |
| `/cadre init` | One-time repo setup. Turns cadre on in the repo. |
| `/cadre doctor` | Read-only health check. Safe any time. |
| `/cadre <goal>` · `/cadre yolo <goal>` | Start work; after approval it runs to dev, asking at the critical points (auto) or not at all (yolo). |
| `/cadre open` · `/cadre status` | Open the board pane · print the board as text. |
| Settings | Press `9` in the pane: every setting, where its value comes from, and buttons to change it. |

Every decision is a dialog (`1` opens it). The typed fallbacks, config keys and the extension protocol are in [docs/commands.md](docs/commands.md).

## Requirements

- Claude Code **2.1.295** (tested; newer usually works and only warns)
- `git`
- `bd` ≥ 1.3.0. `/cadre setup` installs it.
- Linux: `bwrap` (bubblewrap) and `socat` for sandboxed checks. macOS: setup tells you what is needed.

## Troubleshooting

- **Run `/cadre doctor` first.** It lists every failing check and how to fix it. The full report is in the pane's Doctor tab.
- **"cadre is off in this repo"**: run `/cadre init`.
- **Ubuntu 24.04+ blocks bwrap (AppArmor).** cadre never runs root commands for you. It writes a fix script to `~/.cache/cadre/fix/`. Read it, then run the line Claude shows you, e.g. `sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh`.
- Known limits: [docs/limitations.md](docs/limitations.md).

## Philosophy

- **Enforced by code.** Hooks deny what the rules forbid. A prompt can be ignored; a denial cannot.
- **Main plans, never edits.** The agent that talks to you cannot touch your source.
- **Computed beats claimed.** Tests pass because cadre ran them, not because an agent said so.
- **Local first.** Your tasks and git history stay on your machine. cadre never pushes.
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

Version 0.7.0. Pre-1.0, pinned to Claude Code 2.1.295. License: not chosen yet.
