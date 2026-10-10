# ADR 0009: `/cadre init` flow (one-line text, auto-advance, agentic stages)

Status: accepted (0.6.0). Refines DESIGN §10.1 and §10.2 step 2. The confirm discipline is unchanged: nonce-salted code, burned on every attempt, re-read before writing, `.bak`.

## The bug that started it (real machine, a project folder with no git repo)
`/cadre init`, then pressing `a: Confirm` on the stage 1 card, seemed to do nothing. `.cadre/config.json` was never written, and a second `/cadre init` showed the diff without the `git init` line.
Root cause: stage 1 ran `git init`, `git add -A` and `git commit` in one go. The commit failed (reproduced with no git author identity: `unable to auto-detect email address` / `empty ident name`; a commit hook or required signing fail the same way). That left an *unborn* `main`. The re-proposal saw a repo, dropped the init line and proposed `git branch dev main`, which can never resolve on an unborn branch, so every later press failed too. The failure was invisible: the press toast cut the reason to 36 characters and the card had already been settled. Each failure also emitted another `init.stage proposed` (the three identical log rows).
The suspected cause was ruled out: "files changed since the diff" re-reads the targets *before* applying, so a stage's own writes (`.git/info/exclude` created by `git init`) cannot trip it.
Fix:
- Stage 1 detects an unborn repo (`git rev-parse --verify HEAD` fails) and proposes `+ initial commit on <default>`. Apply runs `git init` only when there is no repo, and add + commit only while `HEAD` is unborn, so a retry finishes what a failed press started.
- A press either completes the stage or says why. A failed apply re-proposes the same stage with a fresh code, and the card's first line is `! last try: <reason>`. A missing identity is named, with the `git config --global user.name/user.email` fix.
Regression test: `tests/init.test.ts` "a failed first commit leaves an unborn repo …". It fails before the fix, because the retry proposal lacks `initial commit on main` and the confirm never completes.

## Command text is one line (UI-DESIGN D2)
Every `/cadre init …` answer is one line of task language, e.g. `init: stage 1/8 repo ready · confirm on the card`, `init: stage 1/8 repo done · stage 2/8 store ready · confirm on the card`, `init: all stages done`. The diff (or a refusal, or a question) goes only to the card. Paths there are repo-relative (`.cadre/config.json`, `.git/info/exclude`) and `~/` for home. The card shows 14 lines plus `… N more lines`; the full diff is in `ui['init.pending'].lines`. The card title carries progress: `init 2/8 · store · confirm`. A stage that answers text instead of a diff (bd missing, stage 6 refused, stage 8's question) gets a card with [r] Re-check and [x] Cancel; stage 8 adds [s] Skip.

## Auto-advance
After a stage applies, the next incomplete stage is proposed in the same call (press or typed) and its card replaces the old one; nothing is retyped. A stage that is already complete applies without a code and the walk goes on. Stages finished in one run are never revisited in that run, so the walk cannot loop. `/cadre init` with everything done answers `init: all stages done`; stage 8 needs `skip` (or an adapter) to count as done.

## Agentic stages (3 mission, 4 discovery)
They need the model. When reached, main gets ONE brief through setup's hand-off (`core/decide.handOff`, moved there from `commands/doctor` so init can use it without an import cycle). The brief is sent with `$.prompt.submit` from a press. Typed in a command, it is refused (PC-05) and queued for the next main turn.complete; [r] Retry on the card sends a queued one from a press. `turn.start` marks the turn that carries the brief. At the end of THAT turn (`afterFix`, `kind:'init'`), init continues: the next card if the stage moved, else `Claude stopped before finishing <stage>` with [r] Retry. One hand-off per stage run (`secret.setupFix` is set).
- Mission: main asks with AskUserQuestion (in MAIN_TOOLS) and drafts `TaskCreate{kind:"mission"}`. The approval card shows the mission itself (`approve the mission · <goal>` plus the goal, constraints and non-goals lines), not "0 tasks". Approving it records the milestone and continues init in the same press.
- Discovery: main spawns one marker-less Agent, which admission retypes with the discovery brief. Live, haiku ran it in the background, so the brief turn ended before the report. While `ui.discoveryAgent` is set the card keeps "Claude is working on discovery…". The report moves init on at a later main turn end (`after(h, false)`: diff 2 card). Main's context line stops saying "spawn the discovery explorer" once the explorer runs or has reported; live, main had been told to spawn a second one.
- The repo is active after stage 1, so main has no shell. These stages need only AskUserQuestion, TaskCreate and Agent.
The card reads "Claude is working on the mission…" / "…on discovery…" meanwhile.

## Log
The pane LOG shows `init: stage 1 repo proposed` / `done` (the event carries an optional `name`). `done` and `pending` are level 1 (log and band, no toast), `proposed` stays level 2. Every event kind has a short text; none falls back to raw JSON. An `init.stage` with the same state as the board is not emitted again (one `proposed` per proposal).
