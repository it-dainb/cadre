# cadre live-smoke harness

Runs Claude Code **2.1.295** (installed by the official installer, build arg `CLAUDE_VERSION`) in Docker as a non-root user, with `git`, `bwrap`.

Build: `docker build -t cadre-harness harness` (fast path: put a local binary at `harness/claude-2.1.295` first; it must match the image arch)
Run:   `harness/run.sh -p "prompt" --plugin-dir /work/spike --debug-file /out/x.log --model haiku --permission-mode bypassPermissions`
Shell: `SHELL_MODE=1 harness/run.sh -c 'bwrap --version; git --version'`

Mounted (nothing else from the host; credentials are never baked into the image):
- `~/.claude/.credentials.json` -> `/cchome/.claude/.credentials.json` (that one file only; read-write so token refresh works)
- `harness/state/projects` -> `/cchome/.claude/projects` (session transcripts, so `--resume` works across runs)
- `$SPIKE` (default: the repo root) -> `/work/spike`; `$WORK` (default `$TMPDIR/cadre-harness/work`) -> `/work/run` (cwd); `$OUT` (default `harness/out`) -> `/out`

Flags: `--user <hostuid>` (so the creds file is readable), `--security-opt seccomp=unconfined apparmor=unconfined systempaths=unconfined` (bubblewrap needs user namespaces and a fresh /proc under --unshare-pid; Docker masks /proc otherwise; see ADR 0001).

Install from the marketplace instead of the checkout: `CADRE_SOURCE=marketplace [CADRE_REF=<branch|tag>] harness/run.sh -p "..." --model haiku` (no `--plugin-dir`; runs `claude plugin marketplace add it-dainb/cadre[#ref]` + `claude plugin install cadre@cadre` in the container first; needs network). Same env for `tui.sh start`.

## Interactive TUI (tmux): `tui.sh`

For long-lived behaviour and composer/pane smokes (typed `/cadre …`, `/clear`, `--resume`, pane keys) that `claude -p` cannot reach. The image has `tmux`; `tui.sh` starts a detached container (same mounts as `run.sh`, but per-instance `projects` so transcripts never mix with other runs), starts `claude --plugin-dir /work/spike --debug-file /out/debug.log` inside a tmux session of a fixed size, and drives it with `docker exec … tmux`.

```
SCAFFOLD=<script run in the empty scratch dir> COLS=120 ROWS=40 MODEL=haiku harness/tui.sh start <name>   # prints "ready"
harness/tui.sh send <name> '/cadre status'            # types the text, then Enter  (type = no Enter; keys = tmux keys: Up Enter C-u Escape)
harness/tui.sh wait-for <name> '<regex>' [secs] [pane|jsonl|debug]   # exit 0 + the match, 1 on timeout
harness/tui.sh capture <name> [file]                   # pane text;   jsonl <name> / debug <name>: transcript / debug-log paths
harness/tui.sh resize <name> 60 40                     # re-run the layout at another width
harness/tui.sh stop <name>                             # evidence stays in /tmp/cadre-tui/<name> (TUI_DIR)
```
Layout of `$TUI_DIR/<name>/`: `plug/` (the plugin = `git archive HEAD` of `cadre/`), `work/` (cwd, the scaffolded repo), `projects/` (session transcripts, subagents under `<session>/subagents/`), `out/debug.log`.
**Commit first.** A cell runs `git archive HEAD`, so uncommitted edits are NOT tested: commit (on a branch) before you judge a fix.

First-run dialogs: `~/.claude.json` is pre-seeded (onboarding done, dark theme, `/work/run` trusted) so none appear with `--permission-mode bypassPermissions`; `start` still answers any trust/theme/accept prompt with Enter (the bypass-mode warning gets Down+Enter) until the composer shows, and fails with the pane text if it never does.

Notes: the pane (`/cadre`) docks beside the transcript at 120 cols and sits inline at 60; hotkeys (`a`, `x`, arrows) work only while the pane is focused, which `/cadre open` requests when the composer is empty. A bare digit `1` in an empty composer presses the band. `wait-for … jsonl` greps the concatenated transcripts (all sessions of that instance). Graders/drivers used for ADR 0005: `docs/evidence/live/tui/` (local-only, gitignored).

## Matrix: fixtures × perturbations × environments, judged by an oracle

Real users broke what clean single-package runs never did (a monorepo, `/clear` then a `cd`, a retyped goal, a folder with no git, a main that stops early, Claude Code 2.1.296 through claude-code-router). The matrix runs those situations live and judges them from the logs.

```
harness/matrix.sh quick -n                 # list the cells + cost/time estimate, run nothing
harness/matrix.sh quick [-j 7]             # every release: all 7 cells at once (wall time = the slowest cell), prints the verdict table (exit 1 if any cell fails)
harness/matrix.sh milestone                # the milestone lane: a 2-epic goal, both epic plans from planner agents, landed on dev
SPIKE=/path/to/other/checkout harness/matrix.sh quick    # judge another commit (git archive HEAD of that checkout)
FILTER='user1|ccr' harness/matrix.sh full  # the cross product (manual runs), a subset by cell name
harness/cell.sh <name> "<fixtures>" <scenario>          # one cell, e.g. cell.sh x "monorepo leftover" user1 (env: MODEL CC_VERSION VIA LAZY FAULT CWD BUDGET LANDED)
```
Evidence per cell: `harness/out/matrix/<tier>-<stamp>/<cell>/` (gitignored): `driver.log` (what the driver did), `panes/<ms>.txt` (a capture each time the screen changed), `debug-*.log`, `jsonl/`, `verdict.json`; `table.txt` per run.

