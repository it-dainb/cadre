# cadre TUI design (v2)

> Status: v2 design, decided 2026-10-12. Supersedes the layout parts of `UI-DESIGN.md` (v1). Tokens, colour, glyphs, spacing and motion come from [`BRAND.md`](BRAND.md); this file applies them.
> Research: `design/research/tui.md` (sources, host limits, diagnosis of v1). Host: Claude Code 2.1.295 mods (band = `AbovePrompt`, pane = `Pane 'cadre'`, `Raster` for the timeline).
> Dev loop: `node --experimental-transform-types scripts/ui-dev.mjs <scenario>` (hot reload, scenarios, `--all` overflow sweep).

## 0. Why v2

v1 was hard to follow because of how it organised information, not how it looked (`design/research/tui.md` §3):

- the same counts appeared three times;
- every state was shown three ways (`[RUN]▶` plus colour);
- six regions were visible at once, including empty timeline lanes;
- it used four border styles;
- labels were shorthand (`58m o rev`, `syn`, `!<`);
- the footer listed keys that did nothing in the current view;
- nothing separated "needs you" from "happening now".

v2 fixes the structure first and the styling second.

## 1. Principles (each has an audit check, §12)

| # | Principle | Check |
|---|---|---|
| P1 | **Three levels, in this order: needs you › happening now › context.** | The first lines of every view are the "needs you" items, if any |
| P2 | **One fact, one place.** A count, a time or a state appears once per screen | No value is rendered twice on one frame |
| P3 | **One signal per state:** glyph + colour; words only for `NEEDS YOU` / `FAILED` | No `[TAG]` words outside those two |
| P4 | **One view at a time.** Graph, timeline, activity, doctor and settings are views you switch to, not regions that are always open | The board view draws at most: header, sections, agents, inspector, timeline summary, footer |
| P5 | **Fit or degrade, never overflow.** Every line fits `bodyColumns` at 40, 60, 120 and 160 | The ui-dev `--all` sweep reports no line wider than `bodyColumns` |
| P6 | **Keys you can use now.** The footer shows 4–6 keys valid in the current view, plus `?` | No footer key is a no-op in its view |
| P7 | **Plain words.** No private shorthand | Wording lint (`tests/wording.test.ts` extended to UI strings) |
| P8 | **Zero tokens.** Everything here is display only | Unchanged from v1 |

## 2. Host constraints (from `design/research/tui.md` §2)

- **Colours:** theme keys only, so they follow light/dark. The timeline `Raster` takes RGB and uses BRAND §3.3. No `NO_COLOR` signal, so `ui.glyphs: ascii` stands in.
- **Layout:** Box flexbox with gap, padding and margin in cells. Text has 7 wrap/truncate modes; rows use `truncate-end`.
- **Widths:** the band's body is the terminal width minus 5. The pane gets `bodyColumns` and `scroll.bodyRows`. Docked at ≥110 columns full-screen, inline otherwise.
- **Redraw caps:** ≤10/s per site, 30/s for the shown pane. A `Button` draws `k: label` itself; never put the key in the label.

## 3. The band (above the prompt)

At most **two lines**; nothing at all when there's no plan and nothing needs you.

```text
› a2 Session refresh · implement · 23m                    p3 auth-login · 4/7
! NEEDS YOU · approve plan p4                                         1: open
```

| Line | Content | Shown when |
|---|---|---|
| 1 "now" | the running task with the most recent change: glyph, id, title, step, elapsed. If 2+ run: `› a2 Session refresh · +1 running`. Right side: plan + progress | a plan exists |
| 2 "needs you" | `! NEEDS YOU · <the oldest decision title>` · `+N more` · `1: open` | a decision is pending |
| problem line (replaces line 1) | `✗ containment degraded · /cadre doctor` or `✗ sync offline 14m` | containment ≠ contained, or sync offline > 60 s |

Settings-type facts (`strict`, `contained ✓`, `cache %`, `pm ✓`) are **not** on the band. They live in the pane header and Doctor, and appear on the band only as a problem line.

Widths:
- ≥100: as above.
- 50–99: the right side drops to `4/7`, the title truncates first.
- <50: line 1 is `› a2 · 4/7`; line 2 is `! NEEDS YOU · 1: open`.

## 4. The pane

### 4.1 Frame

```text
1 Board  2 Graph  3 Timeline  4 Activity  8 Doctor  9 Settings      ?: keys
p3 auth-login · 4/7 done · epic/p3-auth-login                      live
```

- **Tab row** (row 1): numbered tabs. The current tab is bold + `accent`; the others are `inactive`. A tab with something needing you shows `!` after its name.
  - ≥80 columns: full names.
  - 50–79: `1 Brd 2 Gph 3 Tml 4 Act 8 Doc 9 Set`, with the current tab spelled out.
  - <50: `1 2 3 4 8 9 · Board`.
- **Header** (row 2): plan id and slug · progress · epic branch (≥100 only) · `live` or `replay · 14m ago` (replay in `attention` + inverse).
- When a decision is pending, the **decision card** (§5.1) sits directly under the header, above the view. It is the only boxed element. The view under it stays readable (not dimmed) but loses its keys while the card is focused.

