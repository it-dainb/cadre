# cadre: design (v2.5)

> **cadre** is a Claude Code plugin built as a **mod** (one in-process TS hooks module), frozen to **Claude Code 2.1.295**. Repo: `cadre/` (standalone).
> Status: design, nothing built or run. Supersedes `claude-mods/docs/applied/workflow-enforcement.md` (**WE**). WE's R1–R16 and S1–S14 are reused by number.
> Cite keys: catalog IDs (`TP-01`, `AG-19`, …) → `claude-mods/docs/catalog/<domain>.md#<id>`; `C1`–`C7` → `claude-mods/docs/conditions.md`; `G1`, `P4`, `B6`, … → `claude-mods/docs/pitfalls.md`;
> `concepts §n` → `claude-mods/docs/concepts.md`; research → `design/research/{agent-hive,oh-my-claudecode,beads,oh-my-opencode-slim}.md` as **hive/omc/beads/slim §n**; `d.ts:n` → `claude-mods/refs/claude-code-2.1.295/claude-code.d.ts-786ac4b5.txt`;
> **SBX** → https://code.claude.com/docs/en/sandboxing; **SUB** → `claude-mods/docs/official/sub-agents.md`; **GOAL** → `claude-mods/docs/official/goal.md`; **BTO** → `claude-mods/docs/research/2.1.295-builtin-tools-override.md`; **KIT** → `claude-mods/docs/dev/testing.md`;
> **EVAL** → `claude-mods/refs/claude-code-2.1.295/plugin-eval-08c65fe1.md`; **KAC** → https://keepachangelog.com/en/1.1.0/; **CCm** → Conventional Commits 1.0.0; beads source → `refs/beads` (`v1.3.0-451`).
> Labels: **V** = mechanism VERIFIED in the 2.1.295 types/engine (via the catalog) · **I** = INFERRED · every runtime claim is UNTESTED until its smoke test (§14) passes.

## Changelog v2.5 (from v2.4, 2026-10-10)
| # | Change | Why |
|---|---|---|
| 1 | **UI client cap:** v1 ≤ 750 (was 600), full ≤ 1,500 (§1.4, §2.3, §14) | UI-DESIGN §9: Epic view + timeline + replay ≈730 |
| 2 | **Event envelope** carries `actor`, `severity`, `needsHuman` (+ `taskId?`, `agentId?`); the attention level stays UI policy (§2.5) | UI-DESIGN §2.2, §11.1 |
| 3 | **New events:** `agent.unbound {agentId, reason}` paired with `at`-stamped `agent.bound`; `task.phase_changed` for every step incl. spike `explore`/`report`; `task.skipped {taskId, on}`; `sync.state_changed {target, state, at}` replaces `sync.status` (§2.5) | UI-DESIGN §2.4, §11.2–3, §11.6 |
| 4 | **Snapshot fields:** task `kind`, `merges`, typed `deps[].type`, `condition {on, state}`, `phaseSince`; plan `approvedAt`, `landed {dev, sha, at}`, `released {version, at}` (§2.5) | UI-DESIGN §2.2, §11.4–5 |
| 5 | **Event ring** `cadre.events`: 500 per epic, rebuilt from beads records + journal after `/clear` (§2.1, §2.5, §14) | UI-DESIGN §2.2, §11.7 |
| 6 | **Core LOC:** `events` 60 → 100, `board` 120 → 150; core 4,780 → **4,850 ≤ 5,000**, headroom 150 (§1.4, §2.3) | Honest budget |
| 7 | **UI milestones** M2a-ui (Plan tab + prefill), M3-ui (band + strip + notification policy), M4-ui (Epic DAG + detail + log), M7-ui (timeline + replay); S51–S61 mapped (§15) | Risk-first slices aligned with the core |
| 8 | S-UI7..11 numbered **S57–S61** (§14) | UI-DESIGN §10.2 |
| 9 | **Glyphs:** UI-DESIGN §6.0 legend approved (glyph + word tag always); config `ui.glyphs: unicode\|ascii` (§5.4, §12) | User decision 2026-10-10 |
| 10 | Pane v1 tabs are **Epic** + Plan (Board dropped); band row and `/cadre open` tabs follow UI-DESIGN (§2.5, §5.3, §5.4) | UI-DESIGN §5.5, §6.1 |

## Changelog v2.4 (from v2.3, 2026-10-10)
| # | Change | Why |
|---|---|---|
| 1 | **Burn-on-use nonce:** every `/cadre approve …@<code>` and `init confirm <code>` attempt, accepted or refused, redraws the nonce (§3.1, §10.1) | UI-DESIGN §11.1: command args echo into the transcript (d.ts:10045, **I**) |
| 2 | **Init confirm code** is nonce-salted like `code8`, never a deterministic hash of the diff (§10.1) | UI-DESIGN §11.2: a model that saw the diff could compute it |
| 3 | **Approval sheet** shown in the `cadre` pane (Plan tab), `$.ui.log` as the fallback; command `{text}` is one line; the pane is a v1 client (§2.5, §3.1, §5.3, §5.4) | UI-DESIGN §11.3, Q3, D2 |
| 4 | **`code8` and the init code** live in the UI-private `$.state` atom `cadre.secret`, outside both views, events and the adapter protocol (§2.1, §2.5, §3.1) | UI-DESIGN §11.4, §2.3 |
| 5 | **Status line** shows attention only (§5.4) | UI-DESIGN §11.5: the counts duplicated the band |
| 6 | **`ui/` budget:** the split out of core's cap was already done in v2.3 (row 22); v2.4 records the caps, v1 ≤ 600, full ≤ 1,500 (§1.4, §2.3, §14) | UI-DESIGN §11.6, §9 |
| 7 | **`/cadre open [tab]`**, with `immediate:true` on the one `/cadre` registration (§5.3) | UI-DESIGN §11.7, CC-02 |
| 8 | UI smoke tests S-UI1..6 numbered **S51–S56** (§14) | UI-DESIGN §10.2 |

## Changelog v2.3 (from v2.2, 2026-10-10)
| # | Change | Why |
|---|---|---|
| 1 | **Tester fence:** rule 2 is terminal (inside the view → allow, skip 3–5; `tool.check` allow mirrors it); root test is path-segment aware; golden `/x/bd-a1` vs `/x/bd-a1.view` (§13.2) | Critic A1 |
| 2 | **Per-tool fence input** normalized from input fields (Glob absolute pattern → its base dir, as `XOe`/`gCt` in `chunk-v6ff19vh.js`); S45 confirms it (§13.2) | Critic A2 |
| 3 | Contract symbols carry **`status: new\|changed\|unchanged`**; sheet shows it; skeleton + `<error>` rule only for `new`; reviewer verifies status (§3.1, §3.5) | Critic A3 |
| 4 | **Drafts may be incomplete:** first plan answer = `{result}` + `context:[planRules, "missing: …"]` (d.ts:12717-12735); completeness enforced at `/cadre approve` (§3.1) | Critic A4 |
| 5 | **Discovery by P10:** exempt from the context gate; `setup` once under an `$HOME` overlay, cache dirs proposed from **what it wrote** (no stderr); diff 1 → explorer → diff 2 → validate; validation in the mod's bwrap jail (§10) | Critic A5 |
| 6 | **Network stance:** fetch only in `setup`; checks and worker shells offline (§10.3, §13.1) | Critic A6 |
| 7 | **Multi-session:** staleness = beads claim lease; resume queue keyed by `sessionId`; drive + sync leases and cursors live in beads (control issue, `--if-revision` CAS) (§8.4, §11.4) | Critic A7 |
| 8 | "A new machine loses nothing" removed; **recovery** defined (`lost-wip`, `lost-epic`); branches are local (§8) | Critic A8 |
| 9 | **Compaction answered** `{messages:[card,…recent]}` without `next` (SS-08); card hash stored; delivered once (§8.3) | Critic A9 |
| 10 | Liveness: S31(e), S47(b); A13/A25 fallback band `resume queued — send any prompt`; drive arms on `/cadre drive on`, never submits from a timer (G6) (§4.4, §9) | Critic A10 |
| 11 | TTL: 1h only if S44 shows reuse > 5 min pays; `subagentPromptCacheTtl` is global; per-agent `experimental.cacheTtl` route tried in S43 (§7) | Critic A11 |
| 12 | `/goal` seen via `command.run {command:'goal'}` (CC-05); S48 only for restored goals; drive budget in USD (SS-14); `Cron*`/`ScheduleWakeup` removed from main (§4.1, §9) | Critic A12 |
| 13 | Views at `<wtRoot>/<repoKey>.views/<id>/`, outside worker `allowWrite`; audited by call log + content hash (§3.5) | Critic A13 |
| 14 | Cost ledger = overwritten metadata + one record at close (§7) | Critic A14 |
| 15 | M0: A-rows for S41/S43/S48, smoke S49 (compaction answer + `compact()` from `turn.complete`), S29 justified, retired A-rows explained (§15, §16) | Critic A15 |
| 16 | Rework cap; `known-red` escape; copy-in purely path-based; longest package root wins; dirty locked paths refuse checkpoints; handoff base for test-less pipelines (§3–§10) | Critic A16 |
| 17 | **Staged `/cadre init`** wizard: 8 idempotent stages, each propose → confirm diff → validate → save (§10) | User B |
| 18 | **Task-type registry** (type → commit type → changelog category → pipeline) and **roles** profile replace per-type tdd defaults and the task `tdd` field (§3.1) | User B6 |
| 19 | **Sync layering:** adapter code / project config / user credentials; adapters are **external processes** on a versioned stdio JSON protocol; guided setup; never creates remote projects; lease in beads (§11) | User C |
| 20 | **Extension boundary:** domain events + versioned read model + origin-carrying commands; one adapter protocol for sync, UIs and notifiers; `adapter:<name>` origin (§2.5) | User directive |
| 21 | Open questions: old Q3 (empty `[Unreleased]` refused) and Q7 (`/clear` hint at 40 %) became settled defaults; new Q3 (rework cap) and Q7 (`strictAllowlist`) (§16.3) | Max 8 |
| 22 | **LOC re-cut, split budgets:** core sum 4,780 ≤ 5,000 (`commands` split into `cadre` + `init`, new `events`, `dispatch`, `protocol`; cuts listed); the terminal **UI client** (`ui/`) moves out of the core map to its own cap, set in `design/UI-DESIGN.md` (§1.4, §2.3) | Honest budget; user |

v2.2 added one resume sender, the spec view and black-box tester, P10, zero skills, cost discipline, continuity, drive and polyglot discovery. v2.1 froze approved tasks and added spec-first TDD and the branch model. v2 made beads the single store (git history).

---

## 1. Goals, non-goals, principles

### 1.1 Goals
1. **One loop, enforced by code:** plan with scenarios → *human* approval → tasks in beads → each task runs its type's **pipeline** (e.g. tester red → worker green → independent review bound to a commit) → mod merges → close (hive §2, gates as hooks per hive §4).
2. **Main plans and manages. It never edits code and never has a shell.** Code changes come only from the owner of an `active` claim, inside its worktree, contained by the OS sandbox and verified by the effect check (WE R1, R5, R6).
3. **Local-first.** beads is the one truth for claims, lifecycle, gates and leases. Remote trackers are optional mirrors that never block a local transition.
4. **Native-first and cache-friendly.** The model uses the tools it was trained on (Task*, Agent, Read/Edit/Bash); cadre patches them and resumes agents instead of re-briefing them (§7).
5. **Any codebase.** Core is language-free; stack specifics are discovered from the repo and validated by running them (§10).
6. **Strict by default, small, legible, UI-agnostic.** OMC's core without its workaround layer (omc §4); every client reads one versioned read model (§2.5).

### 1.2 Non-goals (v1)
Not a security boundary against the *user*: a user-tier mod can be switched off (C6, PO-19, TP-28). cadre stops **model drift**; layer 2 (the OS sandbox) also contains accidents. Real enforcement needs managed deployment (C2). Not a replacement for Claude Code's agent runtime (slim §7 Avoid 2). No network git: **cadre never pushes**; branches are local to the machine.

### 1.3 Principles
| # | Principle | Consequence |
|---|---|---|
| P1 | **Every "never X / only Y" rule is a mechanism or it is deleted** (hive §7) | Map in §13.6 |
| P2 | **The mod owns identity, state and git** | `agentId` (AG-13), claim actor, worktree, `sourceCommit`, `specCommit`, verdict@commit, approval and every merge/commit/tag run in mod processes (SA-07) |
| P3 | **C1-proof by construction** | Only `tool.call`, `tool.check`, `tool.describe`, `agent.spawn`, `turn.step`, `turn.complete`, `prompt.submit`, `prompt.attachment`, `session.send`, `session.compact`, `command.run`, `config.set`, `session.*`. No `classic.*`, no system-prompt edits (C1, PO-16) |
| P4 | **Fail closed** | Re-entry-aware `.catch` on every gating registration (G1, G2). beads unavailable → no claims, no closes |
| P5 | **Native first, one store** | An MCP tool exists only where there is no native equivalent |
| P6 | **No enforcement by parsing command text or tool stderr** | Facts used: tool name, input fields, `agentId`/role/binding, `realPath` (SA-04), exit codes, git's own output, JUnit XML, files a jail wrote, our own formats |
| P7 | **One agent = one task** (§4.6) | Briefs, deltas, reads, checks and resumes are scoped to the bound task |
| P8 | **Computed beats claimed** (§6) | Files, commit, diff stats, checks, duration, tokens come from the mod |
| P9 | **Regrowth budget** | §1.4 caps checked by `tests/budget.test.ts`; raising one needs an ADR (slim §1) |
| P10 | **Shape the environment → allowlist (default-deny) → audit effects; never enumerate leak or bypass channels** | Shell: L2 shapes, L1 allowlists, L3 audits (§13.1). Tester: built view + allowlist + realPath-under-root + call log + hash (§3.5). Discovery: overlay + audit what was written (§10). External UIs: grant + token (§2.5) |

### 1.4 Hard size budget (v1)
| Item | Cap | v1 plan |
|---|---|---|
| Agent types / slash commands / skills | 4 / 1 / **0** | `worker`, `tester`, `reviewer`, `explorer` / `/cadre <sub>` / guidance is just-in-time (§3.1) |
| MCP tools (`mcp__cadre__*`) | **3** | `report`, `inspect`, `run_check`, all `isDeferred:false` (TP-16) |
| Tool descriptions | ≤1.5 KB, byte-stable | Native tools need no teaching |
| Agent-type prompts | worker ≤2.5 KB · tester/reviewer ≤1.5 KB · explorer ≤1 KB, byte-stable | `agents/prompts.ts` |
| Brief / delta / main context / card / plan rules / resume card | header ≤1.5 KB + spec ≤4 KB + context ≤3 KB + notes ≤500 / ≤1 KB / ≤1 KB / ≤600 chars / ≤1.5 KB / ≤3 KB | §4, §6, §8 |
| Non-test **core** code | **≤5,000 LOC total** (targets sum 4,850, §2.3): enforcement, workflow, store/sync engine, events/read model/commands, git, tdd, model-visible renders. Only the total is enforced until M8 | Test-only: `memory` store ≤150; the fake adapter is a dev script |
| Terminal **UI client** (`ui/`) | its own cap: **v1 ≤ 750, full ≤ 1,500 LOC** (UI-DESIGN §9, which governs); not part of core's 5,000 | Draws only for the human, locally: zero model tokens. Reads only the human view + events (§2.5) |

