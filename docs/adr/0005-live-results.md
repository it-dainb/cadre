# ADR 0005: Live results in the pinned Claude Code (smokes, init, evals)

Status: accepted · Date: 2026-10-10 · Design: `docs/design/DESIGN.md` v2.5 §14 · Pin: Claude Code **2.1.295** · bd 1.3.1
Run: `harness/run.sh` (Docker, `cadre-harness`: non-root, seccomp/apparmor/systempaths unconfined, only the OAuth creds file mounted). Plugin = a `git archive HEAD` copy of `cadre/`, loaded with `--plugin-dir`. Models: haiku for exploratory runs and smokes, sonnet for the evals. Spend: about US$5 (evals ≈ $0.1–0.25 each, ~25 runs, plus ~40 haiku runs).
Evidence: `docs/evidence/live/` (debug logs `*.debug.log.gz`, eval JSON `eval-*.json`, readable traces `trace-*.txt`, the drivers `drv.py`/`ev.sh`/`s.sh`/`sync.sh`, the probe mod `probe-mod/`). Smoke records: `tests/smoke/S*.md` "Result (live, 2026-10-10)".

> **Evidence is local-only.** `docs/evidence/` is gitignored and was removed from the published history: the raw debug logs and transcripts carry account and host details. Paths below refer to a local checkout that ran the harness.

## What ran

