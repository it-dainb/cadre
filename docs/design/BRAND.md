# cadre brand (terminal)

> Status: v1, decided 2026-10-12 (choices made by the user from the variants in `design/research/tui.md` §5).
> Scope: every pixel cadre draws inside Claude Code: the band above the prompt, the `cadre` pane, decision cards, toasts.
> TUI-DESIGN.md applies these tokens to layouts and components. When the two disagree, this file wins for tokens; TUI-DESIGN.md wins for layout.

## 1. Personality

**Calm, native, legible.** cadre should feel like part of Claude Code, not a second app inside it.

- It speaks only when something needs you or something changed.
- One fact is shown once, in one place.
- Plain words over shorthand: `worker`, `review`, `9m ago`, never `w1`, `rev`, `58m o`.

## 2. Host limits (why the tokens look like this)

Claude Code mods can only colour text and boxes with **theme keys**, which follow the user's light or dark theme. Raw hex is accepted, but it does not adapt to the theme, so cadre never uses it outside the timeline Raster. The Raster takes RGB only, so it gets two hand-checked palettes (§3.3). Text attributes available: bold, dim, inverse, underline, strikethrough (italic: avoid). There is no `NO_COLOR` or reduced-motion signal; the `ui.glyphs: ascii` and `ui.flash: false` settings stand in for them.

## 3. Colour: "Claude-native"

### 3.1 Roles → theme keys (Text and Box)

| Role | Theme key | Used for |
|---|---|---|
| `fg` | `text` | body text |
| `muted` | `inactive` | secondary facts, timestamps, done rows, section labels |
| `accent` | `claude` | the running task, the selected row's glyph, the primary button, the change flash |
| `attention` | `warning` + bold | "needs you": the attention line, the decision card title |
| `success` | `success` | done / pass glyph |
| `danger` | `error` | failed / blocked / critical glyph and word |
| `rule` | `subtle` | the one thin rule between sections, the card border |

**Budget: at most 4 hues on any screen** (fg, muted, accent, plus one of attention/success/danger). Never use `error` for anything that is not a failure. No `backgroundColor` on regions: the only background is `inverse` on the selected row.

On light themes `dimColor` can vanish, so muted text uses the `inactive` key, never `dimColor`, whenever it carries information.

### 3.2 Colour is never alone

Every state has a glyph (§6). Colour only reinforces it. Words appear only for `NEEDS YOU` and `FAILED` (§5).

### 3.3 Raster palette (timeline only)

Two fixed palettes chosen from the theme (`$.config.list()` → theme), plus a default-foreground mode (`0x01000000`) when the theme is unknown:

| Cell | Dark | Light |
|---|---|---|
| work span | `#D77757` (Claude orange) | `#B4532E` |
| review span | `#8A8F98` | `#5C6370` |
| offline span | `#4B4F57` | `#C8CCD2` |
| needs-you mark | `#E5C07B` | `#9A6A00` |
| failure mark | `#E06C75` | `#B3261E` |

Contrast floor: 4.5:1 for text, 3:1 for spans against the terminal background.

## 4. Emphasis

| Level | Attributes | Used for |
|---|---|---|
| Title | bold | section titles, the card title, the selected task's title |
| Body | plain | everything else |
| Label | `inactive` | metadata: times, counts, sources, hints |
| Selection | `inverse` | the selected row (one at a time) |
| Link | underline | a press-able text that is not a Button |
| Cancelled | strikethrough + `inactive` | cancelled tasks only |

Maximum two attributes on one span. No italic.

## 5. Words and casing

- **Sentence case everywhere.** UPPERCASE is reserved for exactly two words: **NEEDS YOU** and **FAILED**, so they are the first thing the eye finds.
- **Section titles:** sentence case, bold, no colon: `Needs you`, `Running`, `Waiting`, `Done`, `Activity`.
- **Plain role names:** `tester`, `worker`, `reviewer`, `explorer`, `main`. Steps in full: `spec`, `red`, `implement`, `green`, `review`, `merged`.
- **Times:** relative, `9m ago`, `2h ago`; elapsed on running rows, `23m`, `1h05`. Never a raw epoch-minute like `58m`.
- **Numbers:** counts `4/7`, percentages `41%` (no space), right-aligned in columns.
- **Separators:** ` · ` between facts on a line, ` › ` for breadcrumbs, ` — ` between an action and its consequence.
- **Keys:** the engine's `k: label` form. Show 4–6 keys that work right now, plus `?` for the rest. Never list keys that do nothing in the current view.
- **Truncation order:** drop optional facts right to left, then shorten the title with `…`. Never cut the task id, the state glyph or a key hint.

