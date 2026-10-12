# ADR 0012: decisions are answered in the native dialog only

Status: accepted (0.8.0). Revised 2026-10-12 (user decision "dialog only"): the decision card and its Buttons are removed. Supersedes ADR 0008's card, its **Fallback** (typed `approve <id>@<code>`, `setup|init confirm <code>`) and its "Why not `$.ui.ask`". ADR 0011 made the typed surface `/cadre <goal>`, `setup`, `init`, `doctor`, `/cadre`; this is the other half: how the human decides.

## Decision
A decision (plan, gate, init/setup confirm, release, flag, resolve, restore, drive, config, sync add) is answered in exactly one place: the engine's **AskUserQuestion dialog** (`$.ui.ask`), on every surface. One path: `ui/index.answerDialog` → `Host.answer(id, key, hash, vals)` → `core/dispatch.answer(h, id, key, hash, route, vals)`, which runs the option's command as origin `dialog`. The **content hash** (`Decision.hash`) is re-checked when the answer arrives: if the decision changed while the dialog was open, the answer is refused ("it changed; review again"), nothing runs, and the dialog asks the fresh decision again (at most 3 rounds; a refusal that leaves the decision as it was is not re-asked).

The dialog:
- **Question** = the decision's title, then at most 6 body lines (`error` first, then `lines`). Each fact appears once (BRAND P2).
- **Options** = the decision's runnable options in their order (at most 4), plus **Not now** when it has fewer than 2 (the engine needs 2; this was the bogus "Yes" on the release dialog). The engine adds **Type something**.
- **Type something** = a change request: the text goes to main as `Decision.change + text` (`Change <plan>: …` for plans and gates, `About "<title>": …` otherwise), through the existing brief timer (`core/lanes.queueBrief`). A plan stays a draft and main revises it.
- **Fields** (`Decision.fields`) are asked one by one before the options: `Keep <value>` / `Cancel`, or the typed text is the value. The command validates; a refusal re-asks the decision with `error`, so the dialog asks again.
- **Not now**, Esc, `-p` (`$.ui.ask` rejects): nothing is decided.

## No nagging
A decision's dialog opens **by itself at most once**, when its id first appears, and only over an empty composer with no dialog of ours up (`ui/index.autoAsk`, called on every event, every Settings press and the 5 s timer; the ids shown are kept in `cadre.ui.shown`). A changed hash under the same id is not a new decision. A dismissal never brings it back by itself. After that the band shows `! NEEDS YOU · <title> · +N more · 1: answer` and **`1`** (band, or any pane tab) re-opens the dialog for the oldest decision. A `quiet` decision (the setup/init progress while Claude works) never pops. Live bug this fixes: the release dialog came back after every main turn and covered the composer.

## The pane
Read-only. The epic tab starts with **NEEDS YOU**: one row per decision (`! <title>` · `answer`, `1` on the oldest) with its full lines under it; a plan row opens the Plan tab (the sheet) on enter, a task row selects the task. The other tabs carry the one-line form on top. No option Buttons, no Inputs, no card box. Settings toggles stay presses (origin `press`): they are not decisions.

## What is deleted
The card (`ui/card.ts`), its Buttons, the press origin for decisions and the card press handler (`Acts.press`, `Acts.fill`, `Acts.input`), the composer prefill (`DecisionOption.fill`), card fields as Inputs (`cadre.ui.fields`), the `card` tab and `defaultTab`. Earlier: `code8`, the nonce, the init/setup confirm code, burn-on-use, `{code}` in `run` templates, `Secret.{approval,initConfirm,dcode,nonce,initNonce,token}`, `Decision.fallback`, the typed line on the band, the session token and `adapter token`.

## Continue after approval
Approving a plan (lite or full) queues ONE brief to main: `Plan <id> is approved: spawn its ready tasks one by one (each by its id), follow the cards until every task is done, then complete the plan (TaskUpdate <id> completed).` The close of the plan's last open task says once, in its card's next line, `every task is done: complete the plan (TaskUpdate <id> completed)`. Nothing else is automatic: drive stays separate (ADR 0005).

## Dispatcher rules
Gate commands (`approve reject resolve release restore`, `init|setup <sub>`, `config set`, `sync add`, `drive <not status>`, `lane`) are refused for any origin but `dialog` (and `press`, which only the Settings tab produces): `origin <kind> cannot decide`. Bare `init` / `setup` may still be typed; they decide nothing. `-p` / SDK: nothing admits an `sdk` origin.

## Adapters cannot approve
`deliver` sends events and the **model view** snapshot (never the human view with decisions); commands in its reply are refused with one line.

## Accepted risk: auto-answering `$.ui.ask`, everywhere
BT-17/UI-30: another mod or hook can answer a `$.ui.ask` dialog, so an answer is weaker evidence than a Button press was. Accepted on every surface, because:
- the user chose one familiar place to answer over two (card + dialog), and the card's Buttons were the part people missed or found noisy;
- a mod that auto-answers dialogs is already trusted with the session (it runs in the same engine, with the same tool rights);
- the hash re-check bounds an auto-answer to the decision exactly as shown, and every answer is logged (`cadre: <result>`) and recorded (`store.record('decision', …)`);
- typed text, model output, sdk and adapter origins still decide nothing.
