# cadre: in-terminal UI design (v1)

> Companion to `design/DESIGN.md` (v2.4). Scope: everything cadre **draws, toasts, notifies or prefills** inside Claude Code **2.1.295**. Status: design, nothing built. Visual reference: the approved artifact (https://claude.ai/artifact/61w6i2iesCzzBwJ6KQfXxc, section "01 · replay"; logic in `design/artifact/replay.js`). The CLI mirrors it.
> Cite keys follow DESIGN.md: catalog IDs (`UI-04`, `PC-16`, …) → `claude-mods/docs/catalog/<domain>.md#<id>`; `C3` → `claude-mods/docs/conditions.md`; `U1`, `F4`, … → `claude-mods/docs/pitfalls.md`; `d.ts:<n>` → `claude-mods/refs/claude-code-2.1.295/claude-code.d.ts-786ac4b5.txt`.
> Labels: **V** = VERIFIED in the 2.1.295 types/docs (via the catalog) · **I** = INFERRED · every runtime claim stays UNTESTED until its smoke test (§10.2) passes.
> **The UI is a client.** It reads only the cadre **read model** and **domain events** and sends only **commands** (DESIGN "Extension boundary"). It has its **own LOC budget**, separate from core's 5,000 cap (§9).

---

## 0. Summary
| | |
|---|---|
| **Primary view** | The **Epic view**: a live DAG of the epic's tasks with the `epic → dev → main` rail, the selected node's detail, a 6-row latest-first log, and timeline swimlanes with a now-cursor, all in one pane (§6.2). Nodes re-tag, re-glyph and re-strip as the read model changes; edges go live when the upstream is done |
| **Always visible** | The band: one status line plus a **mini-DAG strip** (`✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done`) that echoes the DAG (§6.1) |
| **Replay** | A mode of the same view: `h`/`l` move the cursor, the DAG re-colours from the event ring, and the header reads `[REPLAY t-12m]` with actions off. `e` returns to live. **v1**, because it costs ≈25 LOC once both views render from the ring (§5.5) |
| **Calm** | No plan → nothing drawn. Attention climbs band ⚑ → toast → OS notify only when a human is needed (§4) |
| **Zero tokens** | Everything the UI draws is local display. Only core's deliberate injections reach the model (§1.2) |
| **Human-only actions** | Buttons only **prefill** `/cadre …` (`$.prompt.fill`, PC-16 **V**); the human presses Enter, which gives `origin.kind==='composer'` (PC-04 **V**) |
| **Budget** | v1 ≈ **730 LOC**, cap **750**; full UI cap 1,500 (§9) |

---

## 1. Design principles

### 1.1 The rules
| # | Principle | Consequence |
|---|---|---|
| D1 | **Calm by default; attention only when the human is needed** | Four levels (§4). Verdicts, check failures, stale agents and queued resumes stay silent or band-only: the loop handles them |
| D2 | **The UI never consumes model tokens** | Long content goes to the pane or `$.ui.log`, **never** to a command `{text}` (model-visible **I**, §1.2) |
| D3 | **Need-to-know for the human too** | Band = counts, strip and the single next human action. Detail is one key away. Raw transcripts, diffs and logs appear only as paths |
| D4 | **Color is never the only signal** | Word tag + glyph + shape: `[ATTN]` `[CRIT]` `[WARN]` `[RUN]` `[OK]` `[READY]` `[WAIT]` `[IDLE]`, `● ◉ ○` strips, `━ ─ ┄` edges, `█ ▒ ░` spans, `. o * !` levels (legend §6.0) |
| D5 | **Works on narrow terminals** | Layout keyed to `e.props.bodyColumns` (UI-02, UI-04 **V**): Epic view wide ≥116, stacked below; band ≥100 / 50–99 / <50 |
| D6 | **Human-only actions are never performed by UI code** | Approve, reject, resolve, release and `drive on` happen only via composer `/cadre …` (CC-07, PC-04 **V**). No `$.ui.ask`/AskUserQuestion for gates (UI-30, BT-17 **V**) |
| D7 | **Secrets never sit in model-visible or forwarded places** | `code8` and the init code appear only on the band, in the pane and in a prefill. Never in command text/`context`, Task* output, `$.ui.notify` (forwarded to the user's `Notification` hooks, d.ts:2451 **V**), or the public read model (§2.3) |
| D8 | **Read model in, commands out; render is pure** | Render reads `$.state` atoms only, never bd, git or `$.process` (§8) |
| D9 | **Never open anything unasked** | The pane opens only from a command or a press (works at any width, UI-02 **V**); unasked needs ≥144 cols (U2 **V**) |
| D10 | **Coexist** | Band = `<Box column>{mine}{await next(e)}</Box>`, yields to `hasSurvey` (UI-04, U5 **V**). No `holdToasts` on the persistent pane (U4). Every `ui.render` hook matches `component` (+`requestId`) (U7) |

### 1.2 What reaches the model
**Rule:** UI output is local display and costs zero tokens, so no stripping is needed. The only model-visible cadre text is what core injects on purpose (`prompt.submit` context, result cards in tool results, Task* answers, command `{text}`/`context`). That text belongs to **core's** token budget (DESIGN §1.4, §7).

| Surface | Model-visible? | Evidence |
|---|---|---|
| Band, Pane (incl. the Epic DAG, timeline `Raster`, `Svg`), Spinner, PromptHint, SessionMode | **No**: render trees are drawing only | UI-01, UI-35 **V**; "every rewrite is display-only" (UI-05/06 **V**). Absence from the stored transcript is **I** → S-UI1 |
| Restyled `ToolUse`/`ToolResult`/`UserMessage` rows | **No** (the model reads the stored row) | UI-05, UI-06, UI-P11 **V** |
| `$.ui.toast` | **No**: "It leaves the transcript and the model untouched" | d.ts:2431-2446, UI-26 **V** |
| `$.ui.log` | **No**: "not sent to the model"; "a dim line … that Claude doesn't read" | d.ts:2398-2413, `mods-api.md:132`, UI-28 **V** |
| `$.ui.status` · `$.ui.notice` | **No** (pinned line / dialog decoration) | UI-27, UI-12 **V** surface; non-visibility **I** → S-UI1 |
| `$.ui.notify` | **No**, but it is forwarded to the user's `Notification` hooks | d.ts:2448-2464 **V** → D7 |
| `$.prompt.fill` draft | **No** until Enter | PC-16 **V** |
| `/cadre …` echo (`args`) | **Yes (I)**: d.ts:10045. Plugin commands can't mark args sensitive (d.ts:1885-1910 **V**) | → burn-on-use nonce (§5.2) |
| Command `{text}` | **Yes (I)**: "the command's output as a transcript line" (d.ts:1836-1845); `context` is model-only (CC-03 **V**) | core budget, one line (D2) |
| Result card in the Agent result / task notification | **Yes, by design** | DESIGN §6.4, core budget |

---

## 2. Information architecture

### 2.1 Visibility tiers
| Tier | What | Where |
|---|---|---|
| **Always** (plan exists) | plan + state, strictness, containment, drive, mini-DAG strip + counts, main ctx %, cache %, sync when not ✓ | Band |
| **On demand** | live DAG, rail, node detail, log, timeline, replay; approval sheet; later task, sync, cost, release, init | `cadre` pane: Epic (default), Plan, … |
| **On attention only** | approval, blocked question, flag to resolve, quarantine, integration failed, drive paused/finished, release proposed, sync conflict/offline, Task tools missing, containment degraded, `/goal` conflict | Band ⚑ + toast (+ OS notify, §4) |
| **Never** | raw transcripts, diffs, check logs, test output (paths only); secrets/env values; codes in model-visible or forwarded places (D7); in an agent-view band (`view.agentId`, UI-34), other tasks' content | — |

### 2.2 Read model consumed (`CadreView`)
Core projects `CadreView` into `$.state` atom `cadre.board` after each committed transition (DESIGN §2.1 `task.transitioned`) and appends to the ring atom `cadre.events`. The UI reads both (UI-24 **V**) and keeps its own `cadre.ui` atom (tab, selection, cursor, acks, dedupe), written only from handlers (U3, UI-P3 **V**). **NEW** marks what core must add for the Epic view (summary in §11).

| Field | Shape (abridged) | Source |
|---|---|---|
| `schemaVersion`, `seq` | `1`, last applied event seq | §6.7 |
| `mode` | `{strictness, containment, unsandboxed, store, taskTools, goalConflict}` | §12, §13.1, §5.1, §9 |
| `plan` | `{id, slug, state, epicBranch, approvedAt` **NEW**`, landed?{dev, sha, at}, released?{version, at}}` | §3.1, §3.9 |
| `sheet` | per task `{id, title, type, scope?, breaking?, package, tdd, changelog, scenarios[], contract}` | §3.1 |
| `tasks[]` | `{id, title, type, kind:'code'\|'docs'\|'spike'` **NEW**`, merges:boolean` **NEW**`, category, phase, owner?, deps[{id, type:'blocks'\|'waits-for'\|'conditional-blocks'}]` **NEW** (typed)`, condition?{on, state:'pending'\|'met'\|'not-met'}` **NEW**`, flags[], red?, green?, verdict?, checkpoint?, lastCard?, phaseSince` **NEW**`, cost}` | §3.2–3.5, §6, §7 |
| `frontier` | `{ready[], running[], review[], blocked[], flagged[]}` | §3.3 |
| `agents[]` | `{agentId, taskId, role, phase, state, ctxPct, startedAt}` | §4.4 |
| `resumeQueue`, `sync[]`, `drive`, `cost`, `release`, `init` | as in DESIGN | §4.4, §11.4, §9, §7, §3.9, §10 |
| `attention[]` | derived `{key, kind, subject, since, command}` (no secrets) | core |

**Event envelope** (every event in `cadre.events`): `{seq, at, kind, taskId?, actor` **NEW** `('human'|'main'|'tester'|'worker'|'reviewer'|'explorer'|'sync'|'mod'), agentId?, severity` **NEW** `('info'|'warn'|'crit'), needsHuman` **NEW** `(boolean), data}`. The attention **level** (silent/band/toast/notify) stays a **UI** policy (§4), computed from `kind + severity + needsHuman`, so replay re-derives it identically.

**Ring:** **500 events per epic** (≈60 KB), up from 200. A 7-task epic emits ≈25 events per task plus sync/attention ≈ 225, so 200 would truncate replay mid-epic; 500 covers the DESIGN ceiling (≈1–7 tasks, §3.11) with 2× slack. `$.state` resets on `/clear` (UI-24), so on rehydrate core rebuilds the ring from beads canonical records (`at`-stamped, DESIGN §6.5) **NEW**.

### 2.3 The secret channel
`code8` and the init confirm code are kept out of `CadreView` and events, because other extensions may read those. Core writes them to a UI-private atom `cadre.secret = {approval?:{planId, code8}, initConfirm?}`.

### 2.4 Element → read model / events
| UI element | Reads | Redraws on |
|---|---|---|
| Band line 1 + ⚑ row | `plan`, `mode`, `drive`, `cost`, `sync`, `attention[0]`, `cadre.secret` | `cadre.board` version |
| Band mini-DAG strip | `tasks[].{id, phase, deps, condition}` → depth order | `task.phase_changed`, `task.closed`, `task.flagged` |
| **Epic: DAG nodes** | `tasks[]` (phase → tag, glyph, strip; `kind` → step set) | `task.*` (live) / ring fold at cursor (replay) |
| **Epic: edges** | `tasks[].deps` typed + upstream done | same |
| **Epic: rail** | `plan.epicBranch`, `plan.landed`, `plan.released` | `plan.approved`, `epic.integrated`, `release.cut` |
| **Epic: detail** | selected task + owner (`agents[]`) + `condition` | same |
| **Epic: log (6)** | `cadre.events` latest ≤ cursor, level via §4 | ring append |
| **Epic: timeline** | spans from `agent.bound`/`agent.unbound` (lane = actor + slot) + phase events; outages from `sync.state_changed`; markers from events | ring append; cursor move (blit only) |
| Plan tab | `sheet`, `plan`, `cadre.secret.approval` | `plan.*` |
| Toast / notify / status line | event stream + §4 policy | §4 events |
| Result-card row | `cadre.ui.cards[tool_use_id] → taskId` + `tasks[].lastCard` | `task.reported` |
| Resume banner | `session.rehydrated` | once |

**Events consumed:** `plan.drafted · plan.approval_requested · plan.approved · plan.rejected · plan.amended · task.claimed · task.phase_changed · task.reported · task.check_failed · task.verdict · task.closed · task.blocked · task.question_asked · task.flagged · task.flag_resolved · task.skipped` **NEW** `· effect.quarantined · agent.bound · agent.unbound` **NEW** `· agent.stale · agent.resume_queued · agent.resumed · sync.batch_finished · sync.state_changed · drive.state_changed · epic.integrated · epic.integration_failed · release.proposed · release.cut · cost.threshold_crossed · context.clear_hint · session.rehydrated · init.stage_changed · containment.checked`.

---

## 3. Surface map
| cadre need | Site / API | Why | v1? |
|---|---|---|---|
| At-a-glance status + mini-DAG + next human action | **Band** `AbovePrompt` (UI-04 **V**) | always in view; composable; engine collapse/scroll; T+Dk | **v1** |
| **Epic view**: live DAG + rail + detail + log | **Pane** `cadre`, default tab (UI-02 **V**); nodes = Box + plain `Button` id line (Enter/Up/Down via engine focus, `mods-interface.md` keys **V**) + `Text` | room for the picture; docks ≥110 fullscreen, inline otherwise | **v1** |
| Timeline swimlanes | **`Raster`** leaf in the pane (UI-21 **V**; d.ts RasterProps: ≤512×256 cells, each `[codePoint, fg, bg]`, width-1 BMP incl. blocks/box drawing) | one leaf instead of ~800 `Text` runs ("draw grids as one Raster, never a Box per cell", UI-21); per-cell glyph = pattern, not just color; cursor moves repaint via `$.ui.blit` with no re-render (UI-21 **V**). Block-char `Text` was rejected: one Text per color run per row is heavier and slower | **v1** (terminal) |
| DAG + timeline on Desktop | **`Svg`** (UI-21 **V**: desktop/vscode/mobile, ≤131,072 chars, `alt` required) | Raster is "terminal only; elsewhere a fragment" (d.ts) → desktop v1 shows DAG + log, timeline hidden with a note | later |
| Plan tab = approval sheet | Pane tab; `Code format="diff"` for signatures (UI-22 **V**) | long, scrollable, zero tokens | **v1** |
| Transient news / escalation / attention line | `$.ui.toast` (UI-26) / `$.ui.notify` (UI-29, terminal only) / `$.ui.status` (UI-27) | §4 | **v1** |
| Result card | `ToolUse {tool:'Agent'}` (UI-06 **V**); later `UserMessage {origin.kind:'task-notification'}` (UI-05) | compact glyphed row; engine row while `isRunning` | **v1** (ToolUse) |
| Fallback where nothing draws | `$.ui.log` (UI-28 **V**) | not model-visible; SDK hosts get `ui_log` | **v1** |
| `report`/Task*/`inspect` rows, Spinner suffix, PromptHint tail, SessionMode `drive`, AskUserQuestion header | UI-06, UI-09, UI-10, UI-08 | polish | later |
| InfoNotice · permission notice · sound | — · UI-12 · UI-32 (macOS `{asset}`) | not needed · not needed · opt-in | — · — · later |

---

## 4. Notification policy

### 4.1 Levels
| Level | Mechanism | Timeline/log mark |
|---|---|---|
| **L0 silent** | pane + log only | `.` |
| **L1 band** | band cell/glyph, strip | `o` |
| **L2 toast** | `$.ui.toast(text,{timeoutMs:6000})` + band ⚑ + status line | `*` |
| **L3 OS notify** | `$.ui.notify(minimal,{title:'cadre'})`; `{isSent:false}` → toast (UI-29 **V**) | `!` |

**Present vs away:** 2.1.295 has no focus or idle signal (**I**). An item is **acked** by a composer `prompt.submit`, any `/cadre`, a cadre press, or the pane being `isFocused`. If an item is still unacked after `ui.escalateAfterMs` (120 s), it goes to L3 once.

### 4.2 Matrix
| Event | Level | → L3? | Text (no secrets, D7) | Dedupe key |
|---|---|---|---|---|
| Approval needed | L2 | yes | `Plan p3 ready for approval · 7 tasks · press 1` | `approve:<plan>:<rev>` |
| Blocked question | L2 | yes | `bd-a6 blocked: worker has a question` | `q:<task>:<hash>` |
| Verdict pass / changes | L1 | no | — | — |
| Check failed | L0→L1 `✗`; the 3rd failure becomes blocked (L2) | no | — | — |
| Effect-check quarantine | L2 | if it opens `git:*` | `Quarantined 2 paths from bd-a6 → refs/cadre/quarantine/… · /cadre restore` | `q:<ref>` |
| Flag needing resolve | L2 | yes | `bd-a7 flagged drift:pm:status · press 1` | `flag:<task>:<kind>` |
| Sync batch, no conflict / with conflicts | L0 / L2 | no | `Synced 5 tasks · 1 conflict (bd-a3 title)` | `sync:<t>:<batch>` |
| Sync offline / reconnected | L1 + L2 once / L2 if offline >60 s | no | `pm offline · retrying (2 pending)` / `pm reconnected · synced 6` | `off:<t>` |
| Drive paused / finished | L2 | **immediate** when drive was on | `Drive paused: approve p4` / `Epic p3 landed on dev ✓` | `drive:<reason>` / `done:<epic>` |
| Integration failed | L2 | yes | `Epic p3 integration failed · main is planning fixes` | `int:<epic>:<sha>` |
| Release proposed | L1 + L2 once | no | `Release proposed: v1.4.0` | `rel:<v>` |
| Cost threshold / `/clear` hint | L2 once per crossing | no | `Drive at 80 % of token budget` | `cost:<kind>:<epic>` |
| Stale agent · resume queued | L1 | no | — | — |
| Containment degraded · Task tools missing | L2 once per session | no | `Containment degraded · run /cadre init` | `mode:<kind>` |
| Init needs confirm | L2 | no | `Init diff ready · /cadre open init` | `init:<stage>` |

### 4.3 Rates
- Same key → one toast while the item is open.
- ≤1 toast per 8 s; toasts raised inside that window merge (`3 updates: …`).
- OS notify ≤1 per item, ≤3 per 15 min, never while the pane is focused, off with `ui.notify:'off'`.
- The status line shows only the top attention item and is cleared when none remain.
- toast/notify are `void …catch()`, never awaited in a gating hook. Escalation runs on `$.clock.after` (timer calls skip our hooks, G6 **V**, which is harmless here).

---

## 5. Interaction design

### 5.1 Keys (no Tab/arrows/Esc bindings, UI-15 **V**; hotkeys = one digit or one lowercase letter, UI-14 **V**)
| Where | Key | Action |
|---|---|---|
| Band, **empty composer** | `1` | act on the top ⚑ item (open its view). Armed **only while attention exists** (Q1) |
| Band, focused (ctrl+x tab / click) | `d` | open the Epic view |
| Pane | `1` Epic · `2` Task · `3` Sync · `4` Cost · `7` Plan | tabs (v1: Epic, Plan) |
| Epic | Up/Down + Enter · `n`/`p` · `g` | select a node (engine focus ring over node Buttons) · next/prev node in depth order · go to id (`Input`, UI-16) |
| Epic | `h`/`l` · `b`/`f` · `e` | cursor −/+ one step (1 column) · prev/next attention event (level ≥ toast) · back to **live** |
| Epic | `t` | collapse/expand the timeline |
| Plan / flag / release / init views | `a` `x` `r` `k` `s` `c` | prefill approve · reject · resolve/restore · keep · release · init confirm (§5.2) |
| Pane | PgUp/PgDn/Home/End · ctrl+x x / Esc | scroll · close / focus back (engine) |

**`[ ] { } .` are not possible:** hotkeys accept only one digit or one lowercase letter (UI-14 **V**). A `Client` module could read raw keys (UI-20 **V**: arrows arrive there, Escape never does), but it has no `$`, needs a post round-trip and adds ≈60 LOC → later, only if the letters prove awkward.

**`/cadre`:** `open [epic|plan|task <id>|sync|cost|release|init]` (`immediate:true`, CC-02 **V**) · `approve <plan>` without a token → opens Plan; the command text is one line · `status` (text board, no secrets, C3 fallback).

### 5.2 Human-only actions: prefill, never perform
**Threats.** Other mods can intercept our presses (UI-17 **V**). AskUserQuestion can be auto-answered (BT-17 **V**). A transcript-link click is composer origin (d.ts:8866-8869 **V**), so a model that knew `code8` could build a clickable approval.
1. A button only calls:
   ```ts
   const { text } = await $.prompt.read()                       // PC-17 V
   if (text.trim()) return $.ui.toast('cadre: composer not empty: clear it, then press again')
   const r = await $.prompt.fill({ text: cmd, mode: 'replace' }) // PC-16 V: draft only
   if (!r.isFilled) $.ui.toast(`cadre: type ${cmd}`)
   ```
   This runs in `$.clock.after(1, …)` (UI-14, UI-P9).
2. The human presses Enter → `command.run` checks composer origin + token (DESIGN §3.1).
3. **Burn on use:** every `approve …@code` / `init confirm <code>` attempt draws a new nonce, so the echoed code is dead on arrival (§1.2 **I**).
4. Other mods can see and rewrite the draft via `prompt.fill` hooks (PC-16 **V**). Accepted at user-tier trust (DESIGN §1.2, C6). A rewritten draft fails the token check.
5. In **replay** every prefill button is disabled (the header shows `actions off`).

| Action | Prefill | From |
|---|---|---|
| approve / reject | `/cadre approve p3@ab12cd34` / `/cadre reject p3 ` | Plan (`a`/`x`); band `1` opens Plan first |
| resolve / git | `/cadre resolve bd-a7 keep\|accept\|reject\|cancel` / `/cadre resolve git restore\|keep` | flag view |
| release · drive · init | `/cadre release 1.4.0` · `/cadre drive on` · `/cadre init confirm <code>` | release view · band ⚑ · init view |

### 5.3 Approval sheet (Plan tab)
Order: summary → per task: header · scenarios · contract (`NEW`/`CHANGED`/`same`, before→after as `Code format="diff"`, UI-22 **V**) · changelog · tdd. Paginate per task over 40 KB (tree cap 100k chars, UI-01 **V**). Wide = two columns, narrow = stacked. On amendment while open: banner + new code (§6.6).

### 5.4 Flags and conflicts
One view per flag: what changed (field, both values, who/when), who won by default, and options with consequences (§6.9). drift → `keep`/`accept`/`cancel`; edited → informational; conflict → beads won, `accept` re-applies the remote value; `git:<branch>[:agent]` → `restore` (tip → `refs/cadre/quarantine/…`, CAS back) or `keep`, merges blocked until resolved; spec_change → `accept` re-runs red / `reject`; quarantine → `/cadre restore <ref>`. In v1 these come from the band ⚑ plus a prefill; the dedicated view is later.

### 5.5 Epic view behaviour
| Aspect | Rule |
|---|---|
| Default | The pane opens on **Epic**. "Board" is renamed because the view is one epic's DAG, not a lane board. The old READY/RUNNING lane board is **dropped**: its narrow role goes to the depth-grouped list (§6.2 narrow) |
| Layout | `bodyColumns ≥116`: DAG + rail left (80 cols), detail + log right (33), timeline below. Otherwise stacked: depth list, rail line, detail, log, timeline at 2 min/col. Request `columns:120` on open (a request; the person's drag wins, UI-02 **V**) |
| Collapse | `scroll.bodyRows` < 34 → timeline collapses to its header (`t` expands); < 22 → log collapses to 2 rows. Tree >`maxRows` scrolls (engine) |
| DAG layout | column = dependency depth (longest path from a root); row = order within depth (plan order); edges route in the 5-col gutter. Edge style by `deps[].type` + upstream done (§6.0) |
| Live update | Redraw on `cadre.board`/`cadre.events` change (UI-23 **V**: ≤10/s per site, 30/s for the shown pane; folds faster calls) |
| Change highlight | a node whose phase changed in the last 1.5 s draws a double border `╔═╗` and `» word «` (§6.3). It is armed from the event handler with one `$.clock.after(1500, invalidate)`. Shape, not color. Off with `ui.flash:false` (no reduced-motion signal exists in 2.1.295, **I**), in replay, or when >3 nodes change in one event batch |
| Selection | follows the human's choice (Enter/`n`/`p`/`g`), pinned until `e` or the task closes. Unpinned, it follows the most recently changed running task |
| Replay (v1) | The cursor is a time `t ≤ now`. DAG, detail, rail and log are a **pure fold of the ring up to `t`** (same code as live with `t = now`). The header shows `[REPLAY t-12m]` (warning, inverse); actions are off; future spans draw `╌`. Live events keep arriving and the band stays live. `e` → live. Cost ≈25 LOC (§9) |
| Desktop | same tree; the timeline `Raster` draws nothing there (d.ts) → hidden with "timeline: terminal only (Svg later)" |

---

## 6. Wireframes

All wireframes are generated from the artifact's replay data (`design/artifact/replay.js`, epic p3, 7 tasks) and padded to exactly the width in the heading: monospace, one cell per glyph. `[-]` is the engine's collapse mark (UI-04).


### 6.0 Legend

| Word tag | Glyph | ASCII (`ui.glyphs: ascii`) | Semantic token | Meaning |
|---|---|---|---|---|
| `[ATTN]` | `⚑` | `!` | **warning, bold** | a human is needed |
| `[CRIT]` | `✗` | `x` | **critical** | failed check or integration, quarantine, `git:*` flag, degraded containment |
| `[WARN]` | `⚠` | `~` | **warning** | non-blocking flag, sync offline or conflict, cost threshold |
| `[RUN]` | `▶` | `>` | **accent** | running, in review, drive on |
| `[OK]` | `✓` | `+` | **success** | merged, reported, pass, contained, synced |
| `[READY]` | `○` | `o` | default | claimable |
| `[WAIT]` | `⏸` | `=` | **muted** + word | waits on a dependency, paused |
| `[IDLE]` | `◌` `↻` | `.` `r` | **muted** | skipped (condition not met), stale, resume queued |
| `[LIVE]` / `[REPLAY t-Nm]` | — | — | accent / **warning, inverse** | the Epic view shows now / a past moment; actions are disabled in replay |

| Mark | Where | Meaning (shape carries meaning, color only reinforces) |
|---|---|---|
| `●` `◉` `○` (ASCII `#` `@` `-`) | node pipeline strip | step done · current step · not reached. Code: spec·red·impl·green·review·merged; docs: impl·review·merged; spike: explore·report |
| `━━▶` / `──▶` / `┄┄▷` (ASCII `==>` / `-->` / `..>`) | DAG edges | live `blocks` (upstream done) · pending `blocks` · `conditional-blocks` (runs only if upstream **fails**) |
| `┏━┓` / `╔═╗` + `» word «` | DAG node border | selected node / just-changed node (one highlight frame, §5.5) |
| `█` `▒` `░` `╌` (ASCII `#` `%` `:` `-`) | timeline cells | worker/tester/explorer work · reviewer work · sync offline · future (replay only) |
| `.` `o` `*` `!` | timeline and log | event level: silent · band · toast · notify (ASCII: Raster cells must be width-1 BMP, d.ts RasterProps) |
| `┃` `▼` (ASCII `|` `v`) | timeline | cursor (now, or the replay moment) |

Glyph set: `ui.glyphs: unicode` (default, approved by the user 2026-10-10) or `ascii`, for fonts lacking these glyphs. Use `ascii` if columns misalign: geometric glyphs fall back to another font in some terminals. Word tags are the same in both sets, so meaning never depends on the glyph or color.


### 6.1 Band (always visible): status line plus a mini-DAG strip

The strip is the DAG at a glance: one glyph per task in dependency order (depth, then row), `│` between depths, then counts. **Idle with no plan:** the band draws nothing.


#### Wireframe: Band, working (120 cols)
```text
[RUN] cadre · p3 auth-login · strict · contained ✓ · drive ▶ 12/100 · ctx 34% · cache 87% · pm ✓                     [-]
  ✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done · ▶1 ⏸1 ◌1   ↻1                                                            
```

#### Wireframe: Band, attention (approval) (120 cols)
```text
[ATTN] ⚑ NEEDS YOU · approve plan p3 · 7 tasks · 12 scenarios · 3 new / 2 changed symbols   1: open sheet            [-]
  type  /cadre approve p3@ab12cd34   (or press 1, then a)                                d: Epic view                   
[WAIT] cadre · p3 · drive ⏸ approval · ctx 34% · cache 87%                                                              
```

#### Wireframe: Band, attention (critical flag) (120 cols)
```text
[ATTN] ⚑ NEEDS YOU · [CRIT] ✗ git:dev:agent · dev moved outside a cadre merge · merges blocked   1: open             [-]
  ✓a1 ✓a4 ✓a7 │ ✓a2 ✓a3 │ ✗a6 ◌a5   5/7 done · ▶0 ⏸0 ◌1                                                                 
```

#### Wireframe: Band, epic landed (120 cols)
```text
[OK] cadre · p3 auth-login · done-on-dev ✓ · ✓✓✓│✓✓│✓◌ 7 tasks · ctx 41% · cache 88% · [WARN] release? v1.4.0        [-]
```

#### Wireframe: Band, working (narrow) (60 cols)
```text
[RUN] p3 ✓✓✓│▶✓│⏸◌ 4/7 ▶1 ⏸1 · ctx34%                    [-]
```

#### Wireframe: Band, attention (narrow) (60 cols)
```text
[ATTN] ⚑ approve p3 (7 tasks)         1: open sheet      [-]
  /cadre approve p3@ab12cd34                                
[WAIT] p3 ○○○│○○│⏸○ 0/7 · drive ⏸                           
```

Over-long strips truncate from the done end: `+3✓ ▶a9 ▶a10 ⏸a11 …`. Under 50 columns only line 1 is drawn.


### 6.2 Epic view (primary pane, v1)

Wide layout (pane `bodyColumns` ≥ 116): DAG and rail on the left; selected-node detail and the 6-row log on the right; the timeline across the bottom. One screen, like the artifact's "01 · replay".


#### Wireframe: Epic view, live, wide (120 cols)
```text
┌ cadre ───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1: Epic⚑  2: Task  3: Sync  4: Cost  7: Plan  ·  p3 · epic/p3-auth-login · 4/7 done · ▶1 ⏸1 ◌1 · [LIVE] 62m          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────┐     ┏━━━━━━━━━━━━━━━━┓     ┌────────────────┐  ╭────────────╮ │ SELECTED  a2 · feat   [RUN] ▶     │
│ │a1 feat    [OK]✓│     ┃a2 feat   [RUN]▶┃     │a6 feat  [WAIT]⏸│  │  epic/p3   │ │ Session refresh                   │
│ │Add login       │━━┳━▶┃Session refresh ┃──┬─▶│Remember me     │  │   [RUN]▶   │ │ spec● red● impl◉ green○           │
│ │●●●●●● merged   │  ┃  ┃●●◉○○○ implement┃  ┃  │○○○○○○ waits a2 │  ╰────────────╯ │ review○ merged○   (rework)        │
│ └────────────────┘  ┃  ┗━━━━━━━━━━━━━━━━┛  ┃  └────────────────┘         │       │ after a1 [OK] ━ live edge         │
│                     ┃                      ┃                             ▼       │ unblocks a6 (with a3)             │
│ ┌────────────────┐  ┃  ┌────────────────┐  ┃  ┌────────────────┐  ╭────────────╮ │ worker 1 · 23m · ctx 41%          │
│ │a4 docs    [OK]✓│  ┃  │a3 fix     [OK]✓│  ┃  │a5 fix   [IDLE]◌│  │    dev     │ │ ───────────────────────────────── │
│ │README auth     │  ┗━▶│Token clock skew│━━┻┄▷│Rate-limit fall…│  │  [WAIT]⏸   │ │ LOG  latest first                 │
│ │●●● merged      │     │●●●●●● merged   │     │○○○○○○ skipped  │  ╰────────────╯ │ 58m o rev a2 changes → resumed    │
│ └────────────────┘     └────────────────┘     └────────────────┘         │       │ 54m * syn pm back · 1 conflict    │
│                                                                          ▼       │ 53m o rev a3 pass · merged        │
│ ┌────────────────┐                                                ╭────────────╮ │ 40m * syn pm offline · 2 pending  │
│ │a7 spike   [OK]✓│                                                │main v1.4.0 │ │ 31m o rev a1 pass · fan-out a2 a3 │
│ │Spike: passkeys │                                                │  [WAIT]⏸   │ │ 24m o w1  a1 green ✓ · test 41s   │
│ │●● reported     │                                                ╰────────────╯ │                                   │
│ └────────────────┘                                                               │                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIMELINE  [LIVE] now 62m · █ work ▒ review ░ offline · . silent o band * toast ! notify · t: hide                    │
│          0m        10m       20m       30m       40m       50m       60▼       70m       80m       90m               │
│ human     *o                                                           ┃                                             │
│ main                                                                   ┃                                             │
│ tester      ██████o                      ████████                      ┃                                             │
│ worker 1            █████████████o              █████████████      █████                                             │
│ worker 2      █████████                          ██████                ┃                                             │
│ reviewer               ▒▒▒▒o       ▒▒▒▒▒o                ▒▒▒▒▒o▒▒▒▒o   ┃                                             │
│ explorer       ██████████o                                             ┃                                             │
│ sync                                             *░░░░░░░░░░░░░*       ┃                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Enter/n/p: select node · h/l: time ±1 step · b/f: prev/next attention event · e: live · t: timeline · g: go to id    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Narrow layout (`bodyColumns` < 116, or inline above the prompt): stacked. The DAG becomes a list grouped by dependency depth (this replaces the old READY/RUNNING lane board). Shown in **replay** at t-12m: the cursor is at 50 min, so a3 is in review, a2 is implementing, sync is offline, and future spans show as `╌`.


#### Wireframe: Epic view, replay t-12m, stacked (60 cols)
```text
┌ cadre ───────────────────────────────────────────────────┐
│ 1:Epic⚑ 2:Task 7:Plan    [REPLAY t-12m] at 50m · e: live │
│ p3 · 3/7 done · ▶2 ⏸2 ◌0  (actions off)                  │
├──────────────────────────────────────────────────────────┤
│ DEPTH 0                                                  │
│ ✓ a1 feat  Add login       ●●●●●● [OK] merged            │
│ ✓ a4 docs  README auth     ●●●    [OK] merged            │
│ ✓ a7 spike Spike: passkeys ●●     [OK] reported          │
│ DEPTH 1  after a1 ━ live                                 │
│ ▶ a2 feat  Session refresh ●●◉○○○ [RUN] implement        │
│ ▶ a3 fix   Token clock sk… ●●●●◉○ [RUN] review           │
│ DEPTH 2                                                  │
│ ⏸ a6 feat  Remember me     ○○○○○○ [WAIT] waits a2 a3     │
│ ⏸ a5 fix   Rate-limit fal… ○○○○○○ [WAIT] if a3 fails     │
│ rail  epic/p3 [RUN]▶ → dev [WAIT]⏸ → main [WAIT]⏸        │
├──────────────────────────────────────────────────────────┤
│ SEL a3 fix · Token clock skew · [RUN] ▶ review           │
│ spec● red● impl● green● review◉ merged○                  │
│ after a1 [OK] · a5 runs only if a3 fails                 │
├──────────────────────────────────────────────────────────┤
│ LOG                                                      │
│ 40m * syn pm offline · 2 pending                         │
│ 31m o rev a1 pass · fan-out a2 a3                        │
│ 24m o w1  a1 green ✓ · test 41s                          │
│ 18m o rev a4 pass · merged                               │
│ 16m o exp a7 spike report · 4 cites                      │
│  9m o tst a1 red ✓ · 3 failing                           │
├──────────────────────────────────────────────────────────┤
│ TIMELINE  2 min/col · ░ offline · ┃ 50m                  │
│     0m        20m       40m  ▼    60m       80m          │
│ hum *o                       ┃                           │
│ mai                          ┃                           │
│ tst  ███o           ████     ┃         ╌╌╌               │
│ w1       ███████o      ███████   ╌╌╌      ╌╌╌╌╌╌         │
│ w2    █████             ███  ┃                           │
│ rev        ▒▒o   ▒▒o        ▒▒╌╌╌    ╌╌         ╌╌       │
│ exp    █████o                ┃                           │
│ syn                     *░░░░░╌╌                         │
├──────────────────────────────────────────────────────────┤
│ n/p node · h/l time · b/f attention · e live · t hide    │
└──────────────────────────────────────────────────────────┘
```

### 6.3 Node-changed moment

a2 goes green at 52 min. Frame 1: the node redraws with its new tag and strip. Frame 2 (same instant): a double border plus `» green ✓ «`, and the log gains a row. After 1.5 s: normal border. A shape change, not a color flash. Off with `ui.flash:false`, in replay, or when >3 nodes change at once.


#### Wireframe: Node a2 before / flash / settled (60 cols)
```text
before · 51m         flash · 52m          settled · 53m     
┌────────────────┐   ╔════════════════╗   ┌────────────────┐
│a2 feat   [RUN]▶│   ║a2 feat   [RUN]▶║   │a2 feat   [RUN]▶│
│Session refresh │   ║Session refresh ║   │Session refresh │
│●●◉○○○ implement│   ║» green ✓ «     ║   │●●●◉○○ green ✓  │
└────────────────┘   ╚════════════════╝   └────────────────┘
                                                            
log +1:  52m o w1  a2 green ✓ · test 41s                    
```

### 6.4 Selected-node detail strip

#### Wireframe: DAG node detail strip, three cases (120 cols)
```text
┌ cadre · detail ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ a2 · feat · Session refresh                                   [RUN] ▶ implement (rework after review changes at 58m) │
│ pipeline   spec ● ─ red ✓ ● ─ implement ◉ ─ green ○ ─ review ○ ─ merged ○                                            │
│ deps       after a1 [OK] (blocks, live) · unblocks a6 (fan-in with a3)                                               │
│ owner      worker 1 7f2c… · 23m · ctx 41% · checkpoint 3c4d5e6               Enter: Task tab · n/p: next/prev node   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ a7 · spike · Spike: passkeys                                  [OK] ✓ reported                                        │
│ pipeline   explore ● ─ report ●                                                                                      │
│ deps       none · never merges (findings in beads; follow-ups land as drafts in the backlog epic)                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ a5 · fix · Rate-limit fallback                                [IDLE] ◌ skipped                                       │
│ pipeline   spec ○ ─ red ○ ─ implement ○ ─ green ○ ─ review ○ ─ merged ○                                              │
│ deps       runs only if a3 fails (conditional-blocks) · a3 passed at 53m → condition not met, never ran              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.5 Task, Sync and Cost tabs (later)

#### Wireframe: Task tab (120 cols)
```text
┌ cadre · 2: Task ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ bd-a2 · feat(auth) Session refresh · package api · tdd required · phase implement [RUN] ▶                            │
│ owner worker 7f2c… · 12m · ctx 41% · worktree …/cadre/wt/repo-1a2b/bd-a2                                             │
│ red ✓ @9e1f0aa (4 failing: S1 S2 S3 S4) · green — · checkpoint 3c4d5e6                                               │
│ Scenarios  S1 Given an expired token When refresh Then new token issued   (+3)                                       │
│ Contract   refreshSession(token: Token) -> Session ! ExpiredError        NEW                                         │
│ Flags      none          Decisions  D-12 "use sliding expiry" (you, 10:14)                                           │
│ Last card  [CRIT] green ✗ (test 41s: 1 failing S3) · next: rework (auto-resumed)                                     │
│ Logs       .cadre/tmp/logs/bd-a2-test-1696….log                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Sync tab (120 cols)
```text
┌ cadre · 3: Sync ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ target  state           pending  conflicts   last sync   next                                                        │
│ pm      [WARN] ⚠ offline 4        0           10:41:02    retry 30s (backoff)                                        │
│ gh      [OK] ✓ ok        0        1 (a7)      10:42:30    heal 15:00                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Cost tab (120 cols)
```text
┌ cadre · 4: Cost ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ session $3.84 · cache 87% ████████▊░ · main ctx 34% ███▍░░░░░░ · drive 1.21M/2M tok                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TASK  role        in     cache-rd  cache-wr  out    cache%  ≈$     time                                              │
│ a2    worker      41k    312k      22k       9.1k   83%     0.71   12m                                               │
│ a3    reviewer    12k    188k      14k       2.0k   88%     0.29    2m                                               │
│ a1    tester+wk   28k    296k      19k       7.4k   91%     0.52   31m                                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ by role: worker 62% · reviewer 21% · tester 11% · explorer 6%      ≈$ = apportioned (Q4)                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Cost tab, narrow (60 cols)
```text
┌ cadre · Cost ────────────────────────────────────────────┐
│ $3.84 · cache 87% ████████▊░ · ctx 34%                   │
│ a2 worker    83%  ≈$0.71  12m                            │
│ a3 reviewer  88%  ≈$0.29   2m                            │
│ a1 tester+wk 91%  ≈$0.52  31m                            │
└──────────────────────────────────────────────────────────┘
```

### 6.6 Approval sheet (Plan tab, v1)

#### Wireframe: Approval sheet, wide (120 cols)
```text
┌ cadre · 7: Plan [ATTN] ⚑ ────────────────────────────────────────────────────────────────────────────────────────────┐
│ PLAN p3 auth-login · 7 tasks · 12 scenarios · packages api, web · commit types feat×3 fix×2 docs×1 chore×1           │
│ contract: 3 NEW · 2 CHANGED · 4 same · breaking: none · tdd: required×5 none×2                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ bd-a1 · feat(auth) Add login · api · tdd required · changelog Added "Login with email+pw"       task 1/7             │
│ SCENARIOS                                         │ CONTRACT                                                         │
│ S1 Given a registered user When valid login       │ login(email: Email, pw: Secret)                                  │
│    Then a session is returned                     │   -> Session ! AuthError                  NEW                    │
│ S2 Given wrong pw When login Then AuthError       │ Session.expiresAt: Instant                same                   │
│                                                   │ authenticate(req)                     CHANGED                    │
│                                                   │ - authenticate(req: Request) -> User                             │
│                                                   │ + authenticate(req: Request) -> User|null                        │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ATTN] a: load approve command (p3@ab12cd34) · x: load reject command · n/p: task · PgDn: scroll                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Approval sheet, narrow (60 cols)
```text
┌ cadre · Plan [ATTN] ⚑ ───────────────────────────────────┐
│ p3 · 7 tasks · NEW 3 · CHANGED 2 · task 1/7              │
│ bd-a1 feat(auth) Add login · api · tdd req               │
│ changelog: Added "Login with email+pw"                   │
│ S1 Given a registered user When valid login              │
│    Then a session is returned                            │
│ S2 Given wrong pw When login Then AuthError              │
│ NEW login(email: Email, pw: Secret)                      │
│       -> Session ! AuthError                             │
│ CHG authenticate                                         │
│ - (req: Request) -> User                                 │
│ + (req: Request) -> User|null                            │
├──────────────────────────────────────────────────────────┤
│ [ATTN] a: approve cmd · x: reject · n/p                  │
└──────────────────────────────────────────────────────────┘
```

#### Wireframe: Approval sheet, amended while open (60 cols)
```text
┌ cadre · Plan [ATTN] ⚑ ───────────────────────────────────┐
│ [WARN] ⚠ plan changed since you opened it                │
│        (bd-a3 scenarios) · re-read · code changed        │
│ [ATTN] a: approve cmd (p3@5c1e09fa) · n/p                │
└──────────────────────────────────────────────────────────┘
```

### 6.7 Resume banner after `/clear` (v1)

#### Wireframe: Resume banner, transcript log line (120 cols)
```text
● cadre: [OK] resumed · mission "Auth v2" · epic p3 · 2 running (re-adopted) · [IDLE] 1 stale → rebind · ↻ 1            
```

#### Wireframe: Resume banner, band (120 cols)
```text
[OK] ↺ cadre resumed from beads · 5 decisions · next: complete TASK-a5 · [WAIT] drive off until /cadre drive on      [-]
```

#### Wireframe: Resume banner, band (narrow) (60 cols)
```text
[OK] ↺ resumed p3 · ▶2 ◌1 · [WAIT] drive off             [-]
```

### 6.8 Result-card tool row (v1)

#### Wireframe: Result card, pass (120 cols)
```text
⏺ [OK] worker → review  bd-a1 "Add login"  green ✓ test 41s · types 3s  files 4 (+120 −30)  1a2b3c4  52k tok · c91%     
  next: spawn reviewer for bd-a1                                                                                        
```

#### Wireframe: Result card, failure (120 cols)
```text
⏺ [CRIT] worker ✗ green refused  bd-a2 "Session refresh"  1 failing (S3)  files 3 (+64 −8)  41k tok · c83%              
  next: rework (auto-resumed)                                                                                           
```

#### Wireframe: Result card (narrow) (60 cols)
```text
⏺ [OK] bd-a1 worker → review  green ✓                       
  4 files +120 −30 · 1a2b3c4 · 52k c91%                     
  next: spawn reviewer                                      
```

While `isRunning`, or when no `tool_use_id → task` mapping exists (after `/clear`), the engine's own row is drawn (`next(e)`).


### 6.9 Drift / conflict view (later; v1 = band ⚑ + prefill)

#### Wireframe: Conflict and git-flag view (120 cols)
```text
┌ cadre · 2: Task · flags ─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [WARN] ⚠ bd-a3 · conflict on pm (Redmine #812) · field title · 54m                                                   │
│   local (beads, kept)    "Token clock skew"                                                                          │
│   remote (pm, ignored)   "Token clock skew + NTP drift"          edited by j.doe 52m                                 │
│   beads won; a comment was posted on #812. Workflow continues.                                                       │
│   k: keep (clear flag)   a: accept remote (re-apply)              → loads /cadre resolve bd-a3 …                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ATTN] [CRIT] ✗ git:dev:agent · dev moved 4e5f6a7 → 9a8b7c6 outside a cadre merge · 81m                              │
│   window: worker 1 7f2c… (a6) had a call in flight · commits: 9a8b7c6 "wip"                                          │
│   merges and integration are blocked until resolved                                                                  │
│   r: restore (tip → refs/cadre/quarantine/dev-1696…, dev back to 4e5f6a7)   k: keep                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Conflict view, narrow (60 cols)
```text
┌ cadre · flags ───────────────────────────────────────────┐
│ [WARN] ⚠ bd-a3 conflict · pm #812 · title                │
│ local  "Token clock skew"  (kept)                        │
│ remote "Token clock skew + NTP drift"                    │
│ k keep · a accept remote                                 │
├──────────────────────────────────────────────────────────┤
│ [ATTN] [CRIT] ✗ git:dev:agent                            │
│ dev 4e5f6a7 → 9a8b7c6 (worker 1, a6)                     │
│ merges blocked                                           │
│ r restore · k keep                                       │
└──────────────────────────────────────────────────────────┘
```

### 6.10 Release proposal (later; v1 = toast + band cell + typed command)

#### Wireframe: Release proposal (120 cols)
```text
┌ cadre · release ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [OK] dev 9a8b7c6 green ✓ (suite 3m12s) · last tag v1.3.2                                                             │
│ suggested v1.4.0  (feat ×3 → minor; no breaking)                 version: [ 1.4.0      ]                             │
│ [Unreleased]  Added: Login with email+pw (bd-a1) · Session refresh (bd-a2) · Remember me (bd-a6)                     │
│               Fixed: Token clock skew (bd-a3)                                                                        │
│ epics: p3 auth-login (landed dev@9a8b7c6)                                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ATTN] s: load /cadre release 1.4.0                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Release proposal, narrow (60 cols)
```text
┌ cadre · release ─────────────────────────────────────────┐
│ [OK] dev green ✓ · last v1.3.2                           │
│ suggest v1.4.0 (feat → minor)  [ 1.4.0 ]                 │
│ Added: Login with email+pw (bd-a1)                       │
│        Session refresh (bd-a2)                           │
│        Remember me (bd-a6)                               │
│ Fixed: Token clock skew (bd-a3)                          │
│ [ATTN] s: load release cmd                               │
└──────────────────────────────────────────────────────────┘
```

### 6.11 Init wizard stage view (later; v1 = command text per stage + toast)

#### Wireframe: Init stages (120 cols)
```text
┌ cadre · init · repo-1a2b ────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1 [OK]    ✓ beads      bd 1.3.0 · journal on                                                                         │
│ 2 [OK]    ✓ branches   default main · create dev from main (in diff)                                                 │
│ 3 [RUN]   ▶ discovery  explorer reading .github/workflows/ci.yml, Makefile …   1m10s                                 │
│ 4 [READY] ○ confirm    settings.local.json + .cadre/config.json diff                                                 │
│ 5 [READY] ○ validate   setup · checks · junit path   (runs in the jail)                                              │
│ 6 [READY] ○ caches     learned write paths (second diff)                                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ c: load /cadre init confirm <code>      (enabled at stage 4)                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe: Init validate detail, narrow (60 cols)
```text
┌ cadre · init ────────────────────────────────────────────┐
│ 5 [RUN] validate                                         │
│   api setup ✓ 22s                                        │
│   api test  ✓ 41s                                        │
│   [CRIT] api types ✗ exit 2 → key left out               │
│   (tail in .cadre/tmp/logs/init-types.log)               │
│ 6 [READY] caches                                         │
└──────────────────────────────────────────────────────────┘
```


---

## 7. Surfaces and fallbacks (C3)
| Surface | Draws | cadre behaviour |
|---|---|---|
| **Terminal** | all (C3 **V**) | full UI; timeline via `Raster`; notify works |
| **Desktop** | band, pane, transcript sites; native buttons show their hotkey; no `Raster`, InfoNotice, ToolProgress, TurnDuration; `notify` → `no-surface` (UI-13, UI-14, UI-29 **V**) | Epic view without the timeline (Svg later); L3 → toast; prefill works (PC-16) |
| **VS Code chat panel** | nothing (UI-33 **V**) | `/cadre status` text (no codes); attention → `$.ui.log` + toast (rendered? **I**, S-UI4); approval code only via `$.ui.log`, else "approve from a terminal" |
| **`-p` / SDK / cloud** | nothing; `surfaces()` empty (C3 **V**) | approval only with `approval.allowSdk`, no nonce; events → `$.ui.log` (`ui_log`); `/cadre status` + exit codes (CC-08 **V**) |
| **Remote Control / mobile** | drawings only in the local terminal (UI-33); toasts/status remote (UI-26/27 **V**) | attention via toast + status; `/cadre approve` from the phone has origin `bridge` → refused (PC-04 **V**, Q2) |
| **Desktop WSL** | no plugins (C3 **V**) | — |

Detect once per session: `session.start` `e.surface`/`e.isInteractive` + `$.session.surfaces()`, and `e.surface` per render (C3 **V**). The pane is never auto-opened (D9); `{isPlaced:false}` → toast with the reason (UI-02 **V**).

---

## 8. Performance
| Concern | Rule |
|---|---|
| Render purity | Atom reads only (UI-24 **V**); no I/O; O(visible rows) |
| DAG layout | Pure `layout(board, bodyColumns)` (depth, rows, edge grid, ≈7×100 chars), **memoized on `(board.version, bodyColumns, cursor)`**, so it is recomputed only when the read model, the width or the replay cursor changes, never per frame. A module-level memo is a cache, not state: losing it on hot reload just recomputes (UI-P7) |
| Replay fold | Fold the ring up to the cursor: O(events ≤ t) ≤ 500 per change, memoized with the layout |
| Timeline | Cells (≤512×256, typically 101×8 = 808 cells ≈ 13 KB base64) are built when the ring head or width changes. **Cursor moves repaint with `$.ui.blit({requestId, key, cells})`** (UI-21 **V**: own mounted element, ~60/s shown), with no tree re-render. Live mode advances the cursor on the existing 30 s clock |
| Write cadence | core writes `cadre.board` once per transition (hash compare skips no-ops); 5 s sync tick only on change; **one** `$.clock.every(30_000, invalidate)` while ≥1 task runs (UI-23 **V**, re-armed in `session.start`); the flash adds one `$.clock.after(1500)` per changed batch |
| Engine limits | ≤10 redraws/s per site, 30/s for the shown pane (UI-23 **V**). Worst case here ≈1 per transition + blits |
| Big epics | DESIGN caps epics at ≈7 tasks; beyond 12 nodes the DAG shows depth columns with `+k` per column and the band strip truncates (`+3✓ …`); tree text ≤100k chars (UI-01 **V**) |
| Matchers / blocking | every `ui.render` hook names `component` (+`requestId`) (U7); toast/notify are `void`; prefill runs in `$.clock.after(1)`; a hidden pane isn't rendered |

---

## 9. v1 vs later, and the UI LOC budget
The UI client has its own cap, separate from core's 5,000: **v1 ≤ 750**, full UI ≤ **1,500**, checked by `budget.test.ts` over `ui/`. Core's `ui/` 110 line (DESIGN §2.3) moves here.

### 9.1 v1 (≈730)
| # | Element | LOC |
|---|---|---|
| 1 | Shared: atom readers, tag/glyph table, width layouts, truncation | 50 |
| 2 | **Band**: states, ⚑ row, `1`/`d`, **mini-DAG strip** | 95 |
| 3 | Notification policy: matrix, dedupe, coalescing, ack, escalation, status line | 85 |
| 4 | Pane shell: tabs, wide/stacked switch, collapse rules | 40 |
| 5 | **Epic DAG**: depth layout + edge grid (70), node render with strip + flash + Buttons (45), rail (10) | 125 |
| 6 | Epic detail strip + 6-row log | 40 |
| 7 | **Timeline**: span/outage derivation, Raster encode, markers, cursor blit, keys | 100 |
| 8 | **Replay**: ring fold at cursor, `[REPLAY]` header, actions off, `h l b f e` | 25 |
| 9 | Plan tab = approval sheet | 90 |
| 10 | Prefill helper | 20 |
| 11 | Result-card row | 35 |
| 12 | Resume banner, C3 detect, `$.ui.log` fallback | 25 |
| | **Total** | **≈730** (cap 750) |

**If it overflows**, drop in this order (the Plan sheet stays): replay (−25, live-only timeline) → flash (−15) → stacked-timeline variant (−20, narrow hides the timeline) → timeline (−100, log only).

### 9.2 Later (≈ +700 → ≈1,430, cap 1,500)
| Element | LOC |
|---|---|
| Task tab + flag/conflict/git views (§5.4) | 160 |
| Sync tab · Cost tab | 60 · 80 |
| Release view (version `Input`) · init stage view | 70 · 80 |
| Desktop `Svg` render of DAG + timeline | 90 |
| `report`/Task*/`inspect` rows · task-notification card | 80 · 30 |
| Spinner suffix · PromptHint tail · SessionMode label · AskUserQuestion header | 50 |
| Opt-in sound | 20 |
| Agents tab | dropped: timeline lanes + node detail cover it |
| Web sidecar (same read model) | separate client, outside this cap |

**Floor (≈300):** band (with the strip) + notification policy + prefill + result-card row; the sheet goes to `$.ui.log`.

---

## 10. Open questions and smoke tests

### 10.1 Open questions (each has a default)
- **Q1 Band digit `1`** from an empty composer can eat a prompt's leading "1" (UI-14 **V**). *Default:* armed only while attention exists; it opens the item's view and never prefills an approval directly.
- **Q2 Approval from Remote Control/mobile** (`bridge`). *Default:* refuse, toast "approve at the terminal".
- **Q3 Sheet location.** *Default:* pane + `$.ui.log` fallback; `/cadre approve <plan>` text is one line (changes DESIGN §3.1).
- **Q4 `$` per task.** Only session USD exists (SS-14/15 **V**). *Default:* v1 shows tokens + cache %; the later Cost tab shows apportioned `≈$`.
- **Q5 OS-notify escalation.** *Default:* `escalate`, 120 s, immediate for drive paused/finished, minimal text, ≤3 per 15 min.
- **Q6 Replay keys.** `[ ] { } .` are impossible (UI-14 **V**). *Default:* `h`/`l`/`b`/`f`/`e`; a `Client` key widget only if users ask.

### 10.2 UI smoke tests (DESIGN should number them S49+)
| Id | Checks |
|---|---|
| S-UI1 | band/pane/status `code8` absent from `$.session.messages()` and the transcript JSONL |
| S-UI2 | `prompt.fill` from a press: empty composer / text / dialog (`isFilled`, `refusal`) |
| S-UI3 | whether `/cadre approve p3@x` args reach the model (burn-on-use ships either way) |
| S-UI4 | `$.ui.log` and toasts in the VS Code chat panel |
| S-UI5 | `/cadre open` at 60 cols → inline placement; `isPlaced` reasons |
| S-UI6 | Remote Control `/cadre` origin = `bridge` |
| S-UI7 | **Raster in a narrow inline pane**: clips at `bodyColumns`, scrolls under `maxRows`; 101×8 grid encodes and `blit` repaints the cursor without a re-render |
| S-UI8 | Raster accepts `█ ▒ ░ ╌ ┃ ▼` and ASCII `. o * !` (width-1 BMP check), and refuses an ambiguous-width glyph as documented |
| S-UI9 | node composition `Box row [Text "│", Button plain, Text "│"]` validates on terminal + desktop; Up/Down/Enter move and press node Buttons |
| S-UI10 | redraw rate under a 3-worker burst stays ≤ the UI-23 limits; the flash timer clears |
| S-UI11 | desktop: the Raster fragment draws nothing and the "timeline: terminal only" note shows |

---

## 11. For DESIGN.md's owner (this doc does not edit it)
**Core must add for the Epic view** (read model + events):
1. Event envelope fields `actor`, `severity`, `needsHuman` (the UI derives the attention level).
2. `agent.bound {agentId, taskId, role}` (exists) + **`agent.unbound {agentId, reason: answer|stopped|stale|rebind}`**, both with `at` → timeline spans. The UI assigns worker lane slots deterministically by bind order.
3. `task.phase_changed {taskId, from, to, at}` for every phase, incl. spike `explore/report`, and **`task.skipped {taskId, on}`** when a conditional-blocks upstream passes.
4. `tasks[].kind` (`code|docs|spike`), `merges` (false for spikes), **typed** `deps[].type`, `condition {on, state}`, `phaseSince`.
5. `plan.approvedAt`, `plan.landed {dev, sha, at}`, `plan.released {version, at}` for the rail.
6. `sync.state_changed {target, state, at}` → outage shading.
7. Event ring `cadre.events` = **500 per epic**, rebuilt on rehydrate from beads canonical records.

**Other requested changes:**
1. Burn-on-use nonce for `approve` and `init confirm`.
2. Init confirm code nonce-salted (a deterministic `code8(diff)` is computable by a model that saw the diff).
3. The approval sheet goes to the pane / `$.ui.log`; command text is one line.
4. `code8` lives in UI-private `cadre.secret`.
5. Status line = attention only.
6. `ui/` leaves core's cap (UI budget §9).
7. Add `/cadre open [tab]`.
