# ADR 0008: decisions by click (the decision card)

Status: accepted (0.4.0). Supersedes UI-DESIGN D6 and §5.2 for **presses**; the typed path is unchanged and remains the fallback.

## Decision
Every human action is one click in the cadre pane: plan approval, human gates, setup confirm, init stage confirms, spec_change accept/reject, flag keep/accept/cancel, git flag restore/keep, release. While a decision is pending, the pane's active view is a **decision card**: a framed box with the question, a short description (plan counts and task list, setup plan rows, init diff lines, the flag and what each button does) and buttons (`a` Approve/Accept/Confirm/Release, `x` Reject/Cancel, `c` Change, `k` Keep, `r` Restore). The rest of the pane is drawn dim below it (the API has no overlay; none is faked). The band's ⚑ row keeps one button (`1`) that opens the card.

## Why a press is human evidence (revises D6)
A press is delivered to our `onPress` by the engine and cannot be synthesized by code, a model or another mod (UI-17); unlike a composer line, a model cannot make one clickable (transcript links are composer origin). `commands/cadre.press(h, line)` runs the typed command through the dispatcher with origin `{kind:'press'}`, which `isHuman` accepts next to `composer`. `commands/cadre.run` maps an engine-supplied origin `press` to `unclassified`, so the name cannot be claimed from outside. sdk, adapter and the rest keep their rules.

## Hash binding, burn
A button's command is built at render time from the secret it was drawn with: `approve <id>@<code8>` (code8 = nonce + canonical drafts hash), `setup|init confirm <code>` (code = nonce + plan/diff hash), `resolve <id> <how>`. Nothing new is stored. If the plan, setup plan or diff changed after the card was drawn, the dispatcher's existing check fails: the attempt is refused, the code is burned and redrawn, the press handler toasts "it changed or was refused; review again" and invalidates, so the card re-renders with the new code. A refused attempt also kills the live code (one secret per decision); a successful one clears it. Reject and Cancel carry no secret; `setup|init cancel` (new, human-only) burns the pending code. `reject` records "rejected in the pane" as the reason (no Input in v1).

## Change
Plans and gates: prefill the composer with `Change <id>: ` (existing `prefill`: refused over a non-empty composer, toast instead). Setup/init: re-plan (`setup`, `init <stage>`: new diff, new code).

## Opening, focus
`openPane` issues `$.ui.open` as the first act of the command or press. Live capture: the same call from inside `$.clock.after(1, …)` counts as *unasked* and is refused below 144 columns, so presses and commands open the pane before deferring their work. When a decision appears (event level ≥ 2, `release.proposed`) the card opens once per decision, focused only while the composer is empty (the engine also refuses focus over a dialog); an unasked open still needs the columns, else the band and toast carry it and `1` opens it. Focus is never requested with text in the composer.

## Why not `$.ui.ask` / AskUserQuestion
Unchanged from D6: BT-17/UI-30 answers can be given by other mods or hooks, so the answer is not human evidence. A Button press is.

## Fallback
Where nothing draws (VS Code panel, `-p`) the band/toast text and the typed `/cadre approve <id>@<code>`, `/cadre setup|init confirm <code>`, `/cadre resolve …`, `/cadre release` are unchanged and still composer-origin.

## Band fixes (user screenshot)
A plain Button already draws `hotkey: label`; labels no longer carry the key (`1: 1: open` is gone; `txt()` and `wid()` count the engine's prefix so tests and padding see what is drawn). Footer keys became labelled Buttons (`n: next  p: prev …`). In a docked pane the band is only the transcript column wide (24 columns at 120): the ⚑ row wraps there (never truncated) and flag items carry a short form.

## Scope left out
Lost-epic `resolve <epic> recut|cancel` has no band item today, so no card; spec_change shows the flag, not the worker's reason (not in the board snapshot); sync add shows Confirm only. The Plan-tab sheet buttons still prefill (typed path).

## Live result (harness tui.sh, haiku, 120 cols; captures in `docs/evidence/live/click/`)
`/cadre setup`: card with the plan rows + "you run once"; `a` ran both actions (✓ ✓). Draft plan created by the model: band ⚑ row fits (docked: wraps), `1` opened the card, `c` loaded `Change p-… : `, `a` approved without typing ("Plan … approved: 1 task ready").
