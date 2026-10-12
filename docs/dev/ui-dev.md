# UI dev loop

Develop the pane without a Claude session, the engine or other features. `scripts/ui-dev.mjs` imports the **real** `ui/` renderers (the code the plugin runs) and draws band + pane (+ the decision card, the timeline) for a *scenario* in your terminal. Node stdlib only.

```bash
node --experimental-transform-types scripts/ui-dev.mjs [scenario] [--width N] [--tab epic|plan|doctor|card] [--once] [--all]
```
- no `--once`: interactive; hot reload (a save in `ui/`, `core/`, `scenarios/` or `tests/fixtures/ui/` redraws in about half a second: each frame renders in a fresh child process, so nothing is stale). A syntax/runtime error draws a red frame; fix and save, the loop keeps running.
- `--once`: print one frame (ANSI on a TTY, plain text otherwise: pipe it for CI/snapshots). `--all`: render every scenario x tab x {60,120}, exit 1 on any throw.
- Colours map the semantic tokens (`warning`, `error`, `success`, `suggestion`, `inactive`) to ANSI; bold/dim/inverse as drawn. A Button draws `[k] label`, an Input `label: value▏`, the timeline Raster as coloured text.

| key | does |
|---|---|
| `→` `←` / `Home` `End` | step the scenario's event stream (replay through the same `at()` fold the pane uses) / first event / live |
| `1` `7` `8` `0` | tabs Epic, Plan, Doctor, Card (`9` reserved) |
| `w` | cycle width 60 / 120 / 160 |
| `a x c y r k n p` | press that button if the frame shows it; the status line prints the command it would dispatch (`/cadre approve p3@ab12cd34`, a composer prefill, a step) through a recording `Acts` stub. Nothing runs |
| `s` | save the current frame as a golden: `tests/fixtures/ui/dev/<scenario>-<width>.txt` |
| `q` | quit |

## Scenarios
`scenarios/<name>.ts` default-exports a `Scenario` (`scenarios/base.ts`): a `View` (`b` snapshot, `ring` events, `sec` secret, `ui`, `c` cfg, `now`) plus `about` and optional `width`/`tab`. Build it from `tests/fixtures/ui/epic.ts` (`view(min, {...})`, `approval()`) where you can; `bare()` makes a plan-less repo for init/setup cards. Shipped: `epic-p3`, `plan-approval`, `setup-sudo-and-fields`, `init-stages`, `flags`, `drive-paused`, `landed-release`, `narrow-60`, `empty-dormant`.

To add one: create the file, add it to `scenarios/index.ts` (the kit has no fs), run it. `tests/ui-dev.test.ts` renders every indexed scenario's band and all tabs at 60 and 120, so a broken scenario fails the gate.

An empty board (fresh init) draws "no tasks yet · /cadre <goal> to start" on every tab (regression test in tests/ui-dev.test.ts).

## See it in the real engine (follow-up)
`harness/tui.sh start <name> --scenario <scenario>` writes `scenarios/<scenario>.ts` as JSON (`ui-dev.mjs --dump`) into the container's working dir and sets `CADRE_DEV=1 CADRE_DEV_SCENARIO=<file>`. For Claude Code to draw it, `session.start` needs a guarded block (only when `CADRE_DEV` is `1`) that reads that file and seeds the atoms: `board = b`, `events = { seq, epics: { [b.epic ?? '']: ring } }`, `secret = sec`, `ui = ui`. The flag side is in place; the `hooks/register.ts` block is not wired yet.
