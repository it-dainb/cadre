# cadre

A Claude Code mod that makes planning, approval and execution an enforced loop. Main plans and manages; it never edits code and has no shell. Each approved task runs its type's pipeline in its own git worktree (tester red → worker green → independent review → merge). The mod owns git; workers cannot commit or push. State lives in [beads](https://github.com/gastownhall/beads) (`bd`).

Design: `docs/design/DESIGN.md` v2.5 · UI: `docs/design/UI-DESIGN.md` · M0 results: [`docs/adr/0001-m0-results.md`](docs/adr/0001-m0-results.md) · extension protocol: [`docs/protocol.md`](docs/protocol.md) · module contracts: [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

## Install
Requirements: Claude Code **2.1.295** (the pinned build), `git`, `bd` **≥ 1.3.0** (tested with 1.3.1), `bwrap` (bubblewrap ≥ 0.8, Linux) for jailed checks. Per repo: whatever toolchain its checks need (discovered, never assumed).

From the marketplace (this repo is one):
```bash
claude plugin marketplace add it-dainb/cadre     # in Claude Code: /plugin marketplace add it-dainb/cadre
claude plugin install cadre@cadre                # in Claude Code: /plugin install cadre@cadre
```
Development (from a checkout; use the 2.1.295 binary, not whatever `claude` is on PATH):
```bash
CC=<path to claude 2.1.295>
$CC plugin validate --strict . && $CC plugin test .
$CC --plugin-dir .                  # in the repo you want to manage
```
Debug a run: add `--debug-file cadre.log`. Live smokes/evals run in Docker via [`harness/`](harness/README.md) (also able to install from the marketplace: `CADRE_SOURCE=marketplace`). Live evidence (`docs/evidence/`) is local-only and gitignored.

## First run: `/cadre setup`, then `/cadre init`
Both are run by Claude, in the open: the command hands Claude one short prompt ("Follow `<plugin>/guides/setup.md` step by step"), and you watch its Bash, Read and Write calls in the transcript, with the usual spinner and timer. The guides ([`guides/setup.md`](guides/setup.md), [`guides/init.md`](guides/init.md)) list each phase with the exact commands and what "done" means. cadre itself only checks: after each of Claude's turns it runs the checks again, ticks the checklist card (`✓` done, `✗` Claude's to fix, `…` waits for you, `·` later), and if something Claude owns still fails it sends one follow-up naming the failing check (at most 3 per run; then the card shows what is left and [r] Retry). A run ends when every check passes, on [x] Cancel, or after 20 Claude turns / 30 minutes. During a run Claude may use Bash and edit only the setup files (`.cadre/`, `.git/info/exclude`, `.claude/settings.local.json`, `CHANGELOG.md`, `~/.claude/settings.json`, `~/.claude/cadre.json`), never source files; only a `/cadre setup|init` you type or press starts one. See ADR 0010.

`/cadre setup` (once per machine) checks Claude Code, `git` and your git identity, `bd` >= 1.3.0, `bwrap`, `socat`, the worktree root and the user settings cadre relies on. Claude asks you (AskUserQuestion) for anything only you know, such as your git name and email, installs `bd` at user level, moves a stale `bd` in a folder you own aside as `bd.cadre-old`, and merges the settings (with a `.bak`). What needs root (installing bubblewrap and socat, the AppArmor profile for bwrap on Ubuntu 24.04+, removing a stale `bd` from a system folder) is never run for you: cadre writes each fix as a script under `~/.cache/cadre/fix/` (read it first; it does nothing until you run it), Claude gives you the one line to paste into a terminal (e.g. `sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh`) and asks when you are done; the next check sees the result. Less safe alternatives are only described in `~/.cache/cadre/fix/README`. A newer Claude Code than the tested build only warns. `/cadre doctor` re-runs the machine checks and adds the project ones (init, containment, beads, branches, leases, flags, sync, drive); it is read-only and safe any time. The full report is in the pane's `8: Doctor` tab.

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

