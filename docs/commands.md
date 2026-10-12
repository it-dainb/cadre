# Commands, loop, config

You type five forms ([ADR 0011](adr/0011-lanes.md)):

| Typed | Effect |
|---|---|
| `/cadre` | open the pane: the card when a decision waits, else the epic |
| `/cadre <goal>` | Claude picks a lane (ask · lite · full) with a reason and drafts it; the card shows the lane and **[l]** changes it |
| `/cadre setup` · `/cadre init` · `/cadre doctor` | machine setup · project setup · read-only diagnosis |

An old subcommand word (`approve`, `status`, `open`, …) answers `that's a button now: press 1 on the band or run /cadre` and runs nothing, so a typo never starts a plan. The table below is the command set behind the **buttons on the cadre card** and the pane's tabs; it is not typed.

## Commands
| `/cadre …` | Who | Effect |
|---|---|---|
| `approve <id>` | press | approve the plan (or gate) whose card was pressed; refused if the card changed |
| `reject <planId> <why>` | human | drop drafts |
| `resolve <id> keep\|accept\|reject\|cancel` · `resolve git keep\|restore` | human | clear flags / quarantined git effects |
| `release [x.y.z]` | human | cut a release |
| `setup [cancel]` | human | one-time machine setup, done by Claude, checked by cadre |
| `doctor` | anyone | read-only diagnosis, report in the cadre pane |
| `init [cancel \| confirm]` | human | project setup, done by Claude, checked by cadre; `confirm` = the safety settings card |
| `sync add <adapter>` · `sync [now]` | human · anyone | external tracker setup · wake sync |
| `config [show]` | anyone | print the settings that differ from the defaults. Changing one: press `9` in the pane (Settings tab) |
| `drive on\|off\|status` | `on`/`off`: human | autonomy: cadre's own bounded goal |
| `status` | anyone | text board and cost line |
| `open [epic\|plan\|task <id>\|sync\|cost\|release\|init]` | anyone | open the `cadre` pane tab |

**Decisions by click (0.4.0).** Every human action above also appears as a *decision card* in the cadre pane (`1` on the band opens it; it opens itself when there is room): a framed box with the question, a short description and buttons (Approve/Reject/Change, Confirm/Cancel, Accept/Reject, Keep/Restore, Release). A button press (or, where no pane draws, the same decision as an ask dialog) is the only human evidence; it is bound to the card's content hash, so a stale card is refused and redrawn. `-p` cannot approve. See [ADR 0008](adr/0008-click-decisions.md) and [ADR 0012](adr/0012-decisions-by-press-or-dialog.md).


Native tools main uses: `TaskCreate/Update/List/Get`, `Agent`. Agents use three MCP tools: `report`, `inspect`, `run_check`.

## The loop in detail
0. **Lane.** `/cadre <goal>` hands Claude the goal and a short guide. It picks **ask** (one explorer answers; no plan), **lite** (one `TaskCreate` with `{"kind":"plan","lane":"lite","reason","type","changelog"}` drafts the plan and its one task; completeness is title, description and the changelog decision; pipeline worker → green → reviewer → merge, or tester → red first for a bug with `"repro": true`) or **full** (below). cadre overrides to full when a task is breaking, labeled or scoped `security`, declares a new or changed public contract symbol, or the plan has 3+ tasks (lite also has exactly one task). Same guards for every lane: main never edits, work happens in worktrees, review is bound to a commit, merges are squashed.
1. **Plan.** Main drafts a plan with `TaskCreate` (`metadata.kind:"plan"`, then tasks). Each task has a `type`, `package`, Given/When/Then `scenarios`, a `changelog` entry or `{none, reason}`, and an interface `contract`. Drafts live in beads and never run.
2. **Approve.** The plan card appears (the Plan tab shows the full sheet); press **Approve**. Only the press (or the ask dialog) approves, bound to what the card showed. The mod cuts `epic/<id>-<slug>` from `dev`.
3. **Execute.** Main spawns `Agent` for a task. The mod claims it, makes a worktree, and runs the pipeline: `cadre:tester` (sees only the spec view) → red check must fail → `cadre:worker` → green check must pass → `cadre:reviewer` (verdict bound to a commit). Rework resumes the same agent; cap `review.maxRework`.
4. **Close.** Main sets the task `completed`; the mod squashes into the epic branch. When all tasks are done, completing the epic merges `--no-ff` into `dev`.
5. **Release.** `/cadre release [x.y.z]` cuts the changelog and merges `dev` into `main`. cadre never pushes.

Types (`feature`, `bug`, `refactor`, `docs`, `test`, `spike`) and their pipelines come from the registry (config `types`).

## Per project: `/cadre init`
Claude follows the init guide; the checklist has these items:

| Item | Done when |
|---|---|
| repository | git repo with a first commit, the main and `dev` branches, `.git/info/exclude` lines, `branches` in `.cadre/config.json` (this file turns cadre on in the repo) |
| task store | `bd init` with cadre's statuses and types, journal on |
| mission | goal, constraints, non-goals: Claude asks you, drafts it, **you approve it on its card** |
| build and test commands | `packages` in `.cadre/config.json`, found by Claude from CI config, manifests and the README |
| commands pass on a clean checkout | cadre runs each package's setup and checks in a jail, offline; a failing one goes back to Claude |
| workflow | the type registry and roles resolve (defaults unless you change them) |
| changelog | `CHANGELOG.md` in Keep a Changelog 1.1.0 |
| safety settings | sandbox settings plus the cache folders learned above: cadre shows the diff on a card and **writes it only after you confirm** |

