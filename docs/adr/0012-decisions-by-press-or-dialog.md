# ADR 0012: decisions by press or dialog only

Status: accepted (0.8.0). Supersedes ADR 0008's **Fallback** (typed `approve <id>@<code>`, `setup|init confirm <code>`) and its "Why not `$.ui.ask`" for panes that cannot draw. ADR 0011 made the typed surface `/cadre <goal>`, `setup`, `init`, `doctor`, `/cadre`; this is the other half: what is left of approval.

## Decision
A decision (plan, gate, init/setup confirm, release, flag, resolve, restore, drive, config, sync add) is made by exactly two things, both bound to the decision's **content hash** (`Decision.hash`):
1. a **press** on a card/pane Button (origin `press`, delivered by the engine; cannot be synthesized by code or a model, UI-17), or
2. where no pane can draw (C3: VS Code chat panel, Remote Control, any `$.ui.open` that is not placed), the **same Decision** shown through `$.ui.ask` (AskUserQuestion) with its runnable options as the choices. The chosen label maps to that option's internal command, run as origin `dialog`; `core/dispatch.answer` re-checks the hash when the answer arrives (the card changed while the dialog was open: refused, nothing runs).

`-p` / SDK: `$.ui.ask` rejects, so nothing is decided. `approval.allowSdk` and `CADRE_ALLOW_SDK_APPROVAL` are removed (nothing admits an `sdk` origin). `design/` (DESIGN, UI-DESIGN, artifact wireframes.json) is the historical source and still shows the typed codes; this ADR supersedes it.

## What is deleted
`code8`, the nonce, the init/setup confirm code, burn-on-use, `{code}` in `run` templates, `Secret.{approval,initConfirm,dcode,nonce,initNonce,token}`, `Decision.fallback`, the typed line on the band and cards, the sheet's "load approve command", the session token and `adapter token`. A confirm is `initConfirm(h, stage)`: was the card for that stage still pending (then settled); the files are re-read as before and must match what the card showed. Approve compares the live decision's hash with a fresh hash of the drafts (or the gate/mission): any change since the card was drawn refuses ("it changed; review again") and redraws the card.

Why: the code existed so a typed line could be human evidence. A press already is, and the hash binding gives the same "approve exactly what you saw" guarantee without a secret to leak, burn or mistype. Everything typed that decides something is now just a refusal.

## Dispatcher rules
Gate commands (`approve reject resolve release restore`, `init|setup <sub>`, `config set`, `sync add`, `drive <not status>`) are refused for any origin but `press`/`dialog` (`origin <kind> cannot decide`). Bare `init` / `setup` (start the Claude-driven run) may still be typed (composer) or pressed; they decide nothing.

## Adapters cannot approve
The `commands` grant, the adapter session token and `runCommand` are gone. `deliver` still sends events and the **model view** snapshot (never the human view with decisions); commands in its reply are refused with one line. An adapter that wants a human decision shows its own UI and the human presses the button in cadre.

## Accepted risk: auto-answering `$.ui.ask`
BT-17/UI-30 answers can be given by other mods or hooks, so a dialog answer is weaker evidence than a press. Accepted **only** on surfaces without a pane, where nothing stronger exists; the pane's Button remains the path wherever a pane is placed (the dialog is never asked when `$.ui.open` is placed). The hash re-check at answer time bounds what an auto-answer can approve to the decision as currently shown.