### 4.2 `1 Board` (default view)

Wide (≥116): sections on the left, inspector on the right. Narrow (<116): inspector below the sections.

```text
Needs you
  ! a6  Remember me          spec change asked                     1: open

Agents
  worker    a2  implement                                    23m   ctx 41%
  reviewer  a3  review                                        2m   ctx 12%
  explorer  ask  how is auth tested?                          1m

Running
  › a2  Session refresh       implement
  › a3  Token clock skew      review

Waiting
  · a5  Rate-limit fallback   runs only if a3 fails
  ○ a8  Logout everywhere     ready

Done                                                        3 · c: collapse
  ✓ a1  Add login             merged                               9m ago

Timeline  62m · 3 agents · sync offline 14m                      3: open
─────────────────────────────────────────────────────────────────────────
a2  Session refresh · feat
  spec ✓  red ✓  implement ›  green  review  merge
  after a1 · unblocks a6 · worker 23m
↑↓: select  enter: task  c: collapse done  ?: keys
```

Rules:
- Section order is fixed: **Needs you › Agents › Running › Waiting › Done**. Empty sections are not drawn.
- **Agents** is the only place that shows who works, elapsed time and context %. Task rows show the step only (P2).
- **Done** collapses to its title and count by default when it has more than 3 rows (`c` toggles).
- **Waiting** includes ready (`○`) and dependency-blocked (`·`) tasks. The fact column says why: `after a2`, `runs only if a3 fails`, `ready`.
- **Inspector:** the selected task, with title + type, a pipeline line using the step names from BRAND §5 (`✓` done, `›` current, plain = not reached), its dependencies, and its agent. Selection follows the most recently changed running task until you move it.
- **Timeline summary:** one line; `3` opens the view.

### 4.3 `2 Graph`

The dependency graph, frameless: one line per task, `─→` for `blocks`, `┄→` for `conditional-blocks`, a depth column per level, the selected task in `inverse`. At <80 columns it falls back to the depth list (`Depth 0 · Depth 1 …` groups). It has no boxes and no edge-style legend.

### 4.4 `3 Timeline`

- **Swimlanes** (Raster): only lanes that had activity. Lane names are plain role names (`tester`, `worker 1`, `reviewer`, `explorer`, `sync`). Time axis in minutes since the epic started. The cursor is `│`.
- **Replay:** `←/→` step, `e` back to live; the header shows `replay · 14m ago`; buttons are disabled in replay.
- **Under the lanes:** the activity rows up to the cursor time.
- **Narrow:** below 60 columns the lanes are hidden and the view shows only the activity rows.

### 4.5 `4 Activity`

Newest first, one row per event that a human would care about (level ≥ band in v1 terms). Plain sentences:

```text
   now     a3 sent to review
   2m ago  review asked for changes on a2 — worker resumed
   9m ago  a1 merged into epic/p3
  14m ago  sync offline (2 changes waiting)
```

The time column is 7 cells, right-aligned. Silent events (heartbeats, phase ticks without a change a human cares about) are not listed.

### 4.6 `8 Doctor` and `9 Settings`

Unchanged in content (ADR 0007, 0.8.0 Settings). Restyled to BRAND:
- one row per check or key;
- glyph + colour;
- `fix:` lines in `inactive`.
- Settings source tags `default · user · repo · env` in `inactive`.

## 5. Components

### 5.1 Decision card (the only box)

```text
╭─ NEEDS YOU · approve plan p4 ─────────────────────────── 1 of 2 ─╮
│ lite · 1 task · fix · "fix the pager off-by-one"                 │
│   a9  Fix page() off-by-one        worker → review → merge       │
│                                                                  │
│ a: approve   x: reject   c: change   l: lane → full              │
╰──────────────────────────────────────────────────────────────────╯
```

- **Border:** rounded, `subtle`. The title sits on the top edge, `NEEDS YOU` in `attention` + bold. The queue position (`1 of 2`) is right-aligned on the top edge.
- **Body:** at most 6 lines, with no repeated facts (v1 said "7 tasks" twice). Longer content (a full plan sheet, a diff) opens with `enter` in the Board inspector area and scrolls.
- **Fields** (Decision.fields) render as labelled inputs inside the card.
- **Buttons:** one row, at most 4, plus `n/p` when queued. A destructive action is never the first button.
- **Overflow:** the card width is `min(bodyColumns, 72)`. Below 50 columns the buttons stack one per line.

### 5.2 Task row

`␣␣<glyph>␣<id:3>␣␣<title:flex>␣<fact:right>␣<time:6 right>`
- **id:** never truncated.
- **title:** truncates with `…`.
- **fact:** short, plain (`implement`, `after a2`, `merged`).
- **time:** relative, only in Done and Activity.

### 5.3 Agent row

`␣␣<role:9>␣<id:3>␣␣<step or question:flex>␣<elapsed:6 right>␣<ctx:8 right>`
- **ask agents** show `ask` as the id and the question as the step text.
- **ctx** is shown only at ≥80 columns.

