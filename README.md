# cadre

A Claude Code mod that makes planning, approval and execution an enforced loop. Main plans and manages; it never edits code and has no shell. Each approved task runs its type's pipeline in its own git worktree (tester red → worker green → independent review → merge). The mod owns git; workers cannot commit or push. State lives in [beads](https://github.com/gastownhall/beads) (`bd`).

Design: `design/DESIGN.md` v2.5 · UI: `design/UI-DESIGN.md` · M0 results: [`docs/adr/0001-m0-results.md`](docs/adr/0001-m0-results.md) · extension protocol: [`docs/protocol.md`](docs/protocol.md) · module contracts: [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

## Requirements
- Claude Code **2.1.295** (the pinned build), `git`, `bd` **≥ 1.3.0** (tested with 1.3.1), `bwrap` (bubblewrap ≥ 0.8) for jailed checks.
- Per repo: whatever toolchain its checks need (discovered, never assumed).

## Install / load
```bash
CC=~/.local/share/claude/versions/2.1.295   # the pin; do not use PATH `claude`
$CC plugin validate --strict ./cadre
$CC plugin test ./cadre
$CC --plugin-dir ./cadre            # in the repo you want to manage
```
Debug a run: add `--debug-file cadre.log`.

## First run: `/cadre init`
`/cadre init` runs the next incomplete stage; `/cadre init <stage>` re-runs one. Each stage proposes a diff, waits for `/cadre init confirm <code>` typed by you, validates by running, then saves (a `.bak` is written first). The code is redrawn on every attempt.

| # | Stage | Result |
|---|---|---|
| 1 | repo | git repo, default branch, `dev` branch, `.git/info/exclude` |
| 2 | store | `bd init`, custom statuses/types, journal consent |
| 3 | mission | goal, constraints, non-goals recorded as a milestone |
| 4 | discovery | explorer reads CI/manifests; setup and checks are validated in a jail |
| 5 | containment | sandbox settings merge + learned cache dirs |
| 6 | workflow profile | type registry, role tiers, `tdd.author`, drive bounds |
| 7 | changelog | Keep-a-Changelog skeleton |
| 8 | sync (optional) | external tracker adapter |

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
| `init [<stage>] [confirm <code>]` | human | staged setup |
| `sync add <adapter>` · `sync [now]` | human · anyone | external tracker setup · wake sync |
| `adapter token` | human | new adapter session token (toast only) |
| `config [show\|set <k> <v>]` | `set`: human | show/change config |
| `drive on\|off\|status` | `on`/`off`: human | autonomy: cadre's own bounded goal |
| `status` | anyone | text board and cost line |
| `open [epic\|plan\|task <id>\|sync\|cost\|release\|init]` | anyone | open the `cadre` pane tab |

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
```
Live smokes: [`tests/smoke/`](tests/smoke) (S01–S61). Real-model evals: [`evals/`](evals), run through the harness (`harness/run.sh`), never on the host. Decisions: [`docs/adr/`](docs/adr).