Sync with an external tracker is separate and optional: `/cadre sync add <adapter>`.

## Config
Layers, low → high: built-in defaults → plugin `userConfig` → `~/.claude/cadre.json` (with per-repo sections) → repo `.cadre/config.json` (main checkout) → env (`CADRE_STRICTNESS`, `CADRE_STORE`, `CADRE_DISABLE`) → the Settings tab. **S** keys: a repo file may only tighten them. **U**: user-level only. **O**: ordinary.

**Settings tab** (pane, hotkey `9`): groups Workflow, Agents & models, Drive, Cost, Sync, UI, Security; one row per key with its value, its source (`[default]` `[user]` `[repo]` `[env]`) and, for S keys, "tighten-only from repo", for U keys "user-level only". `n`/`p` move, `e` acts on the selected row (a bool toggles, an enum cycles, a number, text or list opens a card with a field; a bad value is refused on the card). Only a human press writes, and cadre writes the file, never Claude: `~/.claude/cadre.json` ("save for me", the default; a key already set in this repo's section stays there), or for O keys also the committed `.cadre/config.json` ("save to repo"). Every write keeps a `.bak` and is read back. S and U keys never go to the repo file; `strictness` cannot change while tasks run.

| Key | Class | Default |
|---|---|---|
| `strictness` | S | `strict` (`advisory` turns denials into warnings) |
| `mcpAllow` | S | `[]` |
| `jail`, `jailWritable` | S | `auto`, `[]` |
| `effectCheck` | S | `auto` |
| `roles.testerView` | S | `view` (`full` = tester sees the worktree) |
| `adapters.<name>` | U | none |
| `store.kind`, `store.bin`, `store.dir` | U | `beads`, `bd`, repo |
| `worktrees.root` | U | `${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt` |
| `drive.{level,maxTurns,maxCostUsd,maxWallMinutes,noProgressTurns}` | U | `epic`, 100, 20, 240, 3 |
| `cost.prices`, `disable` | U | none, `false` |
| `store.timeoutMs`, `store.pollMs` | O | 45000, 10000 |
| `types` | O | feature/bug/refactor/docs/test/spike |
| `roles.<worker\|tester\|reviewer\|explorer>.{tier,effort}` · `roles.tdd.author` | O | standard/default (explorer fast/low) · `separate` |
| `models` | O | `{fast: haiku, standard: sonnet, deep: opus}` |
| `packages[]` | O | discovered and validated by `/cadre init` |
| `suites.integration` | O | `all` |
| `review.{deepLabels,maxRework}` · `limits.reportRetries` | O | `["security","breaking"]`, 3 · 3 |
| `changelog.path` | O | `CHANGELOG.md` |
| `branches.{main,dev,epicPrefix}` | O | init · `dev` · `epic/` |
| `release.onEpicDone` | O | `propose` |
| `ui.glyphs` | O | `unicode` (`ascii` for fonts without the glyphs) |
| `maxParallel`, `maxRows` | O | 3, 6 |
| `reuse.{maxContextPct,cacheTtlMs}` | O | 60, 3600000 |
| `cost.{clearHintPct,compactPct}` | O | 40, 60 |
| `sync.<target>` | O | none |

## Surfaces
- **Band + `cadre` pane** (`ui/`): Epic and Plan tabs, approval sheet, events, timeline. Read-only clients of one versioned read model.
- **Text:** `/cadre status`, toasts, the card returned in the Agent result.
- **Extension protocol** ([`docs/protocol.md`](docs/protocol.md)): events, snapshot, commands, and external process adapters over one protocol; adapters get the model view only and need grants.
- **Native tools:** Task* answered by the mod; plan rules arrive just in time with the first `TaskCreate`.

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
- **A restored `/goal` is undetectable** (S48, A27). After `/resume` with drive on, a one-time band hint appears. Do not combine a restored `/goal` with `/cadre drive on`: two loops would run. `/goal` typed in the session is observed as prompt text and pauses drive.
- **No bwrap overlay** (needs ≥ 0.11; hosts have 0.8/0.9). Checks run in a **copy-jail**: a throwaway copy of the worktree, writable, network off. The cache audit uses an empty scratch `HOME` listing.
- **bd 1.3.1 has no `--if-revision`.** Drive and sync leases live as metadata on the `cadre-control` issue, with read-check-write-reread (guarded by `--if-assignee/--if-status`). Drive continues after `/clear` (DESIGN §9).
- **Tester has Read/Write/Edit only** (this build exposes no Grep/Glob, S45); briefs name the paths. Plan B (ADR 0004) is not needed.
- **Headless (`-p`) runs end with main's turn** (a background agent is killed): spawn agents in the foreground. `plugin eval --allow-tools` refuses `mcp__*`: name `mcp__cadre__report mcp__cadre__inspect mcp__cadre__run_check`. Live results: [ADR 0005](docs/adr/0005-live-results.md).
- **`!` shell commands** in a human session may bypass the hooks (A20 unverified); the effect check treats such changes as human.
- Per-repo state: the mod's policy (repo, worktree root, locks) is keyed per repo, so two repos in one user config do not share it.
- Workers cannot `git add/commit` (repo-level `denyWrite`, S24): the mod commits. `/tmp` is not writable for subagents; use `$TMPDIR`.
- Per-agent 1 h cache TTL needs plugin agent files and may be ignored on accounts without usage credits; cadre reads the usage fields to detect it.