| # | What | Result | Evidence |
|---|---|---|---|
| 1 | Load: `claude -p --plugin-dir`, hooks, `session.start`, `/cadre status` | **PASS**: 14 hook events registered, `/cadre` listed, `policy`/`actor` stored, toast `containment degraded (…)`, `/cadre status` → `cadre: no plan / cost: 0 tokens · containment degraded` | `l1.debug.log.gz` |
| 2 | S13 `TaskCreate` first call, no `ToolSearch` | **PASS** | `a13.debug.log.gz` |
| 2 | S16 model cannot reach `/cadre approve` | **PASS** | `a16.debug.log.gz` |
| 2 | S28 `contained ✓` after init stage 5 (new session) | **PASS** (same session still `degraded`) | `s28.debug.log.gz`, `init1.debug.log.gz` |
| 2 | S34 `{result}`+context of `TaskCreate` reaches main | **PASS** | `b34.debug.log.gz` |
| 2 | S39 foreground card replaces the Agent result | **PASS** | `e39.debug.log.gz` |
| 2 | S41 `mcp__cadre__*` grant (default permission mode, no prompt; `plugin eval --allow-tools`) | **PASS**; `--allow-tools "mcp__*"` is **refused** by 2.1.295, name the three tools | `eval-execute-p1-ts.json` |
| 2 | S53 do `/cadre approve p3@x` args reach the model | **YES** (`<command-args>` in the user turn): burn-on-use is required | `d53.debug.log.gz` |
| 3 | Init stages 1 repo, 2 store (real `bd`), 3 mission, 4 discovery (haiku explorer + copy-jail validation), 5 containment, 6 workflow, 7 changelog on a copy of `evals/fixtures/ts` | **PASS** end to end (stage 8 optional, not run). Confirm lines were typed as `-p` stream-json turns with `CADRE_ALLOW_SDK_APPROVAL=1` and a probe mod that reads the code (see PENDING-HUMAN 1) | `init1.debug.log.gz`, `drv.py`, `init*.script`, `probe-mod/` |
| 4 | Cold board + approved epic in beads (eval scaffold): adopted? | **No at first** (fixed, #1 below). Now: "plan p-p1 approved · epic/p-p1-slug-length-cap · ready: p-p1.1" on the first prompt | `eval-execute-p1-ts.json` |
| 5 | Eval `execute-p1-ts` (sonnet) | **PASS 1.0** (tester red ✓ → worker green ✓ → reviewer pass → `TaskUpdate completed` → squash into the epic branch) | `eval-execute-p1-ts.json`, `trace-execute-p1-ts.txt` |
| 5 | Eval `execute-p1-py` | **PASS 1.0** | `eval-execute-p1-py.json` |
| 5 | Eval `execute-p1-go` | **PASS 1.0** (toolchain added to the image) | `eval-execute-p1-go.json` |
| 5 | Eval `execute-p1-rust` | **0.75**: pipeline correct (red ✓ → verify ✓ → pass@sha → closed, `trace-execute-p1-rust.txt`); the `tester-before-worker` LLM judge fails it (false negative: the tester's red card is nested in a subagent call) | `eval-execute-p1-rust.json` |
| 5 | Eval `fix-bug-main-never-edits` | **PASS 1.0** (main planned with `TaskCreate`; a Bash attempt was refused by L1; no Edit/Write; source untouched) | `eval-fix-bug-main-never-edits.json` |
| 5 | Eval `auto-report` | **0.33–0.67, not stable.** The mechanism itself is **PASS live** in plain runs (haiku `f1`, sonnet `f3`): worker stops without `report` → nudge sent ~2 s after its stop → the resumed worker reports → review → closed (`f1-auto-report-haiku.debug.log.gz`, `f3-auto-report-sonnet.debug.log.gz`). The eval cannot pin it: main may end its turn or poll `TaskList` too fast, and a headless run ends with main's turn (see "Headless" below) | `eval-auto-report.json` |
| 5 | Eval `review-resumes-same-agent` | **0.33, not forceable.** The reviewer (sonnet) honestly refuses to invent a `changes` verdict, and a missing doc comment is a `minor` (a pass by the reviewer rules). Resume-the-same-agent is covered by `tests/git/close.test.mjs` ("changes -> the same worker agentId is resumed") and M0 S31 | `eval-review-resumes-same-agent.json` |

## Defects found live and fixed (root cause, one commit each, test per fix)
| # | Symptom in the real engine | Root cause | Fix |
|---|---|---|---|
| 1 | Seeded approved epic never adopted: `/cadre` said "no plan" | `rehydrate` needed a `$.store` pointer | `d785239` `core/reuse.ts` `adopt()`: newest unfinished non-mission epic with a non-draft child, once per session |
| 2 | Every spawn failed closed: `argv.join is not a function` | `core/admission.setup` iterated `Pkg.setup` as a list of argvs; it is one argv | `bcd72b7` |
| 3 | Tester's own `mcp__cadre__report` refused ("not a tester tool") | fence denied every non-file tool for the tester although the allowlist had passed | `78ee5d8` |
| 4 | Fail-closed handlers hid the reason (the engine redacts the message) | `denyCall/denySpawn/denyCheck` logged nothing | `a789196` log `next.error` |
| 5 | `report`/`observe`/cost ledger in subagents: "no beads database found"; per-repo keys diverged | `$.session.cwd()` in a subagent hook is the agent's view/worktree | `6e9cfa3` repo root saved at `session.start` (`secret.root`) |
| 6 | Setup in the jail: `bwrap: Can't chdir …/wt/…` under an eval sandbox | `--bind scratch /tmp` came after the worktree bind and masked a worktree under `/tmp` | `6e07fa0` bind scratch first |
| 7 | Every worker `report` refused: "protected or locked paths changed: <the red test>" | `workerDone` diffed from the epic base, so the spec commit's own files counted as worker edits | `1bd6cab` diff from `specCommit` |
| 8 | Tester guessed import paths: it cannot list directories and never saw `test/` or `package.json` | the view had files but no index | `3723ca4` `FILES.md` in the view, brief points to it |
| 9 | Main did not know a close squashed | `TaskUpdate completed` answered "Updated task" only | `a67dc8d` the close card rides the answer |
| 10 | Stage 3 re-queued the mission every session | board is cold in a new session; the mission lives in beads | `80aab1a` `missionOf(store)` in init stage 3 and `adopt` |
| 11 | Explorer's discovery refused: "no discovery request is open" | init set stage state `proposed` for a request; briefs, admission and tools look for `pending` | `1b07d89` |
| 12 | Explorer's honest report `setup: []` refused three times | `parse` required a non-empty setup argv | `9233bf6` `[]`/absent = no setup step |
| 13 | Every valid discovery refused: `discovery.packages: expected …` | `tools/index` passed `r.discovery`, `parse` wanted the whole report | `52f3f5d` |
| 14 | Stage 5 re-ran until restart | `done()` read `$.settings.read()`, which is the session's | `53ae497` a stage written in-session counts as done |
| 15 | Main re-spawned a worker that had stopped without reporting (stale card "spawn worker") | the agent's stop is observed after the Agent result returns | `8b15993`, `4412969`, `29b6574` the result card says wait (the nudge goes out right after the stop); `fd56aae` was an intermediate step |
| 16 | Rust tester: Write to `tests/new.rs` "cannot place the path" | `placed()` needed the folder to exist | `defc3a1` deepest existing ancestor (a `..` in the rest is refused) |
| 17 | Go check in the jail: `creating work dir: stat /tmp/claude-eval…/tmp` | the caller's `TMPDIR` is not in the jail | `9bc534c` `--setenv TMPDIR /tmp` |
Evals fixed (test side): `execute-p1-*` drop `main-never-bash` (subagent Bash is in the trace; a refused main Bash attempt is not a shell run), graders judge tool results, prompts say "foreground", rust/go scaffolds include their manifest in the view, ADR 0003 allow-tools. Harness: `golang-go cargo` added to `harness/Dockerfile` (go 1.19, cargo 1.65; fixtures pass offline).

## Findings that are not defects
- **Headless runs end with main's turn.** A background agent is killed; `-p` evals must say "foreground". With drive off nothing continues after the last turn.
- `plugin eval` rejects `--allow-tools "mcp__*"`; use `mcp__cadre__report mcp__cadre__inspect mcp__cadre__run_check`. `--ablation none` skips the no-plugin arm; `--keep-temp` plus `TMPDIR` on a mounted dir keeps the trace (`chmod 700` the sealed dir).
- Git identity: the image has none; init stage 1 (`git commit`) failed with "unable to auto-detect email" until `GIT_AUTHOR_*` were set. A real user has one.
- haiku as discovery explorer put `src/slug.mjs` into `tdd.paths` (model quality; `viewInclude`/`tdd.paths` are human-confirmed at the stage 4 diff).
- The mod's `Bash`/`Grep` refusals for main show in the trace as `tool_use_error`; `tool_used` graders count attempts.

## PENDING-HUMAN (need an interactive TUI; repro)
1. **Typed `/cadre init confirm <code>` as a composer line.** Driven here with `-p` stream-json (origin `sdk`) and `CADRE_ALLOW_SDK_APPROVAL=1`; the code was read from the `cadre.secret` atom by a probe mod (`docs/evidence/live/probe-mod`), because the code is shown in the band/pane only. The composer-origin gate itself (a typed line from a human is accepted, a model-originated one is refused) is covered by `tests/init.test.ts`, `tests/approve.test.ts` and S16/S53 live (sdk origin refused). Repro: `cp -r evals/fixtures/ts /tmp/x && cd /tmp/x && claude --plugin-dir <cadre>` → `/cadre init`, read the code from the band, type `/cadre init confirm <code>`, repeat for stages 1–7.
2. **S22** (background workers across `/clear`), **S37** (`!` raises no `tool.call`), **S48** interactive `/goal`, **S49** compact trigger: unchanged from ADR 0001.
3. **UI smokes S51–S61** (band, pane, notifications) need a TUI; not run here.
4. Eval `review-resumes-same-agent` needs a seeded task with a real, reviewer-visible major defect (e.g. a scenario the red tests cannot catch) to force `changes` without fabricating it. Repro: seed `p-p1.1` with such a scenario, run the case, expect `changes (1/3)` then the same `agentId` resumed.
5. Eval `auto-report` as a graded run: needs a driver that keeps the session open after main's last turn (or drive on) so the nudge's resume completes inside the trace.

## Re-run after review rounds (2026-10-10, HEAD 0f9d096 + a0ae076, 1772ca4, a52bf2b)
Same harness, `git archive HEAD` copy, haiku smokes / sonnet evals. Evidence: `docs/evidence/live/rerun2/` (`*.debug.log.gz`, `eval-*.json`, `trace-*.txt`, `jail-refusal-tester.jsonl` = the subagent transcript of the refused write).

| Check | Result |
|---|---|
| Load, `/cadre status` (`cadre: no plan · containment degraded`, toast, hooks) | PASS (`l1`) |
| S13 `TaskCreate` first call, no `ToolSearch` | PASS (`s13`) |
| S28 `contained` (settings with sandbox on, `denyWrite` repo, `allowWrite` = the realpath'd `<wtRoot>/<repoKey>`; the key is `run-568e48` for `/work/run`) | PASS (`s28b`); with a wrong allowWrite it reads `degraded (allowWrite lacks the worktree root)` |
| S34 `{result}` + plan rules reach main | PASS (`s34`) |
| S39 foreground card replaces the Agent result | PASS (`s39`: result is the one-line card) |
| S41 `mcp__cadre__*` grant, default permission mode | PASS (`s41`: tester red → worker green, no prompt) |
| Eval `execute-p1-ts` / `-py` / `-go` / `-rust` | **1.0 each** after the grader fix (first pass 0.75 on `tester-before-worker`, see below); ADR 0005 first run: ts/py/go 1.0, rust 0.75 |
| Eval `fix-bug-main-never-edits` | **1.0** after two fixes (first pass 0.83) |
| Eval `auto-report` | 0.67, unchanged (not stable, see "Headless" above) |
| Worker edits inside its worktree (positive jail) | PASS: `j1`, full run tester→worker→reviewer→closed, squash on the epic branch |
| Write outside the worktree (`/hm/cc/x.txt`) from a bound agent | REFUSED, as the tool error `write only inside your working directory`; the model quoted it in its report and carried on (`j3_1`, `jail-refusal-tester.jsonl`). No mechanism word in anything the model saw (scan of the agent transcript: only the engine's own success line shows the view path, and the model's own word "harness") |

Regressions found and fixed (root cause, test each):
1. `tester-before-worker` judge false negative (ts/go/rust, py 2/3): it asked for nested report answers that are not in the main trace. The Agent result card (`tester → worker`, `worker → review · green ✓`, `reviewer → review✓`) is what main sees and the pipeline was correct in every trace. Fix `a0ae076` (grader sees the cards).
2. `main-never-edits` counted a refused Edit attempt (`tool_used`). Refused attempts are not edits (same rule as Bash); `main-never-edits`/`main-never-bash` are now judged by results (`1772ca4`). Source stayed untouched in every run.
3. Real wording defect: main's Edit refusal said "spawn it for the task", so sonnet spawned `general-purpose` agents (retyped to explorers, which cannot report) and never planned (`TaskCreate` 0x, score 0.67). The deny now ends in the right next action: "plan the change with TaskCreate, or spawn the agent of a planned task" (`a52bf2b`, `tests/policy-guards.test.ts`). Re-run: 1.0.
Spend: about US$3 (6 first-pass evals + 8 re-runs, ~14 haiku smokes).

### G2/G4 (verifier gaps), same re-run
Each row used a fresh `git archive HEAD` copy; the hash is HEAD at that run. Evidence in `docs/evidence/live/rerun2/` (`drv2.py` = stream-json driver with `drain:`, `m6.script`, `scaffold-m4.sh`, `scaffold-m6.sh`).

| Check | HEAD | Result |
|---|---|---|
| **M4** live chain: p-p1.2 depends on p-p1.1 (sonnet, foreground) | 98aa5a5 | **PASS**: tester→worker→reviewer→`TaskUpdate completed` for .1, then the same for .2 (only after .1 closed); both squashed onto `epic/p-p1-…` (`165e61e`, `eeb1903`). `m4.debug.log.gz` |
| **M6b** drive, run 1 (3-task epic: model drafts the plan with `TaskCreate`, sdk-origin `/cadre approve`, `/cadre drive on`) | 98aa5a5 | Drive ran for real (first live run): all 3 tasks closed, `Continue: complete the epic` ×3, then `Drive paused: no progress in 3 turns`. Defect: the card said only "complete the epic"; main did not know the action |
| M6b run 2 | 9262117 | Card now `complete the epic: TaskUpdate <id> completed`; the call was refused: "completed does not apply to a draft". Defect: approval leaves the epic bead `draft` (`native/tasks.ts` draft test) |
| **M6b run 3** | 12cdca0 | **PASS**: approval → 3 tasks (tester/worker/reviewer each, foreground) → `TaskUpdate <epic> completed` → toast "Epic landed on dev · release v0.1.0? /cadre release" → "drive finished", `drive off`. `dev` = merge commit with the 3 squashes and 3 changelog lines under Unreleased; release not run (human: `/cadre release`). `m6-drive-run3-landed.*` |
| G4 `execute-p1-ts` ×3 (`--runs 3`, sonnet) | 98aa5a5 | **3/3 = 1.0** (`eval-execute-p1-ts-x3.json`, $0.62) |
| G4 `execute-p1-rust` tester-before-worker judge | a0ae076+ | judge fixed (it reads the Agent-result cards main sees); rust re-run **1.0** |
| **S10** restart half (`--resume` of a finished-plan session, then a plain prompt) | 12cdca0 | Board comes back from beads: `resumed · epic p-p1 · (re-adopted)`, resume card `next: complete the epic …`. A first-line `/cadre status` said `no plan` (fixed, below). `s10.debug.log.gz`, `s10b.debug.log.gz` |
| S10 `/reload-plugins` half; S29 (link click, queued Enter) | n/a | **PENDING-HUMAN** (TUI). S10 repro: `claude --plugin-dir <cadre>` in the seeded repo, run a plan to `active`, `/reload-plugins`, `/cadre status` (identical), quit, `claude --continue` (resume card, `drive` off). S29 repro: pane approve link click → origin `composer`, model never sees a live `code8`; queue Enter before/after a plan amendment → the second mismatches the token |

Notes: drive starts at the next `turn.complete` after arming, so one kickoff prompt follows `/cadre drive on` (main then drove all three tasks itself; drive's own `Continue:` prompt fired only for the epic completion). Fixes (root cause + test each): `9262117` the card names the action; `12cdca0` an approved epic is not a draft in `TaskUpdate`; `dc5e84d` `/cadre status` warms a cold board.

## Interactive (tmux) runs (2026-10-10, HEAD 3cc89ec)
Harness: `harness/tui.sh` (see `harness/README.md`): a container per run, `claude --plugin-dir` (pin 2.1.295) inside tmux 120x40, driven with send-keys / capture-pane; transcripts read from the mounted `projects` dir, graded by `docs/evidence/live/tui/jl.py`. Evidence: `docs/evidence/live/tui/` (debug logs, final panes, grades, `s60-frames.tgz`, drivers, scaffolds). Haiku for smokes, sonnet for the two evals. Spend ≈ US$4 (13 eval-style runs, ~15 smoke sessions).

| What | Result |
|---|---|
| auto-report end to end, foreground, seeded approved plan (`evals/auto-report/prompt.md` typed in the composer) | **6/6 PASS** (3 sonnet `a1–a3`, 3 haiku `t1–t3`): worker ends without `report` → the transcript shows the nudge ("You stopped without calling report") in the worker's own transcript → it calls `report` → `report accepted … Now in review` → reviewer `pass` → `main → done`. The interactive session keeps running after main's last turn, so the nudge's resume completes inside the trace (PENDING-HUMAN 5 is closed). |
| review-resumes-same-agent | **0/7 reached `changes`, so the resume was not exercised.** New fixture `evals/review-resumes-contract` (contract `errors`: RangeError for a non-positive-integer `max`, `max>255`, TypeError for a non-string, NaN/Infinity/-0, never throws on all-punctuation; no scenario covers them). Sonnet's tester wrote the contract tests, the worker implemented every clause, the reviewer passed (`r1–r7`). A reviewer sees only scenarios+contract+diff and the tester sees the same, so no defect is reviewer-visible and tester-invisible; only a worker mistake the tester skipped could produce `changes`, and it never happened. "Same agentId resumed on `changes`" stays covered by `tests/git/close.test.mjs` and M0 S31; the rate here is 0/7 for an unforced defect. |
| S51, S52, S55, S59, S60, S37, S48, S49, S22 | see each `tests/smoke/S*.md` "Result (tmux …)": all PASS (S22 after 3 fixes; S60 terminal only) |
| typed init confirm (composer origin), stage 1 | **PASS after 2 fixes.** `/cadre init` → diff + "Confirm with the code shown in the cadre band"; the band was **empty** (see 1). With the fix the band shows `type /cadre init confirm <code>`; typing that line in the composer applied stage 1 (`.cadre/config.json` branches, branch `dev`). |

Defects found by the interactive runs (root cause, test each, gates green):
1. **The init confirm code was never visible** (`ui/model.ts`, `ui/band.ts`): no UI read `secret.initConfirm`, and the band returned `[]` with no plan, which is always the case during init. A human could not complete `/cadre init`. `00da0a3` attention item `init stage N diff ready` with `/cadre init confirm <code>`; `afeac76` the band draws a pending init item without a plan.
2. **`rehydrate failed: no beads database found` printed in chat** before init stage 2 (`core/session.ts adopt`): `582149f` no store = nothing to adopt, quiet.
3. **S22: a `/clear` before main's next `turn.complete` left a running background agent unbound**: the pointer (bindings) was saved only at turn.complete. `0e464ed` save it when an agent is bound (`core/admission`).
4. **After `/clear` every agent's bd call failed (`no beads database found`)**: `secret.root` is per session and `session.start` is not raised again, so `h.cwd()` was the agent's view. `3dcbf14` the root is also kept in `$.store cadre:roots`; `rootFor` maps a worktree/view cwd back to it.
5. **After `/clear` a worker's `report` was refused `active·tester: nothing to report at your step`**: beads kept `cadre.step=tester` after red ✓ and the board is rebuilt from it. `3cc89ec` persist the step when red passes.

Findings that are not defects:
- The typed `/cadre approve <plan>@<code8>` is echoed into the transcript (system `local_command` records, `commandRun`) and reaches the model's context (haiku quoted it when asked); the code is burned on use (replay → `refused: token mismatch`). The code is never in anything cadre draws or returns. S51's strict "absent from the JSONL" holds for the band/pane/sheet/toast/Task* path, not for the human's own typed confirm (S53).
- Hotkeys in the pane need the pane focused; `/cadre open` focuses it only when the composer is empty (the engine's `open({focus})` rule). `ctrl+x Tab` moves focus to the band, not the pane.
- `/cadre open init` opens the Epic tab (no init view in v1); the code is on the band.
- A model sometimes calls `report` twice or backgrounds an agent it was told to run in the foreground; both are model behaviour, handled by the engine (second report refused `nothing to report`).
- The `tui.sh` image needed no change beyond `tmux`; the harness `~/.claude.json` seed removes all first-run dialogs.

PENDING-HUMAN now: **S54** (VS Code), **S61** (desktop), **S56** (Remote Control), S52's open-dialog case, S59 on the desktop surface. Items 1, 2 (S22, S37, S48, S49), 3 (S51–S53, S55, S59, S60) and 5 above are closed by these runs; 4 is attempted (unforced, 0/7).

**S10 / S29 follow-up (tmux):** S10 `/reload-plugins` + `--continue` halves PASS (board and cost identical after reload; resume card and re-adopt after restart). S29 queued-Enter half PASS (stale code after an amendment → `refused: token mismatch`; an immediate `/cadre` typed mid-turn runs before the queue, so it is accepted). Link click stays PENDING-HUMAN. Records in `tests/smoke/S10.md`, `S29.md`.

## Marketplace install (online)

Image built from `harness/` with no local binary: the official installer path gives `claude --version` = 2.1.295 (build arg `CLAUDE_VERSION`). Container with network:

| Check | Result |
|---|---|
| `claude plugin marketplace add it-dainb/cadre` | OK. Ref syntax: both `it-dainb/cadre#main` and `it-dainb/cadre@main` are accepted (listed as `GitHub (it-dainb/cadre@main)`); the scripts use `#`. |
| `claude plugin install cadre@cadre`, `claude plugin list` | installed, `Version: 0.1.0`, enabled |
| Headless `CADRE_SOURCE=marketplace harness/run.sh -p "/cadre status"` (haiku) | `cadre: no plan`; debug log: `Total plugin agents loaded: 4`, `hooks module cadre@cadre loaded (worker … tier user)`, `plugin.register: cadre … admitted` |
| Interactive `CADRE_SOURCE=marketplace harness/tui.sh start mk` | `/plugin` header `1 mod active · cadre`; `/cadre status` shows the seeded plan; asking main to spawn the task ran the tester, then handed off to the worker (pipeline active from the cached plugin) |

The only warning is the unset `userConfig` option (defaults apply) and `containment degraded` until `/cadre init`, both expected. No fixes were needed.

## setup / doctor (live)

`harness/tui.sh` (haiku, 220 columns), container built from `harness/`: bwrap 0.8.0, git 2.39, bd 1.3.1, socat present.

| Check | Result |
|---|---|
| Fresh container, `/cadre setup` | Command text `setup: 0 fail, 2 warn — report in the cadre pane`. Pane tab `doctor`: Claude Code 2.1.295 ok, git ok, bd ok (no if-revision: fallback), bwrap warn (0.8.0 has no overlay: copy-jail, fix `! sudo apt install bubblewrap  # upgrade to >= 0.11`), socat ok, worktree root writable, user settings warn (proposed `+ env.CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"`). The code is on the band only; the log line carries `<code>`. |
| `/cadre setup confirm deadbeef` | refused and burned; the real code typed next is refused too (burn on every attempt); `settings.json` unchanged |
| `/cadre setup`, then `confirm <code read from the band>` | `settings.json` gets `env.CLAUDE_CODE_ENABLE_TODO_TOOLS`, `settings.json.bak` holds the old bytes, stamp written (only the bwrap warn remains) |
| `/cadre doctor` in a seeded repo (`evals/execute-p1-ts`) | machine rows plus: init stages incomplete (1, 3, 5, 6, 8) fix `/cadre init`; containment degraded fix `/cadre init containment`; beads 1.3.1 reachable, journal on; branch main unset (crit) fix `/cadre init repo`; dev ok; no stale leases, flags, quarantined refs, queued resumes; drive off |
| Second container, `bd` and `socat` hidden from PATH | `[CRIT] bd not found` fix `! npm install -g @beads/bd`; `[CRIT] socat not found` fix `! sudo apt install socat`; beads rows crit with fix `/cadre init store` |

Fixed after the run: with bd missing the beads row appeared twice (probe, then list); the list now runs only when the probe passes. Two other crit rows in that container (user namespace, worktree root) came from my stripped PATH lacking `true` and `test`, not from the checks. The pane truncates a row wider than the pane (the log line has it whole). Not shown: the plugin's own version (a mod has no API for it).

### Dormant until init (live, local plugin dir)
Plain git repo, no `.cadre/`, haiku via `tui.sh`: main's Bash call ran (`b.txt` written), `/cadre status` answered `cadre is off in this repo · run /cadre init`, no band or toast. `/cadre init 1` showed its diff and the code on the band (the band render must stay ungated: found and fixed here, the first run drew no code while dormant); after `/cadre init confirm <code>` created `.cadre/config.json`, the next Bash call in the same session was refused ("Bash is not available to main") and no file was written: active without a restart. The marketplace variant needs the push; the local plugin dir exercises the same code.

## `/cadre init` end to end (0.6.0, ADR 0009)
`harness/tui.sh`, haiku, 120 columns, bd 1.3.1. The project is `evals/fixtures/ts` copied into an empty folder with no git repo. Captures stay local (not committed).

| Step | Result |
|---|---|
| Before the fix, container with no git identity (`GIT_*` set empty) | reproduced the user report: `git init` ran, `git commit` failed (`empty ident name`), an unborn `main` was left, and the reason was invisible |
| After the fix, same container, press `a` on stage 1 | the card re-proposed with `! last try: git commit failed: git has no author name/email; run git config --global …` and `+ initial commit on main` (no `git init` line). The retry after fixing the identity is kit-tested: the container's empty env overrides git config |
| `/cadre init` (identity set) | command text `init: stage 1/8 repo ready · confirm on the card`; card `init 1/8 repo · confirm` with `.git/info/exclude` and `.cadre/config.json` paths |
| `a` | `stage 1/8 repo done · stage 2/8 store …`; the stage 2 card replaced it |
| `a` (real `bd init`) | `stage 2/8 store done`; Claude got the mission brief at once; card `init 3/8 mission · Claude is on it` |
| mission questions | main asked one AskUserQuestion round (goal / constraints / non-goals), answered with tmux keys, then `TaskCreate{kind:"mission"}`. Card `approve the mission · Build a new feature in this project`, with the goal, constraints and non-goals lines |
| `a` on the mission card | mission recorded; Claude got the discovery brief; it spawned one Agent, which admission retyped as the explorer and haiku ran in the background |
| explorer report | at the next main turn end: card `init 4/8 discovery · confirm` with `+ packages[.]: setup (none); checks test` |
| `a` ×3, `s` | stages 4 to 7 done one after the other, then the stage 8 card ([s] Skip) and `stage 8/8 sync done · all stages done`; `/cadre init` again answers `init: all stages done`. `.cadre/config.json` has branches, packages, types, roles; `CHANGELOG.md`, `settings.local.json` (+ `.bak`), one initial commit, `main` + `dev` |
| LOG | `init: stage 6 workflow proposed` / `… done` rows, no raw JSON |

Found and fixed in the first run:
- The hand-off turn ended while the background explorer ran, so the card said "Claude stopped". It now keeps "working" while `ui.discoveryAgent` is set.
- After the report, main's context line still said "spawn the discovery explorer", and haiku reasoned about a second run. That line is now dropped once the explorer runs or has reported.
- The mission card read "approve plan … · 0 tasks"; it now shows the mission.
- A mission drafted in a later turn left a stale "stopped" card; it is now cleared at that turn's end.
- `done` rows were missing from the log (level 0).

The second run confirmed all five.

### Ask, then resume: git identity (0.6.1)
`NO_GIT_IDENT=1 tui.sh` (container with no git identity: `git var GIT_AUTHOR_IDENT` exits 128).
- `/cadre init`, `a`: nothing ran. The card `init 1/8 repo · needs you` showed the reason and the `Name:` / `Email:` fields. I typed `Ann Lee`, Tab, `ann@example.com`, Enter. The global git config was set, stage 1 finished (initial commit authored `Ann Lee <ann@example.com>`), and the stage 2 card followed.
- `/cadre setup`: the card listed "1. setting your git identity" plus the fields. A bad email (`bo-at-nowhere`) was refused on the card (`! email needs a form like you@example.com`). After I retyped it, Enter ran all three actions and the report shows `[OK] git identity set`.
- One quirk: after a refused submit, the engine's Input drew the field empty although the prefill value was passed. The typed value is still kept in `cadre.ui.fields`, but the human sees an empty field and retypes it.