## The loop
1. **Plan.** Main drafts a plan with `TaskCreate` (`metadata.kind:"plan"`, then tasks). Each task has a `type`, `package`, Given/When/Then `scenarios`, a `changelog` entry or `{none, reason}`, and an interface `contract`. Drafts live in beads and never run.
2. **Approve.** You run `/cadre approve <planId>`; the Plan tab shows the sheet. Approval needs a human origin (composer; SDK only if `approval.allowSdk`) and burns its code on every attempt. The mod cuts `epic/<id>-<slug>` from `dev`.
3. **Execute.** Main spawns `Agent` for a task. The mod claims it, makes a worktree, and runs the pipeline: `cadre:tester` (sees only the spec view) → red check must fail → `cadre:worker` → green check must pass → `cadre:reviewer` (verdict bound to a commit). Rework resumes the same agent; cap `review.maxRework`.
4. **Close.** Main sets the task `completed`; the mod squashes into the epic branch. When all tasks are done, completing the epic merges `--no-ff` into `dev`.
5. **Release.** `/cadre release [x.y.z]` cuts the changelog and merges `dev` into `main`. cadre never pushes.

Types (`feature`, `bug`, `refactor`, `docs`, `test`, `spike`) and their pipelines come from the registry (config `types`).

## Commands
| `/cadre …` | Who | Effect |
|---|---|---|
| `approve <id>` · `approve <id>@<code8>` | human | open the sheet · approve (code burned on use) |
| `reject <planId> <why>` | human | drop drafts |
| `resolve <id> keep\|accept\|reject\|cancel` · `resolve git keep\|restore` | human | clear flags / quarantined git effects |
| `release [x.y.z]` | human | cut a release |
| `setup [cancel]` | human | one-time machine setup, done by Claude, checked by cadre |
| `doctor` | anyone | read-only diagnosis, report in the cadre pane |
| `init [cancel \| confirm <code>]` | human | project setup, done by Claude, checked by cadre; `confirm` = the safety settings card |
| `sync add <adapter>` · `sync [now]` | human · anyone | external tracker setup · wake sync |
| `adapter token` | human | new adapter session token (toast only) |
| `config [show\|set <k> <v>]` | `set`: human | show/change config |
| `drive on\|off\|status` | `on`/`off`: human | autonomy: cadre's own bounded goal |
| `status` | anyone | text board and cost line |
| `open [epic\|plan\|task <id>\|sync\|cost\|release\|init]` | anyone | open the `cadre` pane tab |

**Decisions by click (0.4.0).** Every human action above also appears as a *decision card* in the cadre pane (`1` on the band opens it; it opens itself when there is room): a framed box with the question, a short description and buttons (Approve/Reject/Change, Confirm/Cancel, Accept/Reject, Keep/Restore, Release). A button press is human evidence and runs the same command bound to the code it was drawn with; a stale card is refused and redrawn. Where nothing draws (VS Code, `-p`) the typed commands above are unchanged. See [ADR 0008](docs/adr/0008-click-decisions.md).

Native tools main uses: `TaskCreate/Update/List/Get`, `Agent`. Agents use three MCP tools: `report`, `inspect`, `run_check`.

## Config
Layers, low → high: built-in defaults → plugin `userConfig` → `~/.claude/cadre.json` (with per-repo sections) → repo `.cadre/config.json` (main checkout) → env (`CADRE_STRICTNESS`, `CADRE_STORE`, `CADRE_ALLOW_SDK_APPROVAL`, `CADRE_DISABLE`) → `/cadre config set`. **S** keys: a repo file may only tighten them. **U**: user-level only. **O**: ordinary.

| Key | Class | Default |
|---|---|---|
| `strictness` | S | `strict` (`advisory` turns denials into warnings) |
| `approval.allowSdk` | S | `false` |
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

## Development
```bash
node scripts/budget.mjs                          # LOC budget: core ≤ 5000, ui ≤ 750, 3 MCP tools, 0 skills
$CC plugin validate --strict . && $CC plugin test .
node --experimental-transform-types --test tests/git/*.mjs tests/protocol/*.mjs
node --experimental-transform-types scripts/ui-dev.mjs [scenario]   # the pane in your terminal, hot reload, step events, press buttons: docs/dev/ui-dev.md
```
Live smokes: [`tests/smoke/`](tests/smoke) (S01–S61). Real-model evals: [`evals/`](evals), run through the harness (`harness/run.sh`), never on the host. Decisions: [`docs/adr/`](docs/adr).
