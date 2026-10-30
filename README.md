# cadre

**A Claude Code plugin that makes Claude follow a workflow you define, enforced in code, not prompts. It ships one that plans, tests, reviews and merges like a disciplined team.**

```text
goal ─▶ plan ─▶ you approve ─▶ tester (red) ─▶ worker (green) ─▶ reviewer ─▶ merge ─▶ dev ─▶ you release
         ▲          │ a dialog                                                  one worktree per task
         └──────────┴─ nothing runs until you choose Approve
```

- **You approve in a dialog.** Claude drafts; Claude Code's own question dialog approves.
- **Tests first.** A separate tester writes a failing test, then a worker makes it pass.
- **Isolated and reviewed.** Each task gets its own git worktree and an independent review.
- **The workflow is data.** Steps, roles, checks, dialogs and delivery hooks live in a profile ([docs/profile.md](docs/profile.md)); `docs` and `analysis` profiles ship beside the default one above.
- **A live board** in your terminal: tasks, steps, agents, cost.
- **Local.** Tasks live in `.cadre/state` (not committed). No database. cadre pushes only if you choose pull-request landing.

## Install

```bash
claude plugin marketplace add it-dainb/cadre
claude plugin install cadre@cadre
```

## Quick start

1. `/cadre setup`: once per machine. Claude checks your tools, fixes what it can in the open, and you confirm the settings in a dialog.
2. `/cadre <goal in plain words>`, e.g. `/cadre fix the off-by-one in src/page.ts`. In a new repo one dialog sets it up first; then the plan comes up for one approval.
3. After you approve it runs to `dev` by itself (`/cadre yolo <goal>`: no questions after approval). `/cadre` alone opens the board.

The workflow, board and dialogs: [user guide](docs/guide.md). Every command: [commands](docs/commands.md). Something red: [troubleshooting](docs/troubleshooting.md).

## Read this before you rely on it

- **Linux only.** On macOS or Windows cadre says so at start, registers nothing and stays off. It needs `git`, `bwrap` and `socat`, and a disk with hard links.
- **Keep the terminal open.** Agents live in your Claude Code session. If you quit or it crashes, nothing restarts by itself; `/cadre continue` in the next session respawns each task that was in flight from a checkpoint commit.
- **A repo can run code on your machine.** Opening a repo with cadre runs that repo's profile hooks and modules (`.cadre/profile.json`, `.cadre/modules/`) with your user's permissions; only open repos you trust. Repo text also reaches agents unfiltered. Agents install what their task needs in their own shell; checks run in a jail when `bwrap` is present. The repo layer is an accepted risk with no mitigation: [known limits](docs/limitations.md).
- **No compatibility freeze.** cadre is tested on Claude Code 2.1.295 (the minimum; older builds are refused) and on newer ones as listed in [compat](docs/compat.md). A Claude Code update may break it. Newer builds warn in `/cadre doctor` and usually work.
- **The UI is English.** Another language means adding a table in `ui/tr.ts` (option and field labels only; nothing a model reads).

## Commands

| Type | Does |
|---|---|
| `/cadre setup` | one-time machine setup ([details](docs/setup-details.md)) |
| `/cadre` | where things stand; opens the board |
| `/cadre <goal>` · `yolo <goal>` · `deep <goal>` | start work · no questions after approval · talk the goal through first |
| `/cadre continue` | pick up a plan an earlier session left |
| `/cadre doctor` | read-only health check |
| `/cadre revert <id>` · `/cadre timeline` | revert a landed task, epic or milestone · per-repo cost and rework |

Every decision is a dialog; press `1` on the band to open it. Settings: press `9` in the pane. Full list and config keys: [docs/commands.md](docs/commands.md).

## Philosophy

- **Enforced by code.** Hooks deny what the rules forbid; a prompt can be ignored, a denial cannot.
- **Main plans, never edits.** The agent you talk to cannot touch your source.
- **Computed beats claimed.** A check passes because cadre ran it and read its exit code and JUnit report, never its output text.
- **Calm UI, zero token cost.** The board is drawn by the plugin.

More: [DESIGN](docs/design/DESIGN.md) · [decisions (ADRs)](docs/adr) · [known limits](docs/limitations.md) · [module contracts](docs/CONTRACTS.md)

## Development

You need the Claude Code 2.1.295 binary (not whatever `claude` is on PATH).

```bash
CC=<path to the claude binary>
node scripts/budget.mjs                      # size budget and frozen docs
$CC plugin validate --strict . && $CC plugin test .
node --experimental-transform-types scripts/ui-dev.mjs   # the pane in your terminal
```

Live runs go through Docker: [harness/README.md](harness/README.md).

## License

MIT, see [LICENSE](LICENSE).