## 6. Glyphs: "safe check/arrow"

Only single-width glyphs that no common font turns into emoji.

| State | Glyph | ASCII | Colour role |
|---|---|---|---|
| needs you | `!` | `!` | attention |
| running | `›` | `>` | accent |
| ready | `○` | `o` | fg |
| waiting (dependency/gate) | `·` | `-` | muted |
| done | `✓` | `+` | success |
| failed / blocked | `✗` | `x` | danger |
| skipped / cancelled | `–` | `.` | muted |

Rules:
- One glyph per row, always in column 3 (after a 2-cell indent).
- No emoji, no `⏸ ⚠ ▶ ⚑ ◉ ●`: they render wide or as emoji in some terminals and break column alignment.
- No spinner: Claude Code already animates one. Running rows show elapsed time instead.
- The Raster uses only block cells `█ ▓ ▒ ░` (width-1, BMP).
- `ui.glyphs: ascii` switches every glyph to the ASCII column. ASCII is chosen automatically for `TERM=dumb` or a non-UTF-8 locale.

## 7. Spacing: "standard + airy sections"

- **Scale (cells):** 0 · 1 · 2 · 3 · 4 · 6 · 8. No other values.
- **Indent:** 2 cells for rows under a section title; 4 for a row's detail line.
- **Gutters:** 1 cell between columns, 2 cells between buttons.
- **Rhythm:** one blank row between sections; none inside a section.
- **Fixed columns in task rows:** indent 2 · glyph 1 · space 1 · id 3 (left) · space 2 · title (flex, truncates) · facts (right-aligned) · time 6 (right-aligned).
- **Density:** automatic by `bodyColumns` (see TUI-DESIGN.md), plus a `ui.density: compact | normal | relaxed` setting. `compact` removes the blank rows between sections; `relaxed` adds a blank row after every task.

## 8. Borders: "frameless"

- cadre draws **no boxes** around panes or sections. The engine frames the pane.
- Sections are separated by one blank row; a single `─` rule in `subtle` only where two regions sit side by side or a list scrolls into another.
- **The decision card is the only bordered element:** a rounded single border (`╭ ╮ ╰ ╯ ─ │`) in `subtle`, with the title in `attention` on the top edge. "If it has a box, it needs you."
- No double borders, no heavy borders, no per-node boxes in the graph view.

## 9. Motion: "still + live counters + a quiet flash"

- **Counters:** elapsed time on running rows refreshes on the existing 30 s timer. Nothing else moves on a schedule.
- **Change flash:** when a row's state changes, the row is drawn in `accent` + bold for 1.5 s, then returns to normal with `· just now` in `muted` until the next 30 s tick. Off with `ui.flash: false`; skipped in replay and when more than three rows change at once.
- No blinking, no spinners, no animated borders.
- Redraw budget: within the engine caps (≤10/s per site, 30/s for the shown pane); in practice about one redraw per state change plus one every 30 s.

## 10. Accessibility

- Glyph + colour for every state; words for the two that matter most.
- Readable on light and dark themes (theme keys; `inactive` instead of `dimColor`).
- `ui.glyphs: ascii` for fonts that lack the glyphs; ASCII auto-selected for `TERM=dumb` and non-UTF-8 locales.
- `ui.flash: false` for people who don't want motion.
- Every action is a key and a visible Button; nothing depends on a mouse.

## 11. Do and don't

| Do | Don't |
|---|---|
| Show a fact once, where it belongs | Repeat counts on the band, the header and the graph |
| `› a2 Session refresh · implement · 23m` | `[RUN]▶ a2 … ●●◉○○○ implement` |
| `9m ago review asked for changes on a2` | `58m o rev a2 changes → resumed` |
| One rounded box: the decision card | Boxes around every node and section |
| `NEEDS YOU` once, in the attention colour | `[ATTN] ⚑ NEEDS YOU` with three signals |
| Keys that work now: `a: approve  x: reject  ?: more` | A footer listing every key of every mode |
| Settings and health in the pane, on the band only when broken | `strict · contained ✓ · cache 87% · pm ✓` on every frame |