### 5.4 Footer

One line, 4–6 keys valid in the current view, plus `?: keys`. `?` opens a key sheet for the current view (the full list, grouped).

### 5.5 Change flash (BRAND §9)

A row whose state changed draws in `accent` + bold for 1.5 s. It then shows `· just now` in `inactive` until the next 30 s tick. The flash is skipped in replay, when >3 rows change at once, or with `ui.flash: false`.

## 6. Density tiers (by `bodyColumns`)

| Tier | Pane | Band |
|---|---|---|
| ≥116 wide | board + inspector side by side; full tab names; ctx % in agent rows | two lines, full |
| 80–115 | inspector below; full tab names | two lines, right side shortened |
| 60–79 | inspector below; short tab names; no ctx %; timeline lanes still shown | two lines, short |
| 40–59 | inspector collapses to its first line; numbers-only tab row; timeline = activity only; card buttons stacked | `› a2 · 4/7` / `! NEEDS YOU · 1: open` |
| <40 | header + Needs you + Running only; "widen the pane for more" | attention line only |

`ui.density: compact` removes the blank rows between sections. `relaxed` adds a blank row after each task row.

## 7. States

| State | What shows |
|---|---|
| dormant (cadre off in this repo) | band: nothing · pane: `cadre is off in this repo · /cadre init` |
| no plan | band: nothing (or a needs-you line) · board: `no tasks yet · /cadre <goal> to start` |
| setup/init run | board replaced by the run checklist card (✓ / ✗ / … / ·) under the header |
| replay | header `replay · 14m ago` in attention + inverse; buttons disabled; band stays live |
| degraded / offline | band problem line; Doctor tab shows `!` |
| error rendering a view | a one-line `couldn't draw this view · /cadre doctor` instead of a crash (v1 crashed on an empty board) |

## 8. Keys

| Where | Keys |
|---|---|
| band (empty composer) | `1` open the oldest decision |
| pane, any view | `1 2 3 4 8 9` views · `?` key sheet · `esc` back to the prompt (engine) |
| card focused | `a` `x` `c` `l` (per decision) · `n` `p` queue |
| board | `↑↓` select · `enter` open task detail · `c` collapse done |
| graph | `↑↓` select · `enter` detail |
| timeline | `←→` step · `home/end` · `e` live |
| settings | `↑↓` select · `e` edit / toggle |

Keys are one lowercase letter or one digit (engine rule). No key does anything outside its view.

## 9. Accessibility

As in BRAND §10. In addition:
- Every view has a text-only form at <40 columns.
- The card is reachable with `1` from an empty composer.
- Nothing requires colour to be read.

## 10. What v2 removes from v1

- `[TAG]` words outside `NEEDS YOU` and `FAILED`.
- `●◉○` pipeline strips on every node (the pipeline line lives in the inspector only).
- Boxed graph nodes, `┏━┓` and `╔═╗` flash borders, and the four border styles.
- The always-visible timeline and LOG regions on the default view (now a summary line plus their own tabs).
- The band's settings cells (`strict · contained ✓ · cache · pm ✓`) and the mini-DAG strip with depth separators.
- Footer keys that don't apply to the current view.
- The `⏸ ⚠ ▶ ⚑ ◉ ●` glyphs (BRAND §6).

## 11. Build plan

1. Tokens module `ui/tokens.ts` with the BRAND roles, glyph table + ASCII, spacing constants and Raster palettes. Every renderer imports from it, with no literal colours or glyphs elsewhere.
2. Band v2 (§3), then the pane frame + Board (§4.1–4.2), then the card restyle (§5.1). Each step lands with ui-dev scenarios and goldens.
3. Graph, Timeline, Activity views (§4.3–4.5); Doctor and Settings restyle (§4.6).
4. Remove the v1-only code (§10). The `ui/` LOC cap stays 750.

## 12. Acceptance (automated)

- **Overflow sweep:** `scripts/ui-dev.mjs --all` renders every scenario × every tab × widths 40/60/80/120/160 and fails on any line wider than `bodyColumns`. The harness must draw Buttons as `k: label`, like the engine.
- **No-duplicate check:** per frame, a progress count, an elapsed time or a context % appears at most once.
- **Wording lint** extended to UI strings: no `w1`, `rev`, `syn`, `tst`, `!<`, `!>`, no raw epoch minutes.
- **Glyph check:** no glyph outside the BRAND §6 set (plus the box characters of the card and the Raster blocks).
- **Goldens:** regenerated from the scenarios after a human looks at each one in ui-dev; never self-approved.

## 13. Decision log

- 2026-10-12: colour Claude-native; state = glyph + colour; frameless (card is the only box); spacing standard + airy sections; safe check/arrow glyphs; UPPERCASE only for NEEDS YOU / FAILED; motion still + live counters + quiet row flash; band = now + needs-you ≤2 lines; main view Board (list by state); agents in their own section; timeline as its own view with a 1-line summary; numbered tab row with short forms below 80 columns.