### 1.5 Out of scope (README lists each with its reason)
| Item | Why | Ever? |
|---|---|---|
| Parsing shell command text or stderr; enumerated deny lists of channels | P6, P10 | never |
| Language/ecosystem presets in code | §10: discovered + validated config | never |
| Magic keywords, Stop-hook loops, `/goal`, statusLine HUD command, skills | One loop authority (omc §4 W1–W3) | never |
| Op-log sync queue | State-based reconciliation (§11.4) | never |
| Pane teammates, agent teams, workflow agents | Unseen or rewrite-proof (AG-27, AC-23, AG-30) | roadmap (in-process teammates) |
| Creating remote projects or Twenty custom fields | Admin actions; setup maps to what exists (§11.3) | roadmap flag |
| Everything in the §15 roadmap line | Budget, YAGNI (hive §7) | roadmap |

---

## 2. Architecture

### 2.1 Shape
- **One hooks module** (`hooks/hooks.json` → `./register.ts`; a second module stops both loading, L2). `register.ts` is the only file that calls `on()` or touches `$`.
- **Per-hook `host($)`**: a top-level `function host($): Host` returns literal closures, called on hook entry; never a module-level Host (authoring §5, L3; **I** S20).
- **Imports** static and relative. No npm, Node or zod in product code (SA-25, SA-27). Dev-only `node --test` files under `tests/git/` (§14).
- **State:** beads = durable, shared truth (tasks, drafts, claims + leases, phases, `cadre.*` metadata, cost, sync bookkeeping, and one **control issue** `cadre-control` holding the drive state, drive/sync leases and sync cursors, §11.4). `$.state cadre.board` = the **read model** (§2.5; CAS `update()`, ST-02, ST-03, UI-24), incl. `cadre.git {busy, epoch}`; `$.state cadre.events` = the event ring (500 per epic, rebuilt from beads on rehydrate, §2.5). `$.state cadre.secret` = the UI-private codes (§2.5). `$.store` = per-user keys only (§13.5). `.cadre/plans/<n>.md` is a projection.

### 2.2 Registration order (`register.ts`, outermost first; **I**: in-module order = chain order, S31)
A hook never runs beneath its own `$` call; a timer-caused `$` call skips **all** our hooks (G6). **Rule: anything may queue a resume; only registration #1 sends (resumes and drive continuations), only after `await next(e)`, and never from a timer,** with one exception (0.16): a setup install runs detached on the host's timer (claimed on its need record first) and, when it ends, answers and sends the requester's resume itself (`core/needs.settleSetups` → `sendQueued`), because no turn end may follow it (live on 2.1.295: the send was delivered from the timer frame, the requester resumed 33 ms later; the hooks a timer-caused call skips do not matter for a `session.send`, whose own hook is skipped by re-entry anyway). `command.run`, guards, observers, tool handlers and the tick only queue (P4: `$.prompt.submit` is refused from turn-holding hooks anyway).
1. `turn.complete` **resume-drain**: `const r = await next(e)` → send this session's queued resumes (§4.4) → on main, the drive continuation (§9) → `return r`.
2. `turn.complete` **observe**: nudge/auto-report/release (§3.4), L3 sweep (§13.1), cost (§7), checkpoints and main compaction trigger (§8).
3. `agent.spawn` admission. 4. `tool.check` allow (§13.2). 5. `tool.call` **guards** (L1, fence, Task* answers, MCP pre-checks). 6. `tool.call` **wrap** (L3 per-call fingerprint, delta drain, result card, tester call log). 7. `session.send` (§4.6). 8. `prompt.submit` (main context, notification card), `prompt.attachment`, `turn.step` (usage, effort), `session.compact` (card answer), `command.run` (`/cadre`, `/goal` observer; queue only), `config.set`, `session.start`.

### 2.3 Module map (core cap 5,000; targets sum to 4,850)
| Module | Jobs | LOC |
|---|---|---|
| `hooks/register.ts` | `on()` wiring in §2.2 order, `host($)`, `.catch`es, `session.start`, one `$.clock.every(5000)` tick → sync/adapters + heartbeats | 300 |
| `core/machine.ts` | `transition(board, event)`, legal-from table, pipeline steps as phases (§3.2) | 200 |
| `core/board.ts` | read model (snapshot schema, model/human views incl. `kind`, `merges`, typed deps, `condition`, `phaseSince`, plan rail fields), binding table, CAS helper, lazy rehydrate | 150 |
| `core/events.ts` | domain event schemas, envelope `actor`/`severity`/`needsHuman` table, in-module bus, per-epic ring (500) + rebuild from records/journal (§2.5) | 100 |
| `core/dispatch.ts` | command dispatcher: origin check (composer / sdk / `adapter:<name>`), grant + session token, `plan@code8` (§2.5) | 80 |
| `core/admission.ts` | admission, claim, rebind, release, review-spawn, lease staleness, recovery (§8.4) | 270 |
| `core/close.ts` | report → review → verdict → close, rework cap, squash | 200 |
| `core/tdd.ts` | red/green gates, `status:new` rule, lock, known-red, JUnit reader | 130 |
| `core/specview.ts` | view build (copy), optional stubs/skeleton argv, copy-in → `specCommit`, call log, content hash | 100 |
| `core/discover.ts` | discovery brief, `$HOME` overlay audit → cache proposal, validation runs (§10) | 100 |
| `core/reuse.ts` | the one sender: resume queue (per `sessionId`) + drain, drive (§9), resume vs fresh, checkpoints, handoff, cost ledger, compaction | 230 |
| `core/briefs.ts` | role templates, deltas, main context (diff-gated, `next:`), resume card, plan rules + missing line, id matcher | 200 |
| `core/render.ts` | model-visible text only: records → beads comment, commit message, result card, TaskGet text, main context line | 120 |
| `core/validate.ts` | report + draft field validation, example-bearing errors, completeness at approve | 110 |
| `core/git.ts` | `gitBusy`, worktree add/remove, commit, squash, ref CAS, jail argv (overlay / writable / `$HOME` overlay) | 170 |
| `core/effect.ts` | L3 fingerprint, window attribution, quarantine, restore, flags | 160 |
| `core/branches.ts` · `core/changelog.ts` | branch names, integration, release, version inference · KAC validate/insert/cut | 140 · 100 |
| `native/tasks.ts` | Task* `{result}` answers, field mapping, TaskList | 180 |
| `policy/guards.ts` · `containment.ts` · `settings.ts` | allowlists, per-tool fence input, fence, `decide()` · effective-settings check · settings deep-merge + diff + `.bak` | 170 · 50 · 70 |
| `task-management/{store,registry,protocol}.ts` | `TaskStore` · type registry + pipeline validation (§3.1) · adapter protocol client: one-shot spawn, framing, versions, grants (§11.3) | 90 · 70 · 120 |
| `task-management/sync-engine/{loop,reconcile,merge}.ts` | tick, lease, cursor replay, 3-way merge, heal | 170 |
| `task-management/adapters/beads/{store,bd,map}.ts` | the beads `TaskStore` incl. control issue + `--if-revision` leases | 330 |
| `agents/` · `config/` · `tools/` | roster+prompts · load/validate/defaults/classes/packages · 3 schemas + handlers | 90 · 160 · 130 |
| `commands/cadre.ts` · `commands/init.ts` | subcommand parse → dispatcher, status, approve sheet, resolve, release, drive, config, sync add · staged init wizard (8 stages, diff/confirm/validate/save) | 130 · 230 |
**UI client (separate cap: v1 ≤ 750, full ≤ 1,500, UI-DESIGN §9):** `ui/` = band, pane tabs, status line, toasts, row restyles: everything that only draws for the human. It is drawn locally by `ui.render`/`ui.toast` (UI-23, UI-24, UI-26) and never enters the model's context, so it costs **zero tokens**. It imports only the snapshot/event types (§2.5); core never imports `ui/`. Its layout, states and cap are defined in UI-DESIGN.md, not here.
**Rule:** core imports only `store.ts`, `registry.ts`, `protocol.ts`. Nothing outside `adapters/beads/` knows bd; nothing knows a language; renderers read only the read model and events.
**Re-cut (v2.2 core 4,710 → v2.3 core 4,780; `ui/` 110 left the core map).** `commands` was 140 for ~10 subcommands plus init; it is now 130 + 230. New: `events` 60, `dispatch` 80, `protocol` 120, `registry` +20. Funded by: `sync.ts` TS adapter interface + factories (−100: adapters are external processes), journal-less sync polling (−40: sync requires the journal, consented in init stage 2), release compare links (−15, roadmap), cache learning from denials (−20: replaced by the overlay listing), approval-sheet "before" from `tdd.stubs` (−10: prior contract only), `$.agent.list()` staleness + re-adopt special cases (−10: the lease decides), per-turn cost comments (−10), render reduced to model-visible text, band rows/toasts moved to the UI client (−40 here; they count against the UI cap), register (−30: command routing moved). Core headroom 220. **v2.5 (core 4,780 → 4,850):** the UI's read-model and event additions (§2.5) cost `events` +40 (envelope table, `agent.unbound`, `task.skipped`, `task.phase_changed` per step, per-epic ring + rebuild from records/journal) and `board` +30 (new task and plan fields; `condition` is derived from typed deps + upstream state). Emit sites in `admission`/`reuse`/`machine`/`loop` are one line each and stay inside their targets. Core headroom 150. If M8 overruns, next cuts: `tdd.stubs` (−20), sandbox-off every-call L3 mode (−30), macOS throwaway-worktree checks (−30).

### 2.4 Repository tree
```text
cadre/
├── .claude-plugin/plugin.json      # name "cadre", userConfig {strictness} (CC-14), "types"
├── hooks/{hooks.json,register.ts}  · types/index.d.ts (PluginState { cadre: { board: Snapshot } })
├── core/  machine board events dispatch admission close tdd specview discover reuse briefs render validate git effect branches changelog (.ts)
├── native/tasks.ts · policy/{guards,containment,settings}.ts · commands/{cadre,init}.ts
├── task-management/{store,registry,protocol}.ts · sync-engine/{loop,reconcile,merge}.ts
│   └── adapters/ beads/{store,bd,map}.ts · memory/store.ts (TEST; CADRE_STORE=memory)
├── adapters/fake/fake-adapter.mjs  # dev/test external adapter (protocol conformance), not product
├── agents/ config/ tools/
├── ui/                             # terminal UI client: own cap (design/UI-DESIGN.md), human view + events only
├── tests/  fixtures/{bd,briefs,native,render,junit,changelog,settings,discovery,view,registry,protocol,readmodel,events}/  *.test.ts  git/*.test.mjs  smoke/S01..S61.md
├── evals/<case>/{case.yaml,prompt.md,graders/*.md,scaffold.sh} · evals/fixtures/{ts,py,rust,go}/
├── docs/adr/ · docs/protocol.md (adapter protocol v1, events, snapshot) · README.md
```
**Committed:** `.cadre/config.json` (O keys + tighten-only S keys, §12) and `CHANGELOG.md`. `.cadre/plans/`, `.cadre/tmp/` are local via `.git/info/exclude`. beads syncs through its Dolt remote (beads §1.8); git branches don't leave the machine.