| Piece | What it is |
|---|---|
| `fixtures/*.sh` | Make the repo in the empty work dir. A **base** (`single`, `monorepo` = package in `kit/` + main + dev, `nogit`) then **overlays** (`gitignore` tracked, `red` = a failing test at start, `ready` = cadre already set up, `leftover` = a board pointer to a draft the store cannot back). `_base.sh` has `gi` (git init + commit), `commit`, `seed <key> <json>` (a `$.store` key; tui.sh copies `.harness-store.json` into the container). Every cell also seeds the machine-setup stamp. |
| `scenarios/*.sh` | Plain bash, sourced by `cell.sh` after Claude Code is up. Steps: `goal "<text>"`, `send "<text>"`, `clear_` (`/clear`), `shell_cd <dir>` (main runs `cd` in Bash), `hold <s>` (dialogs stay unanswered that long), `pause1`/`resume1`, `restart` (quit + start in the same container; scenario `kill` + `FAULT=kill` is the crash variant), `idle`, `until_log <regex> [s]`, `until_plan [s]`. `$GOAL` is the default goal. |
| watcher (in `cell.sh`) | Every 2 s: saves the pane when it changed; answers an open dialog with option 1 after `DIALOG_WAIT` s (2); records the plan dialog and stops there (`LANDED=1`: approves it); presses `1` when the band says `press 1` and no turn runs. |
| knobs | `MODEL=haiku\|sonnet\|opus`, `CC_VERSION=2.1.295\|2.1.296` (the host build from `~/.local/share/claude/versions/<v>` mounted over the image's), `VIA=ccr`, `LAZY=1` (`lazy.txt` appended to main's system prompt: stop early, skip steps), `CWD=kit` (start Claude Code in a subfolder), `BUDGET` (s, 600), `LANDED=1` (approve and require the plan to land on dev), `FAULT=interrupt` (the watcher presses Esc in the setup run after main's 2nd Bash call: a turn that ends with no normal stop, the class of a stop lost between Claude Code and the plugin; when the band then says "type anything", the watcher types `go on`). |
| `oracle.mjs` | Judges a cell dir (`node harness/oracle.mjs <dir> [--landed]`), never by eye. |

**`VIA=ccr`** runs claude-code-router 3.0.22 (installed in the image) inside the container as a passthrough to Anthropic on the mounted OAuth login (`ccr-up.sh`: `ccr serve`, then its own "Claude Code login detected · Import" RPC, the provider lists every model id the Claude Code binary knows); Claude Code gets `ANTHROPIC_BASE_URL` + the gateway's client key as `ANTHROPIC_AUTH_TOKEN`, the way `ccr` users run it. No credential is baked into the image; only `~/.claude/.credentials.json` is mounted.

**Invariants** (`oracle.mjs`; a failure names the invariant and an evidence excerpt):

| id | rule | source |
|---|---|---|
| `stuck-running` | the band never says `is running` / `Claude is on it` for > 90 s (`ORACLE_STUCK_S`) while no turn runs and no dialog is open | panes + `[engine] turn N start/end` |
| `press1-no-dialog` | every press of `1` on a band that asked for it opens a dialog within 5 s | driver.log + panes + `$.tool.call (cadre): AskUserQuestion` |
| `refusal-loop` | no refused tool call / refused stop repeated ≥ 3 times with the same text | transcripts |
| `containment-disagree` | a containment toast is not contradicted by the band 5–20 s later; Doctor and the band agree | debug `$.ui.toast` + panes |
| `errors` | no `NotInitialized`, uncaught errors, `hook failed:` | debug log + panes |
| `no-plan` / `dialog-budget` / `turn-budget` | the goal reaches the plan dialog, with ≤ 3 dialogs (`ORACLE_DIALOGS`; main's one clarify call counts once and earns one more) and ≤ 10 main turns (`ORACLE_TURNS`) | driver.log + debug |
| `wrong-root` | no `.cadre/` below the repo top level | work dir |
| `gone-session` / `restart-named` | after a quit or a crash (`restart`, `FAULT=kill`): nothing says the plan is "running in another session" (a cell has one); the first bare `/cadre` names the unfinished setup or plan and the next step | panes after the restart (a docked pane's column cut, a wrapped reply joined; the band too) |
| `stop-loop` | after a stop the setup asks for a typed line once: at most one stopped dialog, at most 2 typed lines | driver.log |
| `fault-not-injected` | a cell run with `FAULT=…` actually injected it (else it tested nothing) | driver.log |
| `token-leak` | no OAuth token in a mounted dir (work, out, projects) or the evidence | cell.sh `leak` list |
| `not-landed` | (`LANDED=1`) the plan landed on dev (`LAND_RE`, set by the scenario, names its commits) | dev's log |
| `epic-planner` | (`EPIC_PLANNERS=N`, tier `milestone`) N epic plans were accepted from planner agents, and main drafted no epic's tasks | transcripts |
| `clarify` | (`CLARIFY=ask\|none\|assumed\|deep`) main asked one explorer (its explore tool with a question); ask: one question dialog of 1-3 questions; none: no question; assumed: none, and the plan dialog shows `assumed:`; deep: 1-8 dialogs of one question | main's transcript + panes |
| `zero-quota` | (`S=1`) the stub proxy refused no request: every model request was answered by the scripted model or a named stub | `effort.jsonl` |
| `every` | (`ORACLE=every`, exit-every-role) every run record seen ends (a record pruned at its task's close was ended by the close); none `ended{lost}`; the roles in `ORACLE_ROLES` (tester,worker,reviewer) ran; <= 1 dialog besides the plan's; no tool call repeated `ORACLE_REPEAT` (3) times in a row | `store/` snapshots + transcripts |
| `forced` | (forced-exit) cadre answered a request itself; the worker asked the model nothing after it and its `turn.complete` came once, `reason=answer` | debug |
| `noreport` | (report-less-end) every worker that stopped without a report was nudged once, then ended `blocked`; none was accepted (`idle-bound`); <= 1 dialog besides the plan's | `store/` snapshots |
| `underscore` | (underscore-id) a worker ran for a task id with `_`; no explorer but main's one | transcripts |
| `limit` | (usage-limit) the injected limit hit; the band showed the reset time; the task budget did not change; one worker spawn after it | `stubbed.jsonl`, panes, `store/`, transcripts |
| `devmoved` | (dev-moved) the user's commit on dev mid-run is on dev after the landing, `USER.md` byte-identical, the user's checkout clean (cadre's `.cadre/` aside), <= 1 dialog | `devmoved.json` |
| `clear` | (clear-bg-agents, L) the agents running at `/clear` are recorded as kept, lost or gone (`stats.clear`); fails only with no evidence | `store/` snapshots |

**0.14 cells** (`matrix.sh cells`; `matrix.sh scripted` = its S cells). `S=1` runs a cell on the scripted model: `scripted/` is a second plugin that answers every model request at `turn.step` from fixtures (`fixtures/scripted/<script>.sh` picks the script: full, loop, limit, slow; lite by default), and `scripted/stub-proxy.mjs` (`PROXY_JS`) answers the named side requests (quota_check, auto-mode classifier, agent_summary, the injected usage limit) and refuses every other one, so an S cell costs nothing. S cells need no user OK; L cells do. `KNOWN=<slice>`: the cell's own oracle failing shows as `known:<slice>` until that slice lands (none left in 0.14); a leak or an error still fails. An S cell and its `<name>-live` twin in one run must agree. The cell scenarios source `scenarios/_lib.sh`, which snapshots cadre's `$.store` into `store/` while the cell runs (run records are pruned when a task closes). Results and the requests that bypass `turn.step`: `scripted/RESULTS.md`.

**Add a fixture**: `fixtures/<name>.sh` sourcing `_base.sh`; a base makes the repo, an overlay changes it (guard git steps with `[ -d .git ]`). Use it in a cell: `"single <name>"`.
**Add a scenario**: `scenarios/<name>.sh` with the steps above; end with `until_plan` (or rely on `LANDED=1`). A new perturbation that needs a key or command the steps lack: add one line to the steps block in `cell.sh`.
**Add an invariant**: one numbered block in `oracle.mjs` calling `fail('<id>', evidence)`; add its row above. Prove it: a cell that should break it must FAIL on a commit with the bug.
**Clarify tier** (`harness/matrix.sh clarify`, ADR 0020, about US$5): a vague goal on the `landing` fixture (auto, yolo, deep) and the clear titleCase goal. Not in quick: four extra sonnet cells per release.
**0.16 release gate** (`harness/matrix.sh release016`, L, about US$8-10, needs the user's OK; the quick tier runs apart): `needs-setup-node` (real `ms` from npm) and `needs-setup-python` (real `six` through uv, wheels only) with `DEPS=1` (tui.sh pre-approves installs for the repo and mounts the host's uv); oracle `needs-setup`: a `chore(deps)` commit touching only manifest and lockfile on the task branch (polled by the scenario: the task branch is squashed at landing), HOME unchanged outside `.claude` and Claude Code's own cache, the dependency on dev, the task landed. Plus `continue-after-quit` x2, `exit-every-role-live` (2.1.295) and `exit-every-role-live-new` (newest build, now 2.1.310). `CCV=<version>` runs any tier on another build.
**Add a cell to a tier**: one line `name|fixtures|scenario|ENV=…` in `quick()` in `matrix.sh` (`full()` is generated).  `RUNS=N` in the env runs the cell N times (evidence `<cell>.r1…rN`); its row is PASS only if every run passes, US$ and min are summed (`continue-after-quit` runs twice in quick).
