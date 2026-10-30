# Set up cadre on this machine

You prepare this machine for cadre, once. Work through the phases in order. Run every command with Bash so the user sees it. Edit files with Read, Edit and Write.
Rules: never use `sudo`. Never touch the Claude Code install. Never make up a name or an email. Never edit a Claude Code settings file (`settings.json`, `settings.local.json`): cadre applies those after the user confirms them in the dialog. Say what you changed.

## Phase 1: look
Run `git --version`, `git var GIT_AUTHOR_IDENT`, `bwrap --version` and `socat -V`; note what is missing or old. Done when you know which of phases 2 and 5 apply. Skip the others.

## Phase 2: git identity
Only if `git var GIT_AUTHOR_IDENT` failed. Ask the user (AskUserQuestion) for the name and email to commit with (offer what `git config --get user.name` or `$GIT_AUTHOR_NAME` shows), then run `git config --global user.name "<name>"` and `git config --global user.email "<email>"`. Done when `git var GIT_AUTHOR_IDENT` succeeds.

## Phase 3: user settings
If the message names the user settings, do not edit the file: cadre shows the change in a dialog. Tell the user: "Please confirm the user settings in the cadre dialog (press 1)." Done when you told the user.

## Phase 4: preferences
Ask the user (AskUserQuestion), in one round:
- the default mode: "auto" (Claude asks you to approve each plan and the decisions it cannot make) or "yolo" (after you approve a plan, nothing is asked until it lands on dev);
- the limits for one plan run: turns (default 100), cost in dollars (default 20), minutes (default 240); offer "Keep the defaults";
- tasks worked on in parallel in one plan: 1, 3 (default), 5 or unlimited;
- plans worked on in parallel in one milestone: 1, 3, 5 or unlimited (default 2).
Unlimited is 0. Hand the answers over with one preferences call: `{"mode": "auto", "maxTurns": 100, "maxCostUsd": 20, "maxWallMinutes": 240, "concurrency": 3, "maxEpics": 2}` with their values. cadre shows the change in a dialog and writes it after they confirm; tell the user to confirm it there (press 1). Done when the call was accepted.

## Phase 5: what needs the password
Some fixes need root (installing bubblewrap or socat, allowing bwrap to create user namespaces). cadre runs none of them and writes no script: the command for each is in `docs/troubleshooting.md`, table "The machine", in the plugin folder beside `guides/`. Give the user the one line to run in their own terminal (not with `!` here: it cannot ask for the password). Then ask (AskUserQuestion): "Did you run it?" with "Done" and "Skip for now". Done when the user answered.

## Phase 6: stop
Say in two or three lines what you changed. Then stop; cadre checks again and names anything still open.