### 2.5 Extension boundary (UI-agnostic core)
One versioned contract (`docs/protocol.md`, `schemaVersion` on each part; goldens pin them):
- **Domain events** `{schemaVersion:1, seq, at, type, taskId?, agentId?, actor, severity, needsHuman, data}` (UI-DESIGN §2.2 calls `type` "kind"). **Every** event carries `actor` ∈ `human|main|tester|worker|reviewer|explorer|sync|mod`, `severity` ∈ `info|warn|crit` and `needsHuman` (boolean), set by core from a per-type table; the attention **level** (silent/band/toast/notify) stays a UI policy computed from these three, so replay re-derives it identically (UI-DESIGN §4). `type` ∈ `task.transitioned`, **`task.phase_changed {taskId, from, to}`** (every pipeline step, incl. spike `explore`/`report`), **`task.skipped {taskId, on}`** (a `conditional-blocks` upstream closed `done`, so the condition is not met and the task never runs), `agent.bound {agentId, taskId, role}`, **`agent.unbound {agentId, reason: answer|stopped|stale|rebind}`** (both `at`-stamped by the envelope; the pair gives the UI its timeline spans), `check.ran`, `flag.raised`, `flag.resolved`, `approval.pending`, **`sync.state_changed {target, state, at}`** (was `sync.status`; outage shading), `drive.status`, `cost.updated`, `init.stage`. UI-DESIGN §2.4 lists the finer kinds the UI consumes; `docs/protocol.md` maps each to one of these types, and the event golden pins the set. `task.transitioned` (v2.2's internal event) is the bus: each committed transition emits it (plus `task.phase_changed` when the step moves); subscribers in-module are the board, toasts, delta queue, resume queue and sync wake.
- **Event ring** `$.state cadre.events`: **500 events per epic** (≈60 KB; a 7-task epic emits ≈225, UI-DESIGN §2.2), read by `ui/` (replay) and served to adapters. `$.state` resets on `/clear` (UI-24), so the lazy rehydrate (§13.4) **rebuilds the ring from beads**: the `at`-stamped canonical records (§6.5) plus the beads journal (`bd events tail`, §11.2) for transitions and bindings; without the journal (sync not consented) it rebuilds from records only and replay is coarser. Rebuilt events get fresh `seq`s, so adapters still get `reset:true` + a snapshot (level-triggered: the snapshot is truth, events are hints).
- **Read model** = the board **snapshot** `{schemaVersion:1, seq, repo, mission, epic, plan{id, slug, state, epicBranch, approvedAt, landed?{dev, sha, at}, released?{version, at}}, tasks[{id, title, type, kind:'code'|'docs'|'spike', merges, state, step, phaseSince, owner?, deps[{id, type:'blocks'|'waits-for'|'conditional-blocks'}], condition?{on, state:'pending'|'met'|'not-met'}, flags[], card?}], approval{planId,missing[]}, drive, sync[], cost, containment, resumesQueued, init[]}`. `kind` comes from the type registry (§3.1: `docs` → `docs`, `spike` → `spike`, else `code`; a custom type may declare it); `merges` is false for spikes; `deps[].type` is beads' own dep type (§11.1); `plan.landed`/`released` come from §3.9 (UI-DESIGN §2.2, §11). Two views of one schema: **model** (main context, TaskGet, cards) and **human** (band, pane, toasts, adapters granted `commands`). **Neither view, no event and no adapter message carries a code.** `code8` and the init confirm code live only in the UI-private atom `cadre.secret = {approval?:{planId, code8}, initConfirm?}` (UI-DESIGN §2.3); only `ui/` reads it, to draw the band, the pane and a prefill. An external UI's human types the code from the band.
- **Commands** `{schemaVersion:1, cmd, args, origin}` with `cmd` ∈ `approve`, `reject`, `resolve`, `drive`, `release`, `init`, `config`, `sync`. `/cadre` parses text into a command; the dispatcher (`core/dispatch.ts`) is the only entry. **Human** = `origin.kind==='composer'` (CC-07), `sdk` under `approval.allowSdk`, or `adapter:<name>` when that adapter is granted `commands` in **user-level** config **and** the command carries the current **session token**. Approvals additionally need `plan@code8` from every origin.
- **Session token:** random, drawn at `session.start` and on `/cadre adapter token`, held only in `$.state`, shown to the human only by toast (UI-26: not in the transcript), never written to files or passed to adapter processes. External UIs ask the human to type it.
- **Every renderer** (band, status line, toasts, result card, TaskGet, main context, pane, future web UI/Desktop surfaces) consumes only the snapshot and events; `ui/` alone also reads `cadre.secret`.
- **One adapter protocol** for every external consumer (§11.3): sync targets, notifiers and a future web-UI sidecar are external processes with declared capabilities `sync`, `events` (subscribe + snapshot), `commands`. Mod-spawned, outside Claude's sandbox (SA-23).
- **Unreachable from agent shells:** adapters are spawned one-shot by the mod and listen on nothing in v1. Worker shells are offline (§13.1); on Linux a sandboxed command's `localhost` is private to that command and `allowLocalBinding` has no effect; on macOS `allowLocalBinding:true` opens host loopback, so the containment check treats it as `degraded` (SBX "connect to a server on your machine", "Hostnames that resolve to local addresses"). The token check holds regardless.
- **v1 scope / cost:** bus + ring + read model + dispatcher, documented; the band, status line and `cadre` pane (Epic + Plan tabs, UI-DESIGN §9.1) are the first clients; web-UI sidecar and notifiers are roadmap. Cost ≈ +180 LOC over the sync protocol (`events` 100 + `dispatch` 80), plus +30 in `board` for the v2.5 snapshot fields; the protocol client is shared with sync (§2.3 re-cut).

---

## 3. Workflow and state machine

### 3.1 Plan, type registry and approval
- **Drafts live in beads** with custom status `draft` (frozen category, never in `bd ready`), stable ids, excluded from sync. A plan = an epic. Main's first `TaskCreate` with `metadata.kind:"plan"` creates it; otherwise tasks join the current draft plan. Plans stay small (≈1–7 tasks).
- **Each task carries:** `type`, `scope?`, `breaking?`, `package` (§10), `scenarios` (Given/When/Then with ids `S1…`; they *are* the acceptance), `changelog` (`{category, entry}` or `{none, reason}`), `interface` (the contract, below). The pipeline comes from the type.
- **Task-type registry** (`registry.ts`, config `types`, written by init stage 6):

| type | commit | changelog | pipeline | contract |
|---|---|---|---|---|
| `feature` | `feat` | Added | tester → red → worker → green → reviewer → merge | required |
| `bug` | `fix` | Fixed | tester (regression) → red → worker → green → reviewer → merge | required |
| `refactor` | `refactor` | none | worker → green → reviewer → merge | required |
| `docs` | `docs` | none | worker → reviewer → merge | — |
| `test` | `test` | none | tester → reviewer → merge | — |
| `spike` | — | none | explorer → report (never merges, no worktree) | — |
  Custom types allowed. **Pipeline validation** (allowed orders): `red` directly after `tester`; `green` after `worker`; `merge` last and after `reviewer`; `explorer → report` alone; each step at most once. Overrides: label `security` → Security; explicit `Removed|Deprecated`; `breaking` makes the entry mandatory (default Changed). Commit type names the branch (§3.6). Until M5 the `tester`/`red` steps are skipped.
- **Interface contract** (language-free): `{symbols:[{name, kind, params, returns, errors?, doc?, status:"new"|"changed"|"unchanged"}]}` or `{none:true, reason}`. **`status` is declared by the planner**, shown on the approval sheet, and verified by the reviewer (a `new` name must not exist at the base, `changed` must differ, `unchanged` must not). Four readers: human (approval), tester (black-box tests), worker (conform), reviewer (conformance). Stored in the beads **`design`** field (`types.go:28`). Types marked `contract: required` need a contract or `{none, reason}`; the reviewer checks a `none` task changes no public API.
- **Plan rules, just in time (no skill).** The `{result}` answer to the plan's first `TaskCreate` carries `context:[planRules, "missing: …"]` (a `{result}` may carry `context`, d.ts:12717-12735; TP-05): rules ≤1.5 KB, byte-stable, once per plan. **Drafts may be incomplete**: later draft answers carry only the `missing:` line (≤200 chars) while it is non-empty. **Validation** refuses only *malformed present* fields, with an example-bearing error (`metadata.scenarios[0]: expected "S1: Given <state> When <action> Then <outcome>", got "user can log in"`); retries capped at 3 per draft. **Completeness** (scenarios, changelog decision, contract where required, package) is enforced at `/cadre approve`.
- **Approval sheet.** `/cadre approve <planId>` (no token) opens the `cadre` pane's Plan tab (`$.ui.log` where no pane draws, UI-DESIGN §7) showing, per task: type + pipeline, scenarios, changelog entry, contract with each symbol's `status`; for `changed`, a before → after signature diff from the prior accepted contract of that name (closed tasks' `design`), else "before: not on record". Missing fields block with the list. The command's `{text}` is one line (`Approval sheet for p3 opened in the cadre pane.`), because `{text}` is a model-visible transcript line (d.ts:1836-1845, **I**): the sheet costs zero tokens.
- **Token.** On every draft change, **and on every `/cadre approve …@<code>` attempt, accepted or refused (burn on use)**, the mod draws a new `nonce` (in `$.state` only). `code8 = fnv1a64(nonce + canonicalJSON(drafts))[0..8]`, held only in `cadre.secret` (§2.5) and drawn on the band, the pane and a prefill. Burn on use: the args of a typed command echo into the transcript (d.ts:10045) and `CommandSpec` can't mark them sensitive (d.ts:1885-1910), so the echo is model-visible (**I**, S53); the code the model can read is already dead. `/cadre approve p3@ab12cd34` from a human origin refuses a missing/mismatched token, flips drafts to `todo` (`store.approve`), records a decision, and cuts `epic/<id>-<slug>` from `dev` (first approval). A queued Enter before an amendment no longer matches; `/clear` draws a new nonce.
- **Approved tasks are frozen.** `TaskUpdate` of a plan field on a non-draft → `success:false, error:"approved; set metadata.amend:true to return it to draft"`. `amend` is legal from `todo` or `blocked`; binding and worktree kept. Only sync pulls of human fields change an approved task (flag `edited:<target>:<field>`, delta, shown to the reviewer).
- **Discovered work** (worker `followups`) becomes drafts in the backlog epic (`cadre-backlog`) with a `discovered-from` dep.

### 3.2 States and steps
beads categories: `todo · active · review · blocked · done · cancelled` (§11.2), plus `draft`. The current **step** of the type's pipeline is `metadata.cadre.step` inside **one** beads task (one claim, worktree, branch, approval, sync record). Transient `claiming/reviewing/integrating` live in `$.state`.
```text
 draft ─/cadre approve─► todo ─spawn (main)─► claiming ─► active·<first step>
   active·tester (in the spec view) ──report(tester): copy-in (+skeleton), commit, tdd.check must fail──► red✓ (specCommit frozen)
   active·worker ──report(done): mod commits C; [green step] verify must PASS (+spec tests passed)──► review
   review ──spawn/resume reviewer──► reviewing ──pass@C──► review✓ ──TaskUpdate completed (main): squash C into epic ─► done
                                              └─changes──► active·worker (RESUME owner; cycles counted, §3.4)
   spike: active·explorer ──report(explorer)──► done (answer recorded; no branch)
   active ──report(blocked | spec_change)──► blocked ──decision / /cadre resolve──► active (resume) | todo (release)
   any non-done ──TaskUpdate deleted──► cancelled ;  conflict / protected or locked-path diff ──► blocked
 Epic:  approved ─(children closed)─► TaskUpdate epic completed ─► integrating ─green, --no-ff into dev─► done-on-dev ─/cadre release─► released
```

### 3.3 Scheduling: delegated to `bd ready`
Admission runs `bd ready --parent <epic> --json -n 0` inside `agent.spawn` (SA-07). cadre adds plan approval, `maxParallel`, the claim CAS and flags. beads gives `blocks`, `waits-for`, `conditional-blocks` and gates for free (beads §1.5–1.6, `types.go:1513-1516, 1735-1764`); `human` gates resolve via `/cadre approve <gateId>@<code8>`. cadre never recomputes readiness.

### 3.4 Transitions: trigger and enforcement
"main" = loop without `e.agentId` (TP-02). "owner" = the bound `agentId` from `next()` (AG-13). Advisory turns every deny into a warning.
| Transition | Trigger | Enforcing mechanism |
|---|---|---|
| draft create/edit | main `TaskCreate`/`TaskUpdate` | `tool.call` `{result}` (§5.1) + field validation; subagents: not in allowlist; frozen fields |
| `draft` → `todo` | **human** `approve <token>` | dispatcher: human origin (§2.5) + `plan@code8` + completeness. The model can't run `/` text (PC-24); if S16 shows Skill reaches `/cadre`, main's `Skill` naming cadre is denied |
| `todo` → `active` (**claim**) | main spawns Agent naming exactly one known id | `agent.spawn` (AG-03, AG-05): id ∈ `bd ready`, no blocking flag, active < `maxParallel`, `fork!==true`, notes name no other id. CAS reserve → `store.claim` (lease) → worktree (§3.6; none for spike) → [tester step: spec view] → brief (AG-06) → retype per step (AG-07) → `model`/effort per role (AG-08) → `cwd` (AG-10). `r = await next(e)`; rejection → release, rethrow (AG-12). Deny `e.workflow` (AG-30), `e.isTeammate` (AG-27) |
| **next step** / **rebind** | main spawns the id of an `active`/`review`/`blocked` task | Legal when the step needs a new role (red✓ → worker) **or** the binding is stale (**beads claim lease expired**, §8.4), user-stopped, or over `reuse.maxContextPct`. Same claim actor, same worktree, computed handoff. Live binding → deny "TASK-x is running; it is resumed automatically" |
| `review` → `reviewing` | main spawns the id of a `review` task | CAS → retype `cadre:reviewer` (never a fork), tier by labels → `next` → bind. Live bound reviewer → deny (resumed for re-review) |
| marker-less spawn | anyone | Retype `cadre:explorer` (or the discovery/mission brief while that init request is pending, §10) |
| tester → red✓ | tester `report{role:"tester"}` | §3.5 red gate (`test` type: tests must pass instead) |
| `active` → `review` | owner `report{outcome:"done"}` | Owner-of-active; protected/locked paths unchanged; mod commits; [green step] verify → green gate |
| (no report) | agent stops | `turn.complete` with `agentId` (AG-24, TM-11): `answer` → nudge ×2 (queued resume), then **auto-report** from computed facts (WE R7b); `reason≠answer` → release, attempts+1, `blocked` at 3 |
| **release** | auto or main `TaskUpdate pending` | `store.release` → `todo`; WIP committed; worktree kept. Cancel saves the branch to `refs/cadre/quarantine/<id>-<ts>` and removes worktree + branch |
| `active` → `blocked` | owner `report{blocked\|spec_change}` | Claim kept. Main asks the human (AskUserQuestion) → `metadata.decision` → queued resume. `spec_change` needs `/cadre resolve <id> accept\|reject` |
| verdict | bound reviewer `report{role:"reviewer"}` | `pass@<sourceCommit>`; `changes` → rework. **Rework cap:** cycles beyond `review.maxRework` (3) count as **non-progress** for drive (§9) and show `rework 4/3` on the band; the human ends it with `/cadre resolve <id> reject\|cancel` |
| `review✓` → `done` | main `TaskUpdate completed` | Deny unless `pass@C`, C == tip == `sourceCommit`, clean tree, no protected/locked diff, changelog decided. Squash (§3.8), close, remove worktree, view, branch |
| reject / unblock / cancel | main `TaskUpdate` | Legal-from table; `deleted` → `close(cancelled, "failed: <why>")` so conditional-blocks fire |
| epic → done-on-dev | main `TaskUpdate{epic, completed}` | §3.9 |

### 3.5 Spec-first TDD and the black-box tester (`core/tdd.ts`, `core/specview.ts`)
Config per package (§10): `tdd: {check, paths[], report: null|{path}, stubs?: argv, skeleton?: argv, knownRed?: [check]}`; role profile: `tdd.author: separate|same`, `testerView: view|full`. Paths are globs, argv discovered and validated, the report is JUnit XML.
1. **Spec view** (`separate` + `view`, default). At admission the mod builds `<wtRoot>/<repoKey>.views/<id>/` (**outside** the worker `allowWrite` `<wtRoot>/<repoKey>`) by **copying** (never symlinking; source symlinks skipped and logged): files matching `tdd.paths` and `viewInclude` (docs, fixtures, `*.md`, from discovery) at the epic tip, `SCENARIOS.md` and `INTERFACE.md` rendered from the task, and, only if `tdd.stubs` is configured, that argv's output (run in the overlay jail, `CADRE_OUT=<scratch>/stubs`). The mod records a **content hash** per file.
2. **Tester capability** (P10): L1 allowlist `Read, Grep, Glob, Write, Edit, mcp__cadre__report`; `cwd` = the view; fence rule 2 (§13.2) is the one, terminal rule. Every tester call (name, normalized path, outcome) is logged.
3. **Audit at report:** the call log + the view's content hashes; only files under `tdd.paths` may differ from the build; anything else is listed on the red card and stored as a `tester-log` record.
4. **Copy-in is purely path-based:** the view's files under `tdd.paths` (and only those) are copied into the worktree. If `tdd.skeleton` is configured and the contract has `status:new` symbols, it runs in the **writable** jail with `CADRE_CONTRACT=<INTERFACE.md>` to write signature-only stubs. Both committed (§3.7) = `specCommit`.
5. **Red:** `tdd.check` at `specCommit` must exit ≠ 0. With `tdd.report`, each test in `tests[]` must be a JUnit `<failure>`. An `<error>` is accepted **only** when no skeleton is configured and every missing name it mentions is a **`status:new`** contract symbol (token match on our own data, P6); else "errors, not failures: fix test setup". The tester sees per-test failure messages only. `specCommit` frozen.
6. **Worker admission** requires `specCommit` + a red record when the pipeline has `red`.
7. **Locked** = `git diff --name-only <base>..specCommit -- <tdd.paths>`. Fence denies edits on locked realPaths; L3 quarantines them; close refuses M/D/R since `specCommit`.
8. **Spec change** via `report{outcome:"spec_change"}` → `blocked` → human `/cadre resolve <id> accept|reject`; accept rebuilds the view, new red, amended `specCommit`, audit comment. The amended red (the first tester round after accept) requires failing only for the tests named after the amended scenario (at least one); the others must still run and may pass, and the next red is strict again.
9. **Green** = verify at C passes; with `tdd.report`, every spec test present and passed (skipped ≠ passed). `knownRed` checks run but don't gate (§10.2).
10. **Reviewer** checks scenario→test coverage, no weakened assertions, no implementation detail in tests, contract conformance and symbol `status`.
- `author:same`: the worker gets the tester brief + allowlist in the tester step (full tree); after red✓ the mod queues a resume with the worker brief. `testerView:full`: cwd = worktree, fence = worktree + `tdd.paths` writes.
- **Plan B** (ADR 0004, not default): if S45 shows a path the normalized input (§13.2) doesn't capture escaping the root, the tester gets MCP `spec_read`/`spec_write` instead (~120 LOC, breaks the 3-tool cap).

### 3.6 Branches and worktrees
| Branch | Name | From → into | Gate |
|---|---|---|---|
| task | `<commitType>/<id>-<slug>` | epic tip → squash into epic | review `pass@sourceCommit` (+ green step) |
| epic | `epic/<id>-<slug>` | cut from `dev` at first approval → `merge --no-ff` into `dev` | children closed + suite green on the merge (§3.9) |
| release | — | `dev` → `branches.main` + annotated tag | human `/cadre release`, `dev` green |
- `branches.main` and `dev` come from init stage 1. Protected: `branches.main`, `dev`, `epic/*` change only through cadre merges (L3).
- **Worktree = the task branch**, outside the repo: `<wtRoot>/<repoKey>/<id>`, `wtRoot = ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt`, `repoKey = basename-<fnv8(realpath)>`. Created in `agent.spawn`: `git worktree add -b <branch> <path> <epic tip>` (records `cadre.base` = that tip), then `setup` in the writable jail. One retry on a lock collision.
- Cleanup on `done`/`cancelled`: worktree, view, `branch -D`. Quarantine refs kept 30 days.
- Not `AgentSpec.isolation:'worktree'` (AG-19, AG-10). Trunk mode: roadmap.

### 3.7 Mod git ops and `gitBusy`
Every mod git op runs in `git.op(scope, fn)`: CAS `busy=true` → run → `epoch++` → re-baseline → `busy=false`. "The mod commits" = `git add -A` + commit after checking protected/locked paths are unchanged; task-branch commits are `wip(<id>): …`. Mod git runs **without repo hooks**; refs move by CAS (`update-ref <ref> <new> <old>`). `core/git.ts` is pure helpers over an injected `run(argv)` (ADR 0003).

### 3.8 Task squash (close)
Under `git.op`, in the task worktree: `checkout --detach <epic tip>` → `merge --squash <sourceCommit>` → Conventional commit (§6.5) → if the epic moved since `cadre.base`: verify on this commit → move the epic ref by CAS. CAS loss → redo once, else `blocked`. Conflict or red → `blocked`.

### 3.9 Epic integration, changelog, release
- **Integration** (legal when every child is closed): throwaway detached worktree at `dev` → `merge --no-ff epic/<…>` → changelog insert of each child's entry, amended into the merge → `setup` + `suites.integration` per touched package → green: CAS `dev`, `cadre.landed=dev@<sha>`, epic branch deleted. Red: flag `integration-failed`; main plans fix tasks.
- **Changelog** (KAC 1.1.0): inserted only when a change lands on `dev`: under `## [Unreleased]` → `### <Category>` (KAC order) → `- <entry> (<id>)`. Every write validates the KAC shape; invalid → refuse with the line. Mod-owned path (fence, L2, L3, close).
- **`/cadre release [x.y.z]`** (human): `dev` green, no blocking flag, **`[Unreleased]` non-empty** (else "nothing to release"). `lastTag` = first of `git tag --list 'v*' --sort=-v:refname`; version from our own commit format (`!` → major, 0.x → minor; `feat` → minor; else patch; no tag → `0.1.0`). Commit `chore(release): vX.Y.Z` on `dev` → `merge --no-ff` into `branches.main` → `tag -a` → refs by CAS. `release.onEpicDone: propose` raises a toast; never automatic.

### 3.10 Checks and jails (mod's bwrap jail, outside Claude's sandbox, SA-23)
- `checks` = named argv per package; `verify` at the green step and at close when the base moved; `tdd.check` at red; `suites.integration` at integration and release. `$.process.run`, `timeoutMs ≤ 600000`.
- **Overlay jail (checks, offline):** `bwrap --unshare-net --ro-bind / / --dev /dev --proc /proc --overlay-src <wt> --tmp-overlay <wt> --bind <scratch> /tmp [--bind <jailWritable…>] --chdir <pkgRoot> -- <argv>`: tree writable, writes discarded, no network. `tdd.report.path` must be under `/tmp/cadre/` (config validation refuses others).
- **Writable jail (`setup`, skeleton; network on):** `--bind <wt> <wt>` instead of the overlay and no `--unshare-net`. `setup` is the only place anything is fetched.
- **`$HOME`-overlay jail (init discovery only):** the writable jail plus `--overlay-src $HOME --overlay <scratch>/home-up <scratch>/home-work $HOME`; afterwards the mod lists the top-level entries (depth 2 under `$HOME`) in `home-up` = the dirs `setup` wrote (§10.2).
- No overlay support (bwrap < 0.8, S42) or no bwrap (macOS) → a throwaway detached worktree at the target commit; network stance documented as unenforced there.
- Checks are mod-attributed, never quarantined; result (exit, duration, last 2 KB, log path) is a canonical record.

### 3.11 Process stance
Spec-first increments inside an epic, Kanban flow across epics (`bd ready` under `maxParallel`), no estimates. Re-planning only through amendment and re-approval. Releases are human. v1 is local git only.

---

## 4. Agents and their input

### 4.1 Roster (`$.agent.register` in `session.start`; AG-19)
The `tools` list (TP-19) is also the role's **L1 allowlist** (default-deny by name). Tier and effort per role come from the role profile (init stage 6).
| Agent | Tools = allowlist | Default tier / effort | Prompt (AC-03, byte-stable) |
|---|---|---|---|
| `worker` | Read, Grep, Glob, Edit, Write, NotebookEdit, Bash, PowerShell, Monitor, TodoWrite, `mcp__cadre__{report,run_check}`, `mcpAllow` | `standard` / default | Work only in the cwd. Make the given tests pass; never edit them; conform to the contract. Finish with `report` |
| `tester` | Read, Grep, Glob, Write, Edit, `mcp__cadre__report` | `standard` / default | Black-box tests from scenarios + contract, in the view |
| `reviewer` | Read, Grep, Glob, `mcp__cadre__{inspect,run_check,report}` | `standard`; `deep` for `review.deepLabels` | "Disprove each candidate" (hive §7). Coverage, contract + `status`, simplicity |
| `explorer` | Read, Grep, Glob, `mcp__cadre__{inspect,report}` | `fast` / `low` | Recon, discovery, spikes. Cite |
| main | Read, Grep, Glob, LSP, WebFetch, WebSearch, ToolSearch, Task*, Agent, AskUserQuestion, SendMessage, Skill, file tools (fenced), `mcp__cadre__inspect` (status/files/log), `mcpAllow` | session | Native Task*/Agent/AskUserQuestion. No `Cron*`/`ScheduleWakeup` (a second loop owner, §9) |
- **Fork-mode permissions** (SUB:900-913): the owner gets a `tool.check` **allow** (TP-08) mirroring fence rules 2–3; shells auto-allowed by `autoAllowBashIfSandboxed` (SBX). S26.
- `omitClaudeMd: false`. Task-bound `fork:true` spawns are denied (AG-11); marker-less forks get the explorer list. Workflow agents (AG-30) and pane teammates (AG-27) denied; unseen loops (AG-04) get the explorer list.

### 4.2 Canonical briefs (AG-06)
The mod **replaces** `e.prompt` with a per-role template; main's text survives as `## Orchestrator notes` (≤500 chars). **Static role header first, variable task data last** (§7).
| Role | Sections (in order) |
|---|---|
| tester | Static rules · `# SPEC TASK-<id>` · Scenarios · Contract · Test paths · "spec view; tests only" · Notes |
| worker | Static rules · `# TASK-<id> <title> (<type>)` · Description · Scenarios · Contract · Locked spec tests + red card · Direct-dep outputs · Findings / check cards · Decisions · Computed handoff (rebind/reset) · Paths of other active tasks (≤10, no ids) · Protected paths · Notes |
| reviewer | Static rules · `# REVIEW TASK-<id>` · `sourceCommit` · Diff (`--stat` + ≤3 KB) · Scenarios + contract + spec tests · Red/green cards · Tester audit · Worker report · Changelog + commit header · Flags · Notes |
| explorer | Static rules · `# QUESTION` or the discovery brief · Scope (read-only) |

### 4.3 Live deltas
Triggers: decisions, findings, a dep closed, a sync pull of a human field, an L3 violation, a flag. ≤1 KB deltas **per bound `agentId`**, drained by the wrap (#6) into `{...r, context:[delta]}` (TP-05, AC-04); a finished agent gets them in a queued resume.

### 4.4 Reuse: resume first, fresh as the fallback
A resume (`$.session.send({to:{agentId}})`) keeps `agentId`, transcript and cwd; it fires no `agent.spawn` and a new `turn.complete` (AG-14, AC-13).
1. **One sender.** Every resume is **queued** in `$.store` `cadre:<repoKey>:resumes` as `{sessionId, agentId, taskId, text}`; the drain (#1) sends **only entries with its own `sessionId`** after `await next(e)`. Under G6 the resumed agent's `tool.call` reaches #5/#6 and its `turn.complete` reaches #2; that `turn.complete` may skip #1, so later queued work waits for the next `turn.complete` of another loop, at the latest main's (the agent's completion notification). **S31(e):** the main notification turn caused by an agent that #1 resumed, or that a driven turn spawned, must reach #1. If not (A13), the band shows `resume queued — send any prompt` and the human's next prompt drains it.
2. **Rework on the same task only**; re-review resumes the bound reviewer with `lastReviewedCommit..sourceCommit`.
3. **Fresh spawn + handoff** when the agent was user-stopped, `{isDelivered:false}`, a one-shot, over `reuse.maxContextPct` (from `turn.step` usage, TM-07, S32), or idle > `reuse.cacheTtlMs` with context > 30 %.
4. **Binding table** `agentId → {taskId, role, step, worktree, sessionId, lastReviewedCommit, ctxTokens, startedAt}` in `$.state` + `$.store`. A resume to a different task is refused.

### 4.5 Main's per-turn context and reminder hygiene
- After a reset or compaction, main gets the one-time **resume card** (§8.2).
- **`prompt.submit` `context`** (PC-02), main-only (S35), ≤1 KB, **only when the snapshot hash changed** (§7), while a plan exists **or an init request (discovery, mission) is pending**; ends with one `next:` line:
  `plan p3 approved · epic/p3-auth · ready: a1 a4 · running: a2(w) a3(r) · a5 review✓ · a6 blocked · sync: pm offline (4)`
  `next: complete TASK-a5; ask the human about a6; spawn TASK-a1`
- `prompt.attachment` answers `{text:null}` for `todo_reminder`/`task_reminder` (BT-23, PC-11).

### 4.6 Task isolation (one agent = one task)
**Known-id matcher:** maximal runs of `[A-Za-z0-9.-]`, trailing `.`/`-` stripped, optional `TASK-` removed, exact lookup in the known-id set (`bd-a1.10` never matches `bd-a1.1`). Goldens: `.1` vs `.10`, sentence-end `bd-a1.`, `xbd-a1`, `bd-a1-x`.
| Surface | Rule | Mechanism |
|---|---|---|
| Brief | Bound task + direct deps only; spawn refused if notes name another id | `core/briefs.ts` |
| Deltas / reads | Per `agentId`; no Task* for subagents; `inspect` scoped to its worktree and `base..sourceCommit`; tester confined to its view | §4.3, `tools/`, §3.5 |
| Checks / messages | `run_check{task}` = binding; `SendMessage` naming another id → `{isDelivered:false}` | handler, `session.send` (AC-09) |

---

## 5. Tools, commands and surfaces (native first)

### 5.1 Native Task* for main (`native/tasks.ts`)
- **Availability (BT-10, C7):** `session.start` sets `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (`$.env.set`); init adds it to settings `env`. `tool.describe` sets `isDeferred:false` (TP-16) and tightens descriptions (TP-15).
- **Answering** via `tool.call` `{result}` (BT-01, BT-15), schema-exact per BTO §4; goldens. Main only.
| Native call | cadre meaning |
|---|---|
| `TaskCreate{subject,description,metadata?}` | Draft (`kind:"plan"` → epic; `kind:"mission"` → mission draft, §10.2); fields per §3.1; first of a plan carries rules + `missing:` |
| `TaskUpdate{addBlocks/addBlockedBy}` / plan fields | Drafts: deps / field validation. Approved: refused unless `metadata.amend:true` |
| `TaskUpdate{status:"completed"}` | review✓ → close; epic → integrate; else `success:false` |
| `TaskUpdate{status:"pending"\|"deleted"}` / `metadata.decision` | release / cancel / unblock |
| `TaskUpdate{in_progress}`, `owner`, `metadata.cadre*` | Refused |
| `TaskList` / `TaskGet` | Current epic from the model view; state as a subject prefix (`[review✓] …`); TaskGet renders contract + records |

### 5.2 MCP tools (3; `isDeferred:false`; strict schemas with `schemaVersion`)
| Tool | Caller | Input | Effect |
|---|---|---|---|
| `report` | bound worker/tester/reviewer; explorer | §6.2 envelope | transitions; validated (§6.3) |
| `inspect` | reviewer, explorer; main (`status`, `files`, `log`) | `{what, task?, rev?, path?}` | `git -C <tree> <sub> --end-of-options <rev> -- <path>`; `rev` verified |
| `run_check` | worker, reviewer | `{name, task}` | `name` ∈ the package's `checks`; overlay jail on the caller's tree |

### 5.3 `/cadre <sub>` (one registration, CC-01; every sub except `open` → a dispatcher command, §2.5)
`immediate:true` (CC-02) is per registration, so every sub runs at once, mid-turn; that is safe because subs only queue or move state by CAS (§2.2, §3.7).
| Sub | Who | Effect |
|---|---|---|
| `approve <id>` (sheet in the pane, one-line `{text}`) · `approve <id>@<code8>` (burns the nonce) · `reject <planId> <why>` · `release [x.y.z]` | human | §3.1 / drop drafts / §3.9 |
| `resolve <id> keep\|accept\|reject\|cancel` · `resolve git keep\|restore` · `restore <ref>` | human | clear flags (§13.1) |
| `init [<stage>] [confirm <code>]` | human | next incomplete stage, or re-run `<stage>` (§10.1); a `confirm` burns the code |
| `setup [confirm <code>]` | human | one-time per-machine install check; may propose a user-settings diff (added post-v1 per ADR 0007) |
| `doctor` | anyone | read-only diagnosis of the machine and the project, any time, no writes (added post-v1 per ADR 0007) |
| `sync add <adapter>` · `sync [now]` | human · anyone | sync setup (§11.3) · wake sync |
| `adapter token` | human | draw a new session token, shown by toast only |
| `config [show\|set <k> <v>]` · `drive on\|off\|status` | `set`, `drive`: human | §12 · §9 |
| `status` | anyone | text board from the model view + cost ledger |
| `open [epic\|plan\|task <id>\|sync\|cost\|release\|init]` | anyone | opens the `cadre` pane at that tab (UI-02); not a domain command: `register.ts` routes it to `ui/`, no state change (UI-DESIGN §5.1) |

### 5.4 Clients of the read model
The terminal client below is the `ui/` module (own cap; detailed design in `design/UI-DESIGN.md`, which governs over this summary). It draws locally and costs zero tokens; only the main context line and `/cadre status` are model-visible.
| Surface | Content | Mechanism |
|---|---|---|
| **Band** (`AbovePrompt`) | L1 `[RUN] cadre · p3 auth-login · strict · contained ✓ · drive ▶ 12/100 · ctx 34% · cache 87% · pm ✓`. L2 the **mini-DAG strip** `✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done · ▶1 ⏸1 ◌1   ↻1` (one glyph per task in depth order). With attention: a `⚑ NEEDS YOU` row and `type /cadre approve p3@ab12cd34`; `resume queued — send any prompt` and `drive ⏸ approve p4` fold into these rows (UI-DESIGN §6.1) | `ui.render` reads the human view + `cadre.events` + `cadre.secret` (UI-24, UI-23) |
| **Pane** `cadre` (v1: Epic, Plan tabs) | Epic view: live DAG of the epic's tasks, `epic → dev → main` rail, selected-node detail, 6-row log, timeline + replay from the ring; approval sheet with `code8` in its footer only | `ui.render` `Pane`, opened only by `/cadre open`, `/cadre approve <id>` or a band press (UI-02) |
| Status line | **attention only**: top item, e.g. `⚑ cadre: approve p3 (1 more)`, no code; set only while attention exists, cleared otherwise (counts live on the band) | UI-27 |
| Toasts | events → toasts (sync, quarantine, landed, release, `/clear` hint, session token) | UI-26 |
| Main context / text | §4.5 / `/cadre status` (model view) | PC-02 / CC-03 |
**Glyphs** (user decision 2026-10-10: the designer's set): the legend is UI-DESIGN §6.0 (pipeline strip `●◉○`, state glyphs `✓ ▶ ⏸ ◌` …), always paired with a word tag (`[RUN]`, `[OK]`, …) so color and glyph are never the only signal. Config `ui.glyphs: unicode|ascii` (§12) selects an ASCII fallback for fonts lacking these glyphs; the word tags carry the meaning in both.
`-p`/SDK/VS Code draw nothing (UI-33); `/cadre status` and the main context carry the board, and the approval sheet falls back to `$.ui.log` (VS Code: the code too, never command text; UI-DESIGN §7).

---

## 6. Output contract

### 6.1 Computed beats claimed
The mod computes changed files, commit, diff stats, check results, red/green, duration and tokens (TM-07); they override the model. Prose after an accepted `report` is ignored.

### 6.2 One `report` envelope
`{schemaVersion:1, role, …}`:
- `worker`: `{outcome:"done"|"blocked"|"spec_change", summary≤1500, risks?≤5, questions?[{q,options?}], reason?, tests?[path], followups?≤5[{title,description}]}`
- `tester`: `{outcome:"done", summary≤800, tests[{path, name, scenario}]}`
- `reviewer`: `{verdict:"pass"|"changes", summary≤1500, findings[{severity, file, line?, issue≤400, fix?≤400}], coverage[{scenario, test?, ok, note?}], contractStatus[{name, ok, note?}]}`
- `explorer`: `{answer≤2000, citations≤20[{path,line}]}`, or discovery `{discovery:{packages[{root, setup[argv], checks{name:argv}, fetches?[name], tdd:{paths[], report?, stubs?, skeleton?}, viewInclude?[]}]}, citations}` (§10)

### 6.3 Semantic validation
Reviewer `findings[].file` must exist at `sourceCommit` (`git cat-file -e`); computed `inDiff` (false allowed); `changes` needs ≥1 blocker/major; `pass` with a blocker refused; `coverage` names every scenario; `contractStatus` names every symbol. Tester `tests[].path` exists in the view and matches `tdd.paths`. Explorer citations resolve (SA-04); discovery argv cite their source file. Errors are precise and example-bearing. After `limits.reportRetries` (3) failures: accepted + flag `report-unvalidated`.

### 6.4 Result card
A fixed ~600-char card replaces the subagent's final answer, rendered from the snapshot's task `card`:
`TASK bd-a1 "Add login" · worker → review · green ✓ (test 41s) · files 4 (+120 −30) · commit 1a2b3c4 · $0.41 (cache 91%) · flags: none · next: spawn TASK-bd-a1 (reviewer)`
Foreground: the Agent `tool.call` wrap replaces `content[0].text` (AC-05 **V**, S39). Background, main idle: `prompt.submit` `task-notification` rewrite (AC-07 **I**, S40a). Background, main running: `prompt.attachment` rewrite (S40b). A failing path passes the notification as is; the card rides the next context line.

### 6.5 Canonical records → renderers (`core/render.ts`)
Each record `{schemaVersion, kind, taskId, at, actor, computed, claimed}` is stored in beads (`cadre.rec.<kind>` + a comment) and emitted as an event. Renderers (goldens): beads comment `[cadre:<kind> v1]`; **commit message** (CCm) `<type>[(<scope>)][!]: <description>` + summary + footers `BREAKING CHANGE:`, `Refs: <id>`, `Cadre-Review: pass@<sha7>`, `Cadre-Checks: …`; band rows, toasts, card, TaskGet, sync fields.

### 6.6 `inspect` / `run_check` output
Header `exit=<n> · <duration>s · truncated=<yes|no>` + capped body (16 KB / last 4 KB) + log path under `.cadre/tmp/logs/`.

### 6.7 Versioning
Every schema (envelope, records, briefs, cards, config, plan rules, events, snapshot, commands, adapter protocol) carries `schemaVersion`; goldens pin them; a bump needs an ADR migration note.

---

## 7. Cost & cache discipline
- **Byte-stable prefixes.** No system-prompt edits (P3). Agent prompts, tool lists, MCP and `tool.describe` text contain no dates, ids, counters or config values (goldens). All agents of a type share the system+tools prefix (measured in S44).
- **Briefs static-first**; main's context **diff-gated** by snapshot hash; plan rules once per plan.
- **A fresh main per epic:** when an epic lands and main's context > `cost.clearHintPct` (40 %, SS-14), a toast suggests `/clear` (never automatic). All state is in beads.
- **Compaction = the resume card** (§8.3); **need-to-know main** (§8.5).
- **TTL-aware scheduling.** The reviewer spawn is put first after a worker report; rework/re-review resumes go out at the `turn.complete` that produced them. Fresh-vs-resume uses `reuse.cacheTtlMs` (5 min). **1h TTL only if S44 shows reuse beyond 5 min pays** (idle gaps measured vs the higher 1h write cost). Routes: `subagentPromptCacheTtl` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` apply to **every** subagent and background request (env-vars.md:396), so cadre would only propose them in the init settings diff; the per-agent route is subagent-file frontmatter `experimental.cacheTtl` (SUB:320; "read only from subagent files"; `AgentSpec` in d.ts has no such field), which S43 tries by shipping the four roles as plugin agent files instead of `$.agent.register`.
- **Effort and tier per role** from the role profile (`turn.step` → `next({...e, effort})`, TM-03; AG-08).
- **Retries capped at 3** (reports and drafts).
- **Cost ledger.** `turn.step` usage per `agentId` (TM-07) is summed per agent and task and written as **overwritten metadata** `cadre.cost` at `turn.complete` (no comments); one `cost` record comment at close. Cost in USD from a price table per tier in config (`cost.prices`), else token-equivalents `input + 1.25·cache_creation + 0.1·cache_read + 5·output`. Main's own from `$.session.usage().cost?.usd` (SS-14). Band cell `cache NN%`.
- **M0 S44** measures fresh vs resume vs fork, the cross-worker prefix hit rate, and idle gaps; `reuse.*` thresholds and the TTL decision come from it (ADR 0001).

---

## 8. Continuity & main's context
Goal: any session reset (`/clear`, `/resume`, `/branch`, compaction, crash) on **this machine** loses no decision or committed work, and main carries only what it needs. Branches are local and never pushed; another machine sees beads state (via Dolt) but not the code, and recovers as below.

### 8.1 Durable hierarchy (all in beads)
| Level | beads object | Content |
|---|---|---|
| Mission | one `milestone` issue (`types.go:790`), from init stage 3; edits via draft + approval | goal, constraints, non-goals |
| Epic | the approved plan | intent, scenarios, contracts |
| Decision | `decision` issues (`types.go:784`, sections `types.go:890-895`), auto-recorded on approve, resolve, answered questions | what, why, alternatives |
| Task | task + `cadre.step` + checkpoints | step, owner, last checkpoint |

### 8.2 Resume card (one-time)
On a lazy rehydrate (board `version===0`, §13.4) main's next `prompt.submit` gets a one-time card (≤3 KB, golden): mission · epic + intent · last 5 decisions · open questions · in-flight tasks (id, step, owner, checkpoint) · drive state · `next:`. The card's snapshot hash is stored as the last-sent context hash, so the diff-gated line doesn't repeat it.

### 8.3 Compaction
- Main: `session.compact` answers **`{messages:[card, …recent]}` without calling `next`** (SS-08: "answer `{messages}` yourself without `next`"; a message without an engine handle is built from `role`/`text`, d.ts:10751-10832). The card is the summary; recent = the last turns of `e.messages` that fit. The card's hash is stored (`lastCardHash`) and the §8.2 path is skipped for that compaction, so the card is delivered once. If S49 shows the answer can't stand in for the summary, fall back to `next({...e, instructions})` + the §8.2 marker path. Agents: `next({...e, instructions})` keeping task id, `specCommit`, last check card, open findings.
- **Trigger:** past `cost.compactPct` (60 %, SS-14) mid-epic, observe (#2) on main's `turn.complete` calls `$.session.compact()` (SS-09, P4: legal from `turn.complete`; the compact hook is another registration, so it runs). S49.

### 8.4 Mid-task continuity and recovery
- **Checkpoints:** at each worker `turn.complete` and before a rebind, the mod commits a dirty tree as `wip(<id>): checkpoint` and records `cadre.checkpoint`. If **locked paths are dirty**, the checkpoint is refused and flag `locked-dirty` raised (L3 quarantines them).
- **Computed handoff** (never a model summary): checkpoint sha, `git diff --stat <hb>..checkpoint` (+ capped patch) with `hb` = `specCommit` when the pipeline has `red`, else `cadre.base` (the epic tip at claim); failing tests from the last check; last report notes; decisions.
- **Staleness = the beads claim lease** (`bd heartbeat`, TTL 5 min, `lease_expires_at` from `bd show`; beads §1.9, `cmd/bd/heartbeat.go`). The session whose `$.agent.list()` holds a bound agent heartbeats it every 120 s from the tick (bd only, no hooks needed, G6). Another session sees a live lease and never rebinds it; an expired lease → stale → admission rebind. Leases are node-local (`heartbeat.go:27-30`): enforceable only among sessions on this machine; across machines, claim status/assignee is the fence.
- **Resume queue** per `sessionId` (§4.4); entries whose task lease is stale are dropped (that agent is gone; the rebind handoff replaces them).
- **Recovery** (rehydrate/admission): worktree path missing but branch present → `git worktree prune` + `worktree add <path> <branch>` + `setup`. **Task branch missing** → flag `lost-wip`, release to `todo`, the next claim starts fresh from the epic tip. **Epic branch missing** → epic `blocked`, flag `lost-epic`, human resolves (re-cut from `dev` or cancel).

### 8.5 Main on a need-to-know basis
Always: resume card (once), diff-gated board line, result cards, `next:`. On demand: `TaskGet`, explorer answers, `inspect status|files|log`, log paths. Never pushed: transcripts, diffs, check logs, raw test output.

---

## 9. Drive (autonomy): cadre's own deterministic goal
`/goal` (GOAL, TM-26) is a prompt-based Stop hook judged by a small model from the conversation only; one per session; the model can't set it. cadre drives from **computed beads state**.
- **Done is computed:** every task of the epic `done`, epic landed on `dev` green, changelog decisions written → stop + toast (+ `/clear` hint).
- **Arming:** `/cadre drive on` (human) arms; nothing is submitted then (P4: refused from `command.run`). Drive **starts at the next `turn.complete`**: registration #1, after `await next(e)`, calls `$.prompt.submit({text})` (PC-05, `origin.kind:'plugin'`, never approves) with the `next:` action as plain text (`cadre drive: complete TASK-a5; spawn TASK-a1`), never starting with `/`. **Never from a timer** (G6: a timer-caused turn skips all cadre hooks). Nothing is submitted when `next:` is "wait"; notifications wake main. S47(b): a notification turn caused by a driven spawn reaches #1; else the band's `resume queued — send any prompt` fallback applies.
- **Pauses on every human gate:** approval, blocked question, any `/cadre resolve` flag, release, `git:*` flags. Band `drive ⏸ approve p4`; one toast.
- **Bounds:** `drive.maxTurns` (100), **`drive.maxCostUsd`** (20; cost ledger + SS-14, §7), `drive.maxWallMinutes` (240); **no progress** = no beads transition in `drive.noProgressTurns` (3) driven turns (rework past the cap is non-progress, §3.4) → pause + toast.
- **State + lease in beads:** `{on, level, epicId, turns, costUsd, startedAt, lastProgressSeq, lease:{session,until}}` on the control issue, written with `bd update --if-revision` (CAS). Only the lease holder drives; another session shows `drive: held by <session>`. Rehydrate reloads it, so drive survives `/clear` and compaction and continues at the next `turn.complete`.
- **Levels:** v1 ships `epic`; `mission` and `step` are roadmap.
- **Coexistence with `/goal`:** a human-typed `/goal` is observed by `command.run {command:'goal'}` (CC-05; pass-through `await next(e)`, never rewritten) → band `two loop owners: /goal active`, drive pauses until `/goal clear`. A goal **restored by `--resume`** raises no command; S48 checks `goal_status` attachments via `prompt.attachment`; fallback (A27): README + a one-time band hint after `/resume` while drive is on.

---

## 10. Ecosystems and the staged `/cadre init`
cadre has **no language logic and ships no presets**. Stack specifics are the repo's own declarations, discovered, confirmed, **validated by running**, then frozen as config.

### 10.1 The wizard
`/cadre init` runs the next incomplete stage; `/cadre init <stage>` re-runs one. Each stage: **propose → diff → human `confirm <code>` (composer) → validate → save**. The code is **nonce-salted like `code8`**: `fnv1a64(initNonce + diff)[0..8]`, `initNonce` drawn for every shown diff and **redrawn on every `init confirm` attempt, accepted or refused** (burn on use, §3.1); it lives in `cadre.secret.initConfirm` (§2.5). A plain hash of the diff would let a model that saw the diff compute the code and offer it as a clickable link, which is composer origin (d.ts:8866-8869). On confirm the mod **re-reads** each target file: bytes changed since the diff → recompute and re-show, no write; else write `<file>.bak`, then the file (CC-16: settings are written by `$.fs.write` after human confirmation). A stage is complete when its validated keys exist, so stages are idempotent and need no progress state. Each emits `init.stage`.
| # | Stage | Proposes | Validates |
|---|---|---|---|
| 1 | **repo** | no repo → `git init` + initial commit; default branch (`origin/HEAD`, else current, else ask); `git branch dev <default>`; `.git/info/exclude` entries; which keys go to the committed vs user-level config | `git rev-parse`, both branches resolve |
| 2 | **store** | `bd ≥ 1.3.0` probe; `bd init --non-interactive --skip-agents --skip-hooks`; statuses (`draft:frozen,in_review:wip`), types, **journal consent** (required for sync); control issue | bd round-trip: create a draft, read it, drop it |
| 3 | **mission** | queues a request; main's `next:` asks the human for goal, constraints, non-goals and drafts `TaskCreate{kind:"mission"}` | approval `/cadre approve <id>@<code8>` → milestone |
| 4 | **discovery** | §10.2 | §10.2 |
| 5 | **containment** | settings merge (§13.1) + learned caches → `contained ✓` | `session.start` check re-run (S28) |
| 6 | **workflow profile** | type registry (§3.1) + roles: tier + effort per role, `tdd.author`, `testerView`, `maxParallel`, drive bounds, strictness; defaults shown in full | schema check + pipeline validation + a dry render of a sample brief per role |
| 7 | **changelog** | KAC skeleton, or none if a valid file exists | KAC validator |
| 8 | **sync** (optional) | "Sync this project with an external tracker?" lists configured adapters → §11.3 setup | §11.3 step 4 |
Defaults stay editable via `/cadre config`.

### 10.2 Discovery (stage 4), by P10
1. **Diff 1** (stages 1–2, 5's settings block without caches) is already saved; discovery needs the store.
2. **Explorer.** `command.run` can't spawn (G6, P4), so stage 4 queues a request; main's context (gate exempt, §4.5) says `next: spawn the discovery explorer`; the marker-less spawn is retyped with the discovery brief. It reads CI config, task runners, manifests, README/CONTRIBUTING and test dirs (CI wins over prose) and answers `report{discovery}` (§6.2): per package `setup`, `checks`, `tdd.paths`, JUnit flag + path, `stubs`/`skeleton`, `viewInclude`, and `fetches[]` = checks whose CI step fetches at test time, each with citations.
3. **Cache audit.** Per package the mod runs `setup` once in a throwaway worktree in the **`$HOME`-overlay jail** (§3.10) and lists which top-level dirs under `$HOME` it wrote (e.g. `.cache/pnpm`, `.cargo/registry`). Those become the proposed cache dirs. No stderr is read; a build/target dir shared across parallel workers is never proposed.
4. **Diff 2** (its own re-read/`.bak`): `packages[]`, cache dirs for `jailWritable` and sandbox `allowWrite`, optional opt-in `sandbox.network.allowedDomains` for worker shells, `fetches` shown as warnings, and `knownRed` if step 5 found red checks.
5. **Validate** in the mod's bwrap jail (outside Claude's sandbox, SA-23) with the confirmed binds: `setup` succeeds (writable, network on); every check passes at the clean base (overlay, **offline**); a configured JUnit path is produced and parses. **Only validated values are saved.** A check that is red at base can't become `verify`; the escape is marking it `knownRed` in diff 2 (human-confirmed, S key → user-level, §12), which creates a backlog task "fix known-red <check>". A check that needs the network fails validation and isn't saved (its `fetches` warning explains why).
6. **Packages:** `packages:[{root, setup, checks, verify, tdd, viewInclude, knownRed}]`; a path belongs to the package with the **longest** segment-aware `root` prefix; a task carries `package`; integration runs each touched package's suite.
7. **Fixtures, not logic:** `evals/fixtures/{ts,py,rust,go}` prove discovery and the loop across stacks.

### 10.3 Network stance
Fetching happens only in `setup` (mod jail, network on). Checks run with `--unshare-net`. Worker shells are offline by design: sandbox `allowedDomains` starts empty (SBX "Network isolation"); an unlisted host prompts the human in manual modes and is refused in `dontAsk`. `strictAllowlist:true` refuses without prompting but only takes effect in **user** settings (repo settings ignored, SBX), so init offers it as an optional user-settings hunk (Q7). Opt-in hosts go in diff 2.

---

## 11. Task management: local store + sync

### 11.1 `TaskStore` (`task-management/store.ts`): beads always; `memory` for tests
```ts
export type Category = 'draft' | 'todo' | 'active' | 'review' | 'blocked' | 'done' | 'cancelled'
export type TaskId = string
export type DepType = 'blocks' | 'waits-for' | 'conditional-blocks' | 'parent-child' | 'discovered-from' | 'related'
export interface Task {
  id: TaskId; title: string; description: string; acceptance?: string; type: string
  category: Category; nativeStatus: string; priority: 0|1|2|3|4; assignee?: string; leaseUntil?: string
  parent?: TaskId; deps: { id: TaskId; type: DepType }[]; labels: string[]; externalRef?: string
  design?: string                         // interface contract (canonical JSON)
  meta: Record<string, string>            // "cadre.*": step, package, base, specCommit, sourceCommit, rec.*, cost, changelog, flag, sync.<target>
  revision?: string; updatedAt: string
}
export interface NewTask { title: string; description: string; acceptance?: string; design?: string; type: string; priority?: number; parent: TaskId
  deps?: { id: TaskId; type: DepType }[]; discoveredFrom?: TaskId; meta?: Record<string, string>; gate?: { await: 'human'|'timer'|'gh:run'|'gh:pr'; arg?: string } }
export type ErrorCode = 'NotFound'|'AlreadyClaimed'|'NotClaimable'|'GuardMismatch'|'NotClosable'|'Cycle'|'Busy'|'Timeout'|'Unavailable'|'NotInitialized'|'Invalid'|'TooOld'
export interface TaskStore {
  probe(): Promise<{ ok: boolean; journal: boolean; version: string; detail: string }>
  init(o: { types: TypeRegistry; journal: boolean }): Promise<void>                      // idempotent, consented
  createEpic(title: string, goal: string): Promise<TaskId>
  createDraft(t: NewTask): Promise<Task>; dropDrafts(ids: TaskId[]): Promise<void>; link(id: TaskId, dep: { id: TaskId; type: DepType }): Promise<void>
  approve(ids: TaskId[]): Promise<void>; amend(id: TaskId): Promise<void>
  get(id: TaskId): Promise<Task>; list(f: { parent?: TaskId; updatedAfter?: string }): Promise<Task[]>; ready(parent: TaskId): Promise<TaskId[]>
  claim(id: TaskId, actor: string): Promise<Task>; resume(id: TaskId, actor: string): Promise<Task>
  release(id: TaskId, actor: string, why: string): Promise<void>; move(id: TaskId, to: 'review' | 'blocked', actor: string): Promise<Task>
  heartbeat(id: TaskId): Promise<void>
  update(id: TaskId, patch: Partial<Pick<Task,'title'|'description'|'acceptance'|'design'|'priority'|'labels'>>, actor: string): Promise<Task>
  comment(id: TaskId, text: string, actor: string): Promise<void>
  setMeta(id: TaskId, kv: Record<string, string>, actor: string, ifRevision?: string): Promise<Task>   // ifRevision → GuardMismatch: the lease CAS
  setExternalRef(id: TaskId, ref: string, actor: string): Promise<void>; resolveGate(gateId: TaskId, reason: string): Promise<void>
  record(kind: 'mission' | 'decision', title: string, body: string, link?: TaskId): Promise<TaskId>
  close(id: TaskId, o: { outcome: 'done' | 'cancelled'; note?: string; session?: string; ifRevision?: string }): Promise<Task>
  events(since?: string, limit?: number): Promise<{ head: string; events: { seq: string; op: string; id: TaskId; actor: string }[] } | null>
}
```
`memory` implements every method and runs the same contract test. **Actor** `cadre/<user>/<rand6>` per repo+user (`$.store`); sync writes as `<actor>+sync`. Claim authority: `$.state` CAS within a session, beads claim across sessions. `Busy` → one retry → "beads busy, retry" deny. `Unavailable`/`NotInitialized`/`TooOld` → no claims or closes (P4).

### 11.2 beads adapter (`adapters/beads/`)
Transport `$.process.run(['bd',…,'--json'], {cwd: repoRoot, env, stdin, timeoutMs: 45000})`. Env: `BD_JSON_ENVELOPE=1`, `BD_NON_INTERACTIVE=1`, `BEADS_ACTOR`, `BEADS_GATE_WAIT_TIMEOUT=10s`. Free text is never a separate argv word: `=`-attached or stdin (`cmd/bd/flags.go:15-38`).
| Op | argv |
|---|---|
| probe / init | `bd version`, `bd where`; `bd init --non-interactive --init-if-missing --skip-agents --skip-hooks`; `bd config set status.custom …`, `types.custom`, `events-journal true` |
| drafts | `bd create -t <type> --parent <epic> -s draft --title=… --stdin --acceptance=… --design=… --metadata=… --deps <t>:<id>` · `bd dep add` · `bd delete` · `bd update <id> -s draft` |
| approve / ready / get / list | `bd update <ids…> -s open` · `bd ready --parent <epic> -n 0` · `bd show <id>` (incl. `lease_expires_at`) · `bd list --parent <epic> --all -n 0` |
| claim / resume / release / heartbeat | `bd update <id> --claim` · `bd update <id> -s in_progress --if-assignee <a>` · `bd unclaim <id> --if-assignee <a> -r=<why>` · `bd heartbeat <id>` |
| move / meta / comment / gate | `bd update <id> -s <native> --if-assignee <a>` · `bd update <id> --set-metadata k=v [--if-revision R]` (`update.go:1085`) · `bd comment <id> --stdin` · `bd gate resolve <id>` |
| record / close / events | `bd create -t milestone\|decision …` · `bd close <id> -r=… [--if-revision R]` · `bd events tail --since <seq> --limit 500` |
Mapping: `todo/active/review/blocked` = `open/in_progress/in_review/blocked`; `done/cancelled` = `closed` + reason. Raw `bd` writes from a worker shell fail at the OS level (`.beads/` under `denyWrite`); outside writes are detected (§11.4).

### 11.3 Adapters: external processes on one protocol (`task-management/protocol.ts`, `docs/protocol.md`)
**Layers.** *Code*: any executable (bundled or installed); v1 bundles only `adapters/fake/` (dev/test). *Project config* (`.cadre/config.json`, committed, O): `sync.<target> = {adapter, project, mapping, direction}`. *User config* (U, S): `adapters.<name> = {command: argv, credentialEnv: "REDMINE_API_KEY", grants: ["sync"|"events"|"commands"]}`; only the env var **name** is stored; the adapter reads it from its inherited environment; cadre checks it is set.
**Transport.** `$.process.spawn({argv, input})` (SA-09) closes stdin after `input`, so every exchange is **one request → one response**: stdin = `{protocol:"cadre-adapter", v:1, method, params}`, stdout = `{v:1, ok:true, result}` or `{v:1, ok:false, error:{code:"Offline"|"Auth"|"RateLimited"|"Conflict"|"NotFound"|"Invalid"|"Unsupported", message, retryAfterMs?}}`. Any language. Run from the tick (no hooks needed, G6), `timeoutMs` 30 s, outside Claude's sandbox (SA-23).
| Method | Grant | Purpose |
|---|---|---|
| `ping` · `describe` | — | liveness · `{name, version, caps[], subscribe?[eventTypes]}` |
| `describeSchema` · `listProjects` · `validateAccess` | sync | trackers/types, statuses + allowed workflow, priorities, versions, custom fields (required?) · accessible projects · auth + view/add/edit in the project + mapped entities exist (no writes) |
| `push` · `pull` | sync | `{tasks[{localId, rid?, etag?, changed[], fields}]}` → `{results[{localId, rid, etag?, rUpdated}]}` (idempotent) · `{since}` → `{tasks[RemoteTask], next}` |
| `deliver` | events | `{events[], snapshot (human view if granted commands, else model view), reset?}` → `{ack: seq, commands?[{cmd, args, token}]}` |
Returned commands enter the dispatcher with origin `adapter:<name>` (§2.5): refused without the `commands` grant or a matching session token; approvals also need `plan@code8`. Option A (in-process adapter plugins via a `$.cadre` namespace, `engine.create`, PO-11) is recorded as the alternative in ADR 0002: no process cost, but adapters must be TS mods, share our failure domain, and gain no isolation. A long-lived sidecar (web UI) is roadmap: `serve` mode prints a loopback URL, messages ride `$.http.fetch` (SA-11) with the same shapes.
**Guided setup** (`/cadre sync add <adapter>` = init stage 8), each step a confirmed diff:
1. **Connection:** URL (project config) + env var name (user config); `ping` + `validateAccess` auth only.
2. **Project must exist:** `listProjects` → the human maps one. cadre never creates remote projects (roadmap flag).
3. **Mapping proposal** from `describeSchema`: type → tracker, status → only the target's allowed workflow, priority, mission → version/milestone, decisions → journal notes/comments, required custom fields → a default or block setup.
4. **Validate without writes:** auth, role permissions (view/add/edit) in that project, mapped entities exist; optional human-allowed probe ticket (created and closed, `Refs` noted).
5. **Initial direction:** push beads / import remote as backlog drafts / start empty → cursor init on the control issue.
Twenty (roadmap): the Task object exists; custom fields are proposed, creating them needs an admin key. Redmine (roadmap): trackers/versions map directly.

### 11.4 Sync engine (`sync-engine/`): level-triggered, state-based
1. **Change source:** the beads journal (required; init stage 2). Per target, `{cursor, lastPull, lease:{session,until}}` live on the **control issue** (shared by every session on this machine via beads; written with `--if-revision` CAS), so **one instance syncs per target**. Remote ids live in each task's `cadre.sync.<t>` metadata (shared), so upserts are idempotent across sessions and machines.
2. **Push:** non-draft tasks; `+sync` events skipped; per-field `fnv64` hashes, changed fields only; upsert by stored `rid`; first target → `setExternalRef`. Mission → version; decisions → comments.
3. **Pull + 3-way merge:** remote cursor/etag or `updatedAt` − 2 min, deduped. Workflow fields push-only; human fields pulled → `+sync` + flag `edited` + delta. Both changed → **beads wins** + remote comment + flag `conflict`. Remote status change → flag `drift`; strict refuses the next transition until `/cadre resolve` (Q8).
4. **Heal** every 15 min and on reconnect.
5. **Loop:** the tick acts when woken, after 30 s, or when a backoff (30 s → 5 min) expires; only bd + adapter processes + `$.state`; resumes queued. Idempotent (B6). Event-only adapters (`deliver`) ride the same tick.
6. **Writes outside cadre:** a status/assignee change by an actor ∉ {actor, actor+sync} → flag `external`; strict refuses the next transition until resolve.

---

## 12. Config (repo files may only tighten security keys)
**Layers (low → high):** `defaults.ts` → `userConfig` (CC-14) → `$HOME/.claude/cadre.json` (incl. per-repo sections by `repoKey`) → repo `.cadre/config.json` (main checkout only) → env `CADRE_STRICTNESS`, `CADRE_STORE`, `CADRE_ALLOW_SDK_APPROVAL`, `CADRE_DISABLE` → `/cadre config set` (human). Bad layer skipped with a diagnostic. `config.set` (CC-12) refuses strictness changes while tasks run.
**Classes.** **S** = security: the repo file may only tighten (booleans toward strict, enums by order, lists intersected); relaxations live in user-level config (init writes them there). **U** = user-level only. **O** = ordinary (committed).
| Key | Class | Default |
|---|---|---|
| `strictness` · `approval.allowSdk` · `mcpAllow` | S | `strict` · `false` · `[]` |
| `jail`, `jailWritable` · `effectCheck` | S | `auto`, learned (§10.2) · `auto` |
| `tdd.enforce`, `changelog.enforce` · `roles.testerView` · `packages[].knownRed` | S | `true` · `view` · `[]` |
| `adapters.<name>.{command, credentialEnv, grants}` | U + S | none |
| `store.bin`, `store.dir`, `worktrees.root` · `drive.*` · `cost.prices` | U | `bd`, repo, `~/.cache/cadre/wt` · `epic`, 100 turns, $20, 240 min, 3 · none |
| `sync.<target>.{adapter, project, mapping, direction}` | O | — (§11.3) |
| `types` (registry) · `roles.<role>.{tier, effort}` · `roles.tdd.author` · `models` | O | §3.1 · §4.1 · `separate` · `{fast:"haiku", standard:"sonnet", deep:"opus"}` |
| `packages[]` · `suites.integration` | O | discovered + validated · all checks of touched packages |
| `review.{deepLabels, maxRework}` · `limits.reportRetries` | O | `["security","breaking"]`, 3 · 3 |
| `changelog.path` · `branches.{main,dev,epicPrefix}` · `release.onEpicDone` | O | `CHANGELOG.md` · init, `dev`, `epic/` · `propose` |
| `ui.glyphs` | O | `unicode` (`ascii` = fallback set for fonts lacking the UI-DESIGN §6.0 glyphs, §5.4) |
| `maxParallel`, `maxRows`, `reuse.{maxContextPct,cacheTtlMs}`, `cost.{clearHintPct,compactPct}`, `store.{timeoutMs,pollMs}` | O | 3, 6, 60/300000, 40/60, 45000/10000 |

---

## 13. Enforcement and safety

### 13.1 Three independent layers (P10)
**L1: Capability (allowlist)** at `tool.call` (TP-01, TP-02, TP-27): per-role tool-name allowlists (§4.1). Shell tools pass only for an `agentId` bound as worker to an `active` task in the worker step. Unknown ids and marker-less forks get the explorer list. Any loop: `input.dangerouslyDisableSandbox === true` → deny (an input fact). Advisory: denies become warnings.

**L2: Containment (shape):** Claude Code's OS sandbox (SBX) wraps Bash/PowerShell/Monitor and children; subagents share it; mod processes run outside (SA-23).
- **Init stage 5 settings write** (`.claude/settings.local.json`, deep-merge, diff, re-read, `.bak`): `{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"},"sandbox":{"enabled":true,"failIfUnavailable":true,"allowUnsandboxedCommands":false,"autoAllowBashIfSandboxed":true,"filesystem":{"allowWrite":["<wtRoot>/<repoKey>","<caches…>"],"denyWrite":["<repo realpath>","<repo>/.git/refs/heads/<main>","<repo>/.git/refs/heads/dev","<repo>/.git/refs/heads/epic","<repo>/.git/packed-refs"]}}}` (ref entries kept only if S24 holds). `network.allowedDomains` is not added (empty = offline) unless opted in at diff 2.
- **Effect:** shells write only to `<wtRoot>/<repoKey>` (not the views), caches and per-user tmp; `denyWrite` on the main checkout covers `.beads/`, `.cadre/`, `CHANGELOG.md`. Linked-worktree `.git` writes (SBX "Git worktrees") are checked in S24; L3 audits refs regardless.
- **`session.start` check** (`$.settings.read()`, S28): `enabled && failIfUnavailable && !allowUnsandboxedCommands && denyWrite∋repo && allowWrite∋<wtRoot>/<repoKey> && !network.allowLocalBinding` → `contained ✓`; else `degraded` + toast, L3 every-call. Non-empty `excludedCommands` → `N commands unsandboxed`.

**L3: Effect check (audit)**, `core/effect.ts`:
- **Fingerprint** = `git status --porcelain=v2 -z` (excluding `.cadre`, `.beads`, settings.local) + `rev-parse HEAD` + `for-each-ref refs/heads`. Tools with no write capability in any allowlist are skipped. Views are not git trees; they are audited by §3.5.3.
- Sandbox on: per call only the main checkout and the caller's own worktree; full sweep at every `turn.complete` and before every merge. Sandbox off: everything after every call. `gitBusy`: skip, re-baseline on epoch change.
- **Attribution by in-flight window** (`{loop, tool_use_id}` since the last baseline): (1) worktree files change only while their owner (or the mod) had a call in flight, else stash-quarantine (`git stash push -u -m cadre-q-<id>-<ts> -- <paths>`), flag, toast; locked paths changed by the owner's shell → same. (2) Main checkout: quarantine only in a window where a non-main loop had a call in flight; else flag `git:main-dirty`. (3) Protected refs moved outside a cadre merge: human window → flag `git:<branch>`, `resolve git keep`; agent window → flag `git:<branch>:agent`, `resolve git restore` saves the tip to `refs/cadre/quarantine/<branch>-<ts>` and CAS-moves the ref back (Q4). Merges are refused while a `git:*` flag is open.
- Limits: ignored files and paths outside git are L2's; attribution under concurrency is best-effort (S18 cost).

### 13.2 File fence (file tools; order matters)
For `Edit, Write, NotebookEdit` (and `Read` under `~/.claude/plugins/store/`) in every loop; for the tester, **every** file tool.
0. **Input path, normalized per tool** (input fields, not a channel list): Read/Write/Edit → `file_path`; NotebookEdit → `notebook_path`; Grep → `path ?? cwd`; Glob → if `pattern` is absolute, its non-glob base dir (as the engine's `XOe`/`gCt`, `chunk-v6ff19vh.js`: `searchDir = baseDir`), else `path ?? cwd`. A file tool not in this table is denied to the tester (its allowlist doesn't name one).
1. `realPath` via `$.fs.stat(p,{resolve:true})`; a new file resolves its folder (SA-04).
2. **Tester (terminal):** `realPath === root || realPath.startsWith(root + "/")` (segment-aware; root = its view, or its worktree with `testerView:full`) → **allow, skip 3–5**; else deny.
3. **Owner check:** a path under the main checkout or `<wtRoot>` requires the caller to own an `active` task and the path to be under its worktree.
4. **Mod-owned and harness paths**, even for the owner: `.git/`, `.cadre/`, `.beads/`, `.claude/`, `.mcp.json`, `CHANGELOG.md` in any tree; `~/.claude/settings*.json`, `~/.claude/cadre.json`; locked spec tests in the worker step.
5. Elsewhere, allow.
The `tool.check` allow mirrors rule 2 (tester) and rule 3 (owner). Close refuses a `base..sourceCommit` diff touching rule-4 paths. Goldens: `/x/bd-a1` vs `/x/bd-a1.view` (not under), Glob `{pattern:"/etc/*"}` → base `/etc` → denied, Glob `{pattern:"**/*.ts"}` in the view → allowed.

### 13.3 Fail-closed, time, C1, C6
- Every gating registration carries `.catch(($,e,next)=> next.error?.kind==='re-entry' ? judgeFromEventOnly(e) : next.called ? next(e) : {deny:'cadre: guard failed; refused'})` (G1, G2); `tool.check` → `{decision:'deny'}`. Judge before `next` (G3). `budget.test.ts` greps `validate --json` `gatingHooks[].hasCatch`.
- Time: `$.clock` only (SA-19), no sleeps in gating hooks (B2), long work in processes.
- C1: managed `allowedMcpServers` refuses our MCP tools → task-bound spawns denied. C6: a gated mod enforces nothing; L2 survives.

### 13.4 Session boundaries
`/clear`, `/resume`, `/branch` reset `$.state` with no `session.start` (ST-09, SS-02). Lazy rehydrate: board `version===0` → reload from beads + `$.store`, new nonce, re-baseline L3, run recovery (§8.4); bindings whose lease is live are kept, expired → stale. Resume card (§8.2). A new session token is drawn.

### 13.5 `$.store` hygiene (ST-15: 4 MiB)
Per repo, per user: `actor`, `agents` (binding cache), `resumes` (per `sessionId`), `quarantine` index. Drive, leases and sync cursors are in beads. `session.start` prunes closed bindings, stale-lease resume entries and quarantine older than 30 days.

### 13.6 Rule → mechanism map (P1)
| Rule | Mechanism |
|---|---|
| Main never edits code / has no shell | L1 + fence + L3 |
| Only an active owner writes, only in its worktree | fence 3 + L2 `allowWrite` + L3 rule 1 |
| Only the human approves plans, contracts, spec changes, releases | dispatcher human origin (composer / `allowSdk` / granted adapter + session token) + `plan@code8` (burn on use, held in `cadre.secret`) |
| Tests first, black-box, not weakened | pipeline admission + spec view + allowlist + terminal fence rule 2 + call log/hash + copy-in/red + lock + reviewer |
| Merge only the reviewed, green commit | close check verdict@C == tip == `sourceCommit`, clean tree, computed green |
| Protected branches change only through cadre | L3 rule 3 (+ restore) + L2 ref `denyWrite` (if S24) |
| CHANGELOG.md is mod-owned | fence + L2 + L3 + close + validation |
| Repo config can't relax | §12 classes + fence on `.cadre/` |
| No sandbox or network escape | L1 `dangerouslyDisableSandbox` deny + `allowUnsandboxedCommands:false` + empty `allowedDomains` + checks `--unshare-net` |
| One agent = one task; one driver/syncer per repo | §4.6 + beads leases on the control issue |
| Config only from validated runs | init stages (§10) |
| External UIs can't act as the human without the human | grant (user-level) + session token (toast-only) + `plan@code8` |

### 13.7 Human actions are never blocked
`!` commands raise no `tool.call` (`processBashCommand`, `chunk-1wwsre6t.js`, **I** S37); L3 judges their effects as human: flagged, never reset. The human's editor, commits and pulls: L3 rules 2–3. Recovery: `/cadre restore <ref>`.

---

## 14. Testing
**ADR 0003:** the kit can't run processes (KIT:21). Porcelain/`process.run` fixtures cover hook paths; real git runs in dev-only `node --test tests/git/*.test.mjs` over pure `core/git` helpers; the fake adapter runs in `node --test tests/protocol/*.test.mjs`; plus live smoke tests.
| Layer | What | How |
|---|---|---|
| Pure units | machine (pipeline steps, epic states), guards (allowlists, per-tool fence input, fence order, terminal rule 2, segment-aware root), §12 classes, registry **pipeline validation** (each illegal order refused), beads map, 3-way merge, id matcher, settings merge, version inference, `status:new` error rule, longest package root, branch names | kit on pure modules |
| Goldens | approval sheet (status column, changed diff, missing list); plan rules + `missing:` line; draft field errors; briefs per role; byte-stable prompts/tools/describe; native `{result}`; renderers; KAC; JUnit; jail argv (overlay offline / writable / `$HOME` overlay); spec view (no source bodies, no symlinks, hashes); copy-in by path only; **type registry defaults** + a sample brief per role; **read-model schema** (no view, event or adapter message carries `code8` or the init code; only `cadre.secret` does); **event schemas** (envelope `actor`/`severity`/`needsHuman` per type; `agent.unbound`, `task.skipped`, `task.phase_changed` for every step incl. spike); **snapshot task/plan fields** (`kind`, `merges`, typed deps, `condition`, `phaseSince`, `approvedAt`, `landed`, `released`); **adapter protocol messages**; discovery proposals; resume card; handoff (both bases) | `tests/fixtures/*` |
| Hook chain | main Bash/Edit denied; shell only in the worker step; tester `/x/bd-a1` vs `.view`, Glob absolute pattern outside → denied, in-view all allowed incl. `tool.check`; `dangerouslyDisableSandbox` denied; marker-less retype; fork denied; id refusals; approve origin + token + completeness; **burn on use**: an accepted and a refused `approve …@code` and `init confirm` each redraw the nonce; frozen fields; claim CAS (S2); rebind on expired lease only; **resume drained only by its own `sessionId`**; `command.run` queues only; `/goal` command observed → drive pause; context diff-gated and gate-exempt for init requests | kit raises events; stubs for `process.run`, `fs.*`, `store.*`, `settings.read`; `mock.clock` |
| Output / TDD | finding-file validation, `inDiff:false`, retry flagging, card on 3 paths; red refused on pass or non-`new` `<error>`; lock; green skipped ≠ passed; `knownRed` doesn't gate; spec_change; rework cap → non-progress | kit + fixtures |
| Effect / branching | quarantine rules 1–3, restore by CAS; squash, `--no-ff`, release cut, empty `[Unreleased]` refused; locked-dirty checkpoint refused | kit + `node --test` |
| Init stages | each stage: propose → diff → confirm mismatch refused → changed-bytes re-show → `.bak` → validate → save; re-run idempotent; stage 1 on a non-repo (`git init`); stage 2 round-trip; stage 4 sequence (diff 1 → explorer → `$HOME` overlay listing → diff 2 → validate), red base → `knownRed` path, network-needing check not saved; stage 6 invalid pipeline refused | kit + `process.run` fixtures |
| Multi-session | two sessions: live lease → no rebind; expired → rebind; drive and sync leases via `--if-revision` (loser sees `GuardMismatch`, backs off); resume entries of another session untouched | kit with two bound `$.state`s over one memory store |
| Continuity / drive | rehydrate mid-epic and mid-task; **ring rebuilt from records + journal** (≤500 per epic, fresh seqs, adapters get `reset:true`; records-only without the journal); compaction **answer** = `{messages:[card,…]}` with no `next` call, card not re-sent; `compact()` only from `turn.complete`; recovery `lost-wip` / `lost-epic`; drive armed by command but first submit at `turn.complete`, never from a clock callback; pauses at gates; USD bound; no-progress | kit + goldens |
| Adapter protocol | conformance against the fake: `ping`, `describe`, `describeSchema`, `listProjects`, `validateAccess` (no writes), `push` idempotent, `pull` cursor; `deliver` receives events + snapshot; its command refused without grant, refused without/with wrong token, accepted with both; approval via adapter refused without `plan@code8`; a non-granted adapter gets the model view | `node --test` + kit with `process.spawn` stubs |
| UI / budget | band rows from the human view + `cadre.secret`; `/cadre approve <id>` `{text}` is one line; status line empty without attention; MCP tool count = 3, skills = 0, core LOC ≤ 5,000 and `ui/` LOC ≤ 750 in v1 (1,500 full; counted separately), `.catch` on every gating hook | `$.ui.mount` / `budget.test.ts` |
| Live smoke | S1–S14 (WE), S15–S61 | `claude --plugin-dir ./cadre --debug-file cadre.log` |
| Real model | `claude plugin eval`: (a) "fix this bug" → main never Edits/Bashes; (b) "execute plan p1" on a seeded approved plan → full pipeline per stack `ts`, `py`, `rust`, `go`; (c) auto-report; (d) review `changes` → same `agentId` resumed | bootstrap below |
**Eval bootstrap (EVAL).** Child = `claude -p … --permission-mode dontAsk --setting-sources user` in an empty `home/cwd/` (EVAL:448, :452); case env `EVAL_*` (EVAL:153); `scaffold.sh` (EVAL:144) copies a fixture with validated `.cadre/config.json` and pre-initialised `.beads/` holding approved plan p1, runs `git init`, creates `dev` and `epic/p1-…`. Approval is kit-only. `timeout_seconds: 2400`, `max_turns: 150`. `-p` runs Agents in the foreground (card via AC-05). The band reads `degraded` (harness sandbox, EVAL:455); evals assert L1/L3/flow. `claude plugin eval . --scaffold --trust-plugin --allow-tools Bash Edit Write "mcp__*"`.

**Smoke tests (S15–S61):**
- *Spawn/agents:* S15 `cwd` rewrite · S16 model can't reach `/cadre approve` · S17 register in `session.start` + retype · S20 `host($)` passes `validate --strict` · S22 background workers across `/clear` keep their lease and are re-bound.
- *beads:* S18 latency under 3 workers + L3 cost · S19 `bd create -s draft --deps --stdin --metadata=` · S30 journal shape · S33 `bd ready --parent` · **S50** `lease_expires_at` in `bd show`, heartbeat from a second session refused, `--set-metadata --if-revision` CAS.
- *Sandbox/jail:* S23 `denyWrite` cwd + `allowWrite <wtRoot>/<repoKey>` · **S24** linked-worktree `.git` vs `denyWrite`, ref entries · S25 `dangerouslyDisableSandbox`, `excludedCommands` · S26 owner Edit + `tool.check` allow → no prompt · S27 `setup` writable jail persists · S28 `$.settings.read` · **S42** `--tmp-overlay`, scratch report survives, `--unshare-net` blocks fetch · **S46** the `$HOME` `--overlay` upper dir lists exactly what `setup` wrote.
- *Approval:* S29 link-click and queued-Enter origins (M2a, see §16.1).
- *Reuse:* **S31** chain order; (a) drain after `next` sends a nudge queued by #2; (b) the resumed agent reaches #5/#6/#2; (c) resuming the agent whose `turn.complete` fires; (d) a `command.run`-queued resume goes out at the next `turn.complete`; **(e)** the main notification turn caused by an agent #1 resumed reaches #1 · S32 `turn.step` usage per `agentId`.
- *Native:* S34 `{result}` + `context` on `TaskCreate` reaches main · S35 context absent from subagents · S39 foreground card · **S40** (a) idle notification, (b) running-main attachment.
- *Tester view:* **S45** Read/Grep/Glob/Write/Edit with `..`, absolute paths, **Glob absolute patterns (confirm normalization to the base dir)**, globs spanning parents, symlinks: nothing outside the root is read or written.
- *Cost:* **S43** which TTL registered agents get; does a plugin agent file with `experimental.cacheTtl: 1h` apply per agent · **S44** fresh vs resume vs fork, prefix hit rate with 3 workers, idle-gap distribution.
- *Human/eval:* S37 `!` raises no `tool.call` · **S41** seeded eval fixture runs, mod-tool grant, `dontAsk` + `tool.check`.
- *Drive/compaction:* **S47** (a) a `$.prompt.submit` turn from #1 reaches guards and #2, and whether #1 sees its `turn.complete`; **(b)** the notification turn caused by a driven spawn reaches #1 · **S48** a `--resume`-restored goal is detectable (`goal_status` via `prompt.attachment`) · **S49** `session.compact` answered `{messages:[card,…]}` without `next` replaces the summary; `$.session.compact()` from `turn.complete` runs our compact hook.
- *Forks:* S36 `fork:true` seen by `agent.spawn` and deniable.
- *UI (UI-DESIGN §10.2, S-UI1..11):* **S51** after the band and pane draw `code8`, `$.session.messages()` and the transcript JSONL contain no `code8`; the same for status/toast text · **S52** band press → `prompt.fill` with an empty composer, a non-empty composer and an open dialog (`isFilled`/`refusal`) · **S53** do `/cadre approve p3@x` args reach the model's messages (sizes the need for burn on use; it ships either way) · **S54** what `$.ui.log` and toasts render in the VS Code chat panel · **S55** `/cadre open` at 60 cols places the pane inline; `isPlaced` reasons · **S56** the Remote Control `/cadre approve` origin is `bridge` · **S57** `Raster` in a narrow inline pane clips at `bodyColumns`, scrolls under `maxRows`; a 101×8 grid encodes and `$.ui.blit` repaints the cursor without a re-render · **S58** `Raster` accepts `█ ▒ ░ ╌ ┃ ▼` and ASCII `. o * !` (width-1 BMP) and refuses an ambiguous-width glyph as documented · **S59** node `Box row [Text, Button plain, Text]` validates on terminal + desktop; Up/Down/Enter move and press node Buttons · **S60** redraws under a 3-worker burst stay within UI-23 limits; the flash timer clears · **S61** desktop: the `Raster` fragment draws nothing and the "timeline: terminal only" note shows.

---

## 15. Milestones (vertical, risk-first; each ends with `validate --strict` + `plugin test` green)
| M | Slice | Acceptance criteria |
|---|---|---|
| M0 | **Throwaway spike** (`spike/`): S1, S13, S15–S17, S20, S18/S19/S30/S33/**S50**, S23–S28, **S31 (a–e)**, S32, S34–S37, S39, **S40**, **S41**, **S42**, **S43**, **S44**, **S45**, **S46**, **S47 (a, b)**, **S48**, **S49** | `docs/adr/0001-m0-results.md`; every failed assumption has its §16.1 fallback chosen; reuse/TTL from S44; Plan B decided from S45 |
| M1 | Skeleton + capability + **read model**: plugin.json, `host($)`, config + classes, events bus + snapshot (band = first client), L1, fence (per-tool input, terminal rule 2) + `tool.check`, sandbox-flag deny, retype, fail-closed, advisory, `/cadre status`; **init stages 1 repo, 2 store, 5 containment (without caches)** | Kit: main Bash/Edit denied; tester fence goldens; snapshot + event goldens; stages 1/2/5 tests. Live: S28, `contained ✓` |
| M2a | Plan + approval: Task* drafts, **type registry + init stage 6**, plan rules + `missing:`, completeness at approve, contract `status`, token, **dispatcher with origins**, frozen fields, **init stage 3 mission**; live S29 | Kit: token mismatch, completeness refusal, registry goldens, frozen fields. Live: S29, S34 |
| M2a-ui | **Plan tab + prefill** (`ui/` ≈200: shared readers/tag-glyph table incl. `ui.glyphs` 50, pane shell 40, approval sheet 90, prefill helper 20). Opens with S51, S53, S56 (they size the approval channel) | Goldens: sheet wide/narrow/amended. Live: **S51** no `code8` in messages/JSONL, **S52** prefill cases, **S53** args echo, **S55** inline at 60 cols, **S56** `bridge` refused |
| M2b | Admission + claim (tester steps skipped until M5; `packages[]` hand-written): `bd ready`, claim + **lease/heartbeat**, rebind on expiry, worktree + setup, briefs, id matcher, `gitBusy`, recovery | Kit: S2, one-id rule, multi-session lease tests. Live: S4, S6, S10, S15, S23, S27, S50 |
| M2c | **L3 effect check**: fingerprints, windows, quarantine, `resolve git`, `restore` | Kit rules 1–3; `node --test` restore. Live: S18 |
| M3 | Report + output contract: `report`, mod commit, offline overlay checks, `run_check`/`inspect`, validation, card on 3 paths, records, nudge/auto-report, **resume queue per session + drain**, checkpoints (locked-dirty), handoff, deltas, cost ledger | Kit: a trivial plan reaches `review`; drain resumes the same `agentId`. Eval (c) |
| M3-ui | **Band + mini-DAG strip + notification policy** alongside the core loop (`ui/` ≈240: band 95, policy 85, result-card row 35, resume banner + C3 detect + `$.ui.log` fallback 25); needs `task.phase_changed`, typed deps, `severity`/`needsHuman` (§2.5) | Kit: band rows + strip from the human view; policy matrix + dedupe + rate limits (`mock.clock`); status line empty without attention. Live: **S54** VS Code fallback |
| M4 | Review + close: reviewer, verdict@commit, `contractStatus`, re-review, **rework cap**, squash, cleanup, resolve, `failed:` | `node --test` squash. Live: two-task chain on `epic/…`. Eval (d) |
| M4-ui | **Epic DAG view + detail + log** after review/close (`ui/` ≈165: depth layout + edge grid, nodes with strip + flash + Buttons, rail, detail, 6-row log); needs `kind`, `merges`, `condition`, `task.skipped`, `plan.approvedAt` (the rail's `landed`/`released` fill in at M6). Opens with S59 | Goldens: wide + stacked layouts, edge styles, skipped node. Live: **S59** node Buttons, **S60** redraw rate + flash timer |
| M5 | **TDD + discovery:** init stage 4 (explorer, `$HOME` overlay audit, diff 2, validate, `knownRed`), `packages[]`, tester, view (hash, call log), copy-in, red (`status:new`), lock, green, spec_change, coverage. Fixtures ts first, then py, rust, go | Goldens; S45/S46 applied; eval (b) on 4 stacks |
| M6 | Integration + changelog (**init stage 7**) + release | `node --test` `--no-ff`, release + tag. Kit: human commit on `dev` blocks integration |
| M6b | **Drive** (after the loop; budgets from the M3 ledger): arm/start rule, gates, USD bound, no-progress, beads lease, `/goal` observer | Drive kit tests; live: a 3-task epic from approval to `done-on-dev` with no human prompts, pauses at release |
| M7 | **Adapters + sync** (after the core loop): protocol client, fake adapter conformance, **init stage 8 / `sync add`** guided setup, engine, sync lease in beads, external-write detection, `deliver` + adapter commands (grant + token + `plan@code8`) | Protocol conformance + drift + crash-resume + adapter-command tests |
| M7-ui | **Timeline (`Raster`) + replay** after drive and sync (`ui/` ≈125: timeline 100, replay 25); needs `agent.bound`/`agent.unbound` spans, `sync.state_changed`, the 500-event ring and its rebuild. Opens with S57/S58 | Kit: replay fold at cursor = live render at `t = now`; ring rebuild after `/clear` replays the same DAG. Live: **S57** narrow Raster + blit, **S58** glyph widths, **S61** desktop note. `ui/` ≤ 750 |
| M8 | Hardening + continuity: resume card, compaction answer (S49 result), frontier rows, `$.store` pruning, README, `docs/protocol.md`; **per-module LOC re-baselined** | Kit: rehydrate → card golden; compaction answer. Evals 3/3 per stack; every **I** in §16 has a smoke result; core ≤ 5,000, `ui/` within its own cap |
**UI slices** (`-ui` rows) ride the core milestone that first produces their data, riskiest smoke first; each slice's read-model fields and events land in that core milestone (schema goldens from M1). They sum to ≈730 (UI-DESIGN §9.1); if a slice fails its smoke, UI-DESIGN §9.1's drop order applies (replay → flash → stacked timeline → timeline), never the Plan sheet. Later UI (Task/Sync/Cost tabs, flag/release/init views, desktop `Svg`) follows M8 under the 1,500 cap.
**Roadmap:** `mission`/`step` drive levels · web-UI sidecar (`serve` mode over `$.http.fetch`), notifiers on the same read model · Redmine → Twenty adapters (Twenty custom-field creation needs an admin key) · remote project creation · living API map · trunk mode · quick lane · Jest-JSON · fork dispatch · native panel (BT-13) · non-git repos · hotfix flow · GitHub PRs as a target · release compare links · in-process teammates · remote-host `tool.check` mirror.

---

## 16. Risks and open questions

### 16.1 Assumptions that block or shape v1
A4, A7–A9, A17 and A21 were retired in earlier revisions when the mechanisms they assumed were removed or became **V** in the catalog; numbers are not reused. The v2.1 text isn't kept in this repo (no git history), so their wording isn't reproduced here. **S29** (link-click / queued-Enter origins) isn't in M0: it can't block, because a link click is `composer` but the model never sees a live `code8` (any code echoed in the transcript is already burned), and a queued Enter after an amendment mismatches the token; it runs live in M2a.
| # | Assumption | If false | Smoke |
|---|---|---|---|
| A1 | Per-hook `host($)` passes the scan | Inline `$` use into `register.ts` | S20 |
| A2 | `cwd` rewrite to an out-of-repo worktree is honoured (AG-10 **V**) | `maxParallel:1`, worktree under the repo | S15 |
| A3 | The model can't produce a composer origin (PC-04 **V**) | Deny main's `Skill` naming cadre | S16 |
| A5 | `agent.spawn` `agentId` == later event ids | Fence breaks: stop and re-evaluate | S1 |
| A6 | bd latency allows spawn-time `ready` + claim | Raise timeouts; `bd serve` (beads §4.1 B) | S18 |
| A10 | `denyWrite` repo + `allowWrite <wtRoot>/<repoKey>` work for subagent Bash | Degraded: L1 + every-call L3 | S23, S24 |
| A11 | `tool.check` allow avoids prompts for background owners | `permissionMode:'acceptEdits'` + fence | S26 |
| A12 | `$.settings.read()` reflects effective sandbox settings | "containment unknown" = degraded | S28 |
| A13 | Chain order = registration order; drained resumes stay visible; a resumed agent's notification turn reaches #1 | Band `resume queued — send any prompt`; the human's next prompt drains | S31 |
| A14 | `turn.step` gives per-agent usage | Context from `$.session.messages`; cost/cache-% omitted | S32 |
| A15 | The journal records `actor`; compaction detectable | Heal-only sync | S30 |
| A16 | Task* `{result}` accepts string ids + `context`; env flag enables Task* mid-session | Integer ids mapped in `$.state` / restart; rules in main's context | S13, S34 |
| A18 | Background notifications can be rewritten | Card only in main's context line | S40 |
| A19 | `bwrap --tmp-overlay` and `--unshare-net` available | Throwaway worktree per check; network stance unenforced for checks (documented) | S42 |
| A20 | `!` commands raise no `tool.call` | Document advisory mode for shell-heavy human sessions | S37 |
| A22 | The normalized per-tool input path covers every tester file access | **Plan B** (§3.5), ADR 0004 | S45 |
| A23 | Protected-ref `denyWrite` holds without breaking task commits | Drop ref entries; L3 restore only | S24 |
| A24 | A `$HOME` overlay upper dir shows what `setup` wrote | The human adds cache dirs in diff 2 | S46 |
| A25 | A `$.prompt.submit` turn from #1 is seen by guards, observer and drain | Guards blind → drive disabled (fail closed); only #1 blind → one driven turn per human prompt + band fallback | S47 |
| A26 | Seeded eval fixtures run under `plugin eval` with our MCP grant | Evals deferred; kit + live smoke carry M3–M5 acceptance | S41 |
| A27 | A restored `/goal` is detectable | README warning + one-time band hint after `/resume` while drive is on | S48 |
| A28 | Per-agent TTL via plugin agent files (`experimental.cacheTtl`) | 5 min TTL + TTL-aware scheduling; global `subagentPromptCacheTtl` only if S44 pays for all subagents | S43 |
| A29 | `session.compact` answered `{messages}` without `next` stands as the summary | `next({...e, instructions})` + one-time card via the marker path | S49 |
| A30 | beads lease visible in `bd show`; `--if-revision` CAS on metadata | Leases as `{session,until}` metadata with read-check-write-reread; idempotency covers races | S50 |

### 16.2 Accepted risks
User-tier enforcement is switchable (C6, TP-28); L2 survives. L3 attribution under concurrency is best-effort. A queued resume can wait for the next `turn.complete` (G6), surfaced on the band. The spec view leaks whatever docs, fixtures and stubs contain (configured intent). Discovery can propose weak checks (the human reads diff 2). beads leases are node-local: two **machines** coordinate only through status/assignee and Dolt sync latency, and branches don't travel (`lost-wip` recovery). Adapter processes run with the user's rights; that is why their command and grants are user-level S keys. Native schema drift on a version bump re-runs the native goldens, S34, S39, S40.

### 16.3 Open questions (each has a default the design uses; max 8)
Q1, Q5 and Q8 were decided by the user on 2026-10-10 (defaults accepted). Settled design defaults (no longer open): an empty `[Unreleased]` refuses `/cadre release`; the `/clear` hint fires at 40 % when an epic lands.
- **Q1** ✅ *DECIDED by user 2026-10-10: default accepted.* Approval under `-p`/SDK/CI. *Default:* refuse; `allowSdk` (user-level) accepts `sdk` origin with `plan@code8`.
- **Q2** Breaking change in 0.x. *Default:* minor bump; `feat` minor, others patch; explicit `x.y.z` allowed.
- **Q3** Rework cap. *Default:* `review.maxRework: 3`; later cycles count as non-progress for drive and show on the band; no automatic block.
- **Q4** Protected ref moved during an agent window. *Default:* flag + offer `restore` or `keep`; never automatic.
- **Q5** ✅ *DECIDED by user 2026-10-10: default accepted.* Tests that call existing APIs not in the contract. *Default:* the plan lists them in the contract as `status:unchanged`; `tdd.stubs` is the opt-in alternative.
- **Q6** Spec-test `<error>` for a non-`new` missing symbol without a skeleton. *Default:* refused as a setup error; fix the test or amend the contract.
- **Q7** `strictAllowlist` for worker shells. *Default:* offered as an optional user-settings hunk in init stage 5 (repo settings can't set it); `contained ✓` doesn't require it; without it an unlisted host prompts the human.
- **Q8** ✅ *DECIDED by user 2026-10-10: default accepted.* Sync conflict policy. *Default:* workflow fields push-only; human fields pulled and flagged `edited`; both-sides → beads wins + remote comment + flag; remote status → drift flag + strict refusal.
