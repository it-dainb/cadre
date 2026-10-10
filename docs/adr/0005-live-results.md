# ADR 0005: Live results in the pinned Claude Code (smokes, init, evals)

Status: accepted · Date: 2026-10-10 · Design: `design/DESIGN.md` v2.5 §14 · Pin: Claude Code **2.1.295** · bd 1.3.1
Run: `harness/run.sh` (Docker, `cadre-harness`: non-root, seccomp/apparmor/systempaths unconfined, only the OAuth creds file mounted). Plugin = a `git archive HEAD` copy of `cadre/`, loaded with `--plugin-dir`. Models: haiku for exploratory runs and smokes, sonnet for the evals. Spend: about US$5 (evals ≈ $0.1–0.25 each, ~25 runs, plus ~40 haiku runs).
Evidence: `docs/evidence/live/` (debug logs `*.debug.log.gz`, eval JSON `eval-*.json`, readable traces `trace-*.txt`, the drivers `drv.py`/`ev.sh`/`s.sh`/`sync.sh`, the probe mod `probe-mod/`). Smoke records: `tests/smoke/S*.md` "Result (live, 2026-10-10)".

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
| Write outside the worktree (`/home/cc/x.txt`) from a bound agent | REFUSED, as the tool error `write only inside your working directory`; the model quoted it in its report and carried on (`j3_1`, `jail-refusal-tester.jsonl`). No mechanism word in anything the model saw (scan of the agent transcript: only the engine's own success line shows the view path, and the model's own word "harness") |

Regressions found and fixed (root cause, test each):
1. `tester-before-worker` judge false negative (ts/go/rust, py 2/3): it asked for nested report answers that are not in the main trace. The Agent result card (`tester → worker`, `worker → review · green ✓`, `reviewer → review✓`) is what main sees and the pipeline was correct in every trace. Fix `a0ae076` (grader sees the cards).
2. `main-never-edits` counted a refused Edit attempt (`tool_used`). Refused attempts are not edits (same rule as Bash); `main-never-edits`/`main-never-bash` are now judged by results (`1772ca4`). Source stayed untouched in every run.
3. Real wording defect: main's Edit refusal said "spawn it for the task", so sonnet spawned `general-purpose` agents (retyped to explorers, which cannot report) and never planned (`TaskCreate` 0x, score 0.67). The deny now ends in the right next action: "plan the change with TaskCreate, or spawn the agent of a planned task" (`a52bf2b`, `tests/policy-guards.test.ts`). Re-run: 1.0.
Spend: about US$3 (6 first-pass evals + 8 re-runs, ~14 haiku smokes).
