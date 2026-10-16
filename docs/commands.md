# Commands, loop, config

You type five forms ([ADR 0011](adr/0011-lanes.md)):

| Typed | Effect |
|---|---|
| `/cadre` | open the pane (Needs you on top when a decision waits) |
| `/cadre <goal>` | Claude picks a lane (ask · lite · full) with a reason, sends one explorer and scores the goal's clarity (a vague goal: at most `planning.clarify.maxQuestions` questions in one round; yolo: assumptions in the dialog), then drafts it; the approval dialog shows the lane and offers to change it |
| `/cadre deep <goal>` | one explorer, then one question per round at the weakest of outcome · scope · acceptance · constraints (scores shown) until clear, `planning.deep.maxRounds`, or "enough"; then the plan as for `/cadre <goal>` ([ADR 0020](adr/0020-planning-clarify-deep.md)) |
| `/cadre setup` · `/cadre init` · `/cadre doctor` | machine setup · project setup · read-only diagnosis |

An old subcommand word (`approve`, `status`, `open`, …) answers `that's answered in the dialog now: press 1 on the band or run /cadre` and runs nothing, so a typo never starts a plan. The table below is the command set behind the **decision dialog's options** and the pane's Settings tab; it is not typed.

## Commands
| `/cadre …` | Who | Effect |
|---|---|---|
| `approve <id>` | dialog | approve the plan (or gate) answered in the dialog; refused if it changed while the dialog was open |
| `reject <planId> <why>` | human | drop drafts |
| `resolve <id> keep\|accept\|reject\|cancel` · `resolve git keep\|restore` | human | clear flags / quarantined git effects |
| `release [x.y.z]` | human | cut a release |
| `setup [cancel]` | human | one-time machine setup, done by Claude, checked by cadre |
| `doctor` | anyone | read-only diagnosis, report in the cadre pane |
| `init [cancel \| confirm]` | human | project setup, done by Claude, checked by cadre; `confirm` = the safety settings decision |
| `sync add <adapter>` · `sync [now]` | human · anyone | external tracker setup · wake sync |
| `config [show]` | anyone | print the settings that differ from the defaults. Changing one: press `9` in the pane (Settings tab) |
| `drive stop\|resume\|status` | `stop`/`resume`: human (band key `2`) | drive is armed at approval in the plan's mode, auto (`/cadre <goal>`) or yolo (`/cadre yolo <goal>`); see [ADR 0013](adr/0013-tui-v2-and-autonomy.md) |
| `status` | anyone | text board and cost line |
| `open [epic\|plan\|task <id>\|sync\|cost\|release\|init]` | anyone | open the `cadre` pane tab |

**Decisions in the dialog (0.8.0).** Every human action above is a *decision*, answered only in Claude Code's own question dialog: the question, at most 6 lines, its options (Approve/Reject, Confirm/Cancel, Accept/Reject, Keep/Restore, Release/Not now) and "Type something", which sends your text to Claude as a change request. The dialog opens by itself once, when the decision appears; after that `1` (band or pane) opens it again. The pane lists every pending decision read-only under **NEEDS YOU**. The answer is bound to the decision's content hash, so one that changed while the dialog was open is refused and asked again. `-p` cannot approve. See [ADR 0012](adr/0012-decisions-by-press-or-dialog.md).


Main's tools: `plan`, `task`, `epic`, `amend`, `explore`, `ask`, `status` (and `preferences` during setup); the built-in task tools are off in a set-up project. Agents use three MCP tools: `report`, `inspect`, `run_check`.

## The loop in detail
0. **Lane.** `/cadre <goal>` hands Claude the goal and a short guide. It picks **ask** (one explorer answers; no plan), **lite** (one `plan` call with `{"lane":"lite","reason","type","changelog"}` drafts the plan and its one task; completeness is title, description and the changelog decision; pipeline worker → green → reviewer → merge, or tester → red first for a bug with `"repro": true`) or **full** (below). cadre overrides to full when a task is breaking, labeled or scoped `security`, declares a new or changed public contract symbol, or the plan has 3+ tasks (lite also has exactly one task). Same guards for every lane: main never edits, work happens in worktrees, review is bound to a commit, merges are squashed.
1. **Plan.** Main drafts a plan with `plan`, then one `task` per task. Each task has a `type`, `package`, Given/When/Then `scenarios`, a `changelog` entry or `{none, reason}`, and an interface `contract`. Drafts live in the task store and never run.
2. **Approve.** The plan's dialog appears (the Plan tab shows the full sheet); choose **Approve**. Only the dialog approves, bound to what it showed. The mod cuts `epic/<id>-<slug>` from `dev` and tells Claude to run the plan to the end.
3. **Execute.** Main spawns `Agent` for a task. The mod claims it, makes a worktree, and runs the pipeline: `cadre:tester` (sees only the spec view) → red check must fail → `cadre:worker` → green check must pass → `cadre:reviewer` (verdict bound to a commit). Rework resumes the same agent; cap `review.maxRework`.
4. **Close.** Main sets the task `completed`; the mod squashes into the epic branch. When all tasks are done, completing the epic merges `--no-ff` into `dev`.
5. **Release.** `/cadre release [x.y.z]` cuts the changelog and merges `dev` into `main`. cadre never pushes.

Types (`feature`, `bug`, `refactor`, `docs`, `test`, `spike`) and their pipelines come from the registry (config `types`).

## Per project: the first `/cadre <goal>` (or `/cadre init`)
The first goal in a repo cadre hasn't seen asks once to set it up; then Claude follows the init guide, you confirm the safety settings, and the plan comes up with its mission for one approval. `/cadre init` re-runs the setup on purpose. The checklist has these items:

| Item | Done when |
|---|---|
| repository | git repo with a first commit, the main and `dev` branches, `.git/info/exclude` lines, `branches` in `.cadre/config.json` (this file turns cadre on in the repo) |
| task store | `.cadre/state` (plain files, excluded from git) answers its probe: hard links work there |
| mission | goal, constraints, non-goals: Claude asks you, drafts it, **you approve it in the dialog** |
| build and test commands | `packages` in `.cadre/config.json`, found by Claude from CI config, manifests and the README |
| commands pass on a clean checkout | cadre runs each package's setup and checks in a jail, offline; a failing one goes back to Claude |
| workflow | the type registry and roles resolve (defaults unless you change them) |
| changelog | `CHANGELOG.md` in Keep a Changelog 1.1.0 |
| safety settings | sandbox settings, the cache folders learned above and the task-tool gate (built-in task tools off, the todo list on; applies after a restart): cadre shows the diff in a dialog and **writes it only after you confirm** |

Sync with an external tracker is separate and optional: `/cadre sync add <adapter>`.

## Config
Layers, low → high: built-in defaults → plugin `userConfig` → `~/.claude/cadre.json` (with per-repo sections) → repo `.cadre/config.json` (main checkout) → env (`CADRE_STRICTNESS`, `CADRE_STORE`, `CADRE_DISABLE`) → the Settings tab. **S** keys: a repo file may only tighten them. **U**: user-level only. **O**: ordinary.

**Settings tab** (pane, hotkey `9`): every setting, grouped by category (Drive and autonomy, Parallelism, Models and effort, Review, Planning, Git and branches, Checks and TDD, Safety and containment, Cache and context, Task store and sync, UI), one row per key with its effective value and its source: `default`, `user`, `repo`, `env`, `forced` (a Claude Code variable overrides it: `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` or `CLAUDE_CODE_EFFORT_LEVEL`; the row says what it does) or `fixed` (an invariant shown for transparency, not settable). The selected row shows its default, its layer rule ("tighten-only from repo" for S keys, "user-level only" for U keys) and what it does. `n`/`p` move, `e` acts on the selected row (a bool toggles, an enum cycles, a number, text, list or JSON value asks in the dialog; a bad value is refused with the reason and asked again). Only a human press writes, and cadre writes the file, never Claude: `~/.claude/cadre.json` ("save for me"; a key already set in this repo's section stays there), or for O keys also the committed `.cadre/config.json` ("save to repo"). Every write keeps a `.bak` and is read back. `strictness` cannot change while tasks run.

The keys, their categories, allowed values, defaults and descriptions live in one table, `REG` in `config/defaults.ts` (ADR 0019); the Settings tab and `/cadre doctor` show it with the effective values. A bad key or value in any file is refused with a reason (doctor lists it) and the rest of the file still applies.

## Surfaces
- **Band + `cadre` pane** (`ui/`): Epic and Plan tabs, approval sheet, events, timeline. Read-only clients of one versioned read model.
- **Text:** `/cadre status`, toasts, the card returned in the Agent result.
- **Extension protocol** ([`docs/protocol.md`](docs/protocol.md)): events, snapshot, commands, and external process adapters over one protocol; adapters get the model view only and need grants.
- **Plan tools:** main's own tools answered by the mod; plan rules arrive just in time with the first `plan`.

## Out of scope (v1)
| Item | Why | Ever? |
|---|---|---|
| Parsing shell command text or stderr; deny lists of channels | Brittle; layers decide on effects, not text | never |
| Language/ecosystem presets in code | Stack specifics are discovered and validated config | never |
| Magic keywords, Stop-hook loops, `/goal`, statusLine HUD command, skills | One loop authority | never |
| Op-log sync queue | Sync is state-based reconciliation | never |
| Pane teammates, agent teams, workflow agents | Unseen or rewrite-proof | roadmap (in-process teammates) |
| Creating remote projects or custom fields | Admin actions; setup maps to what exists | roadmap flag |
| Everything on the DESIGN §15 roadmap line | Budget, YAGNI | roadmap |

cadre stops **model drift**, not the user: a user-tier mod can be switched off. It never pushes.

## Known limitations
From the M0 spike ([ADR 0001](docs/adr/0001-m0-results.md)):
- **PENDING-HUMAN smokes** (need an interactive TUI): S22 (background workers across `/clear`), S37 (`!` raises no `tool.call`), S48 interactive `/goal`, S49 trigger (`$.session.compact()` is unavailable headless, so the 60 % context hint is a toast, not an automatic compact). S41's MCP grant is rechecked at M3.
- **A restored `/goal` is undetectable** (S48, A27). After `/resume` with drive on, a one-time band hint appears. Do not combine a restored `/goal` with a running drive: two loops would run (stop one with `2`). `/goal` typed in the session is observed as prompt text and pauses drive.
- **No bwrap overlay** (needs ≥ 0.11; hosts have 0.8/0.9). Checks run in a **copy-jail**: a throwaway copy of the worktree, writable, network off. The cache audit uses an empty scratch `HOME` listing.
- **The drive record and the sync leases and cursors** live in the task store's one control doc, changed by compare-and-set on its revision ([ADR 0027](adr/0027-own-the-workflow.md)). Drive continues after `/clear` (DESIGN §9).
- **Tester has Read/Write/Edit only** (this build exposes no Grep/Glob, S45); briefs name the paths. Plan B (ADR 0004) is not needed.
- **Headless (`-p`) runs end with main's turn** (a background agent is killed): spawn agents in the foreground. `plugin eval --allow-tools` refuses `mcp__*`: name `mcp__cadre__report mcp__cadre__inspect mcp__cadre__run_check`. Live results: [ADR 0005](docs/adr/0005-live-results.md).
- **`!` shell commands** in a human session may bypass the hooks (A20 unverified); the effect check treats such changes as human.
- Per-repo state: the mod's policy (repo, worktree root, locks) is keyed per repo, so two repos in one user config do not share it.
- Workers cannot `git add/commit` (repo-level `denyWrite`, S24): the mod commits. `/tmp` is not writable for subagents; use `$TMPDIR`.
- Per-agent 1 h cache TTL needs plugin agent files and may be ignored on accounts without usage credits; cadre reads the usage fields to detect it.

