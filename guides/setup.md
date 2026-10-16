# Set up cadre on this machine

You prepare this machine for cadre, once. Work through the phases in order. Run every command with Bash so the user sees it. Edit files with Read, Edit and Write.
Rules: never use `sudo`. Never touch the Claude Code install. Prefer user-level fixes (your home folder, an npm prefix you own, a PATH line in your shell profile). Move things aside instead of deleting them. Never make up a name or an email. Never edit a Claude Code settings file (`settings.json`, `settings.local.json`): cadre applies those after the user confirms them in the dialog. Say what you changed.

## Phase 1: look
Run these and note what is missing or old:
```
git --version
git var GIT_AUTHOR_IDENT
bwrap --version
socat -V
```
Done when you know which of phases 2 and 5 apply. Skip the ones that do not.

## Phase 2: git identity
Only if `git var GIT_AUTHOR_IDENT` failed. Ask the user with AskUserQuestion for the name and the email to commit with (offer what `git config --get user.name` or `$GIT_AUTHOR_NAME` shows, if anything). Then:
```
git config --global user.name "<name>"
git config --global user.email "<email>"
```
Done when `git var GIT_AUTHOR_IDENT` succeeds.

## Phase 3: user settings
If the message names the user settings, do not edit the file. cadre shows the change in a dialog. Tell the user: "Please confirm the user settings in the cadre dialog (press 1)."
Done when you told the user.

## Phase 4: preferences
Ask the user with AskUserQuestion, in one round:
- the default mode: "auto" (Claude asks you to approve each plan and the decisions it cannot make) or "yolo" (after you approve a plan, nothing is asked until it lands on dev);
- the limits for one plan run: turns (default 100), cost in dollars (default 20), minutes (default 240). Offer "Keep the defaults";
- tasks worked on in parallel in one plan: 1, 3 (default), 5 or unlimited;
- plans worked on in parallel in one milestone: 1, 3, 5 or unlimited (default 2).
Unlimited is the value 0.
Then hand the answers to cadre with one TaskCreate: subject `preferences`, description `the user's choices`, metadata `{"kind": "preferences", "mode": "auto", "maxTurns": 100, "maxCostUsd": 20, "maxWallMinutes": 240, "maxParallel": 3, "maxEpics": 2}` with their values. cadre shows the change in a dialog and writes it after they confirm; do not edit any settings file. Tell the user to confirm it in the cadre dialog (press 1).
Done when the TaskCreate was accepted.

## Phase 5: what needs the password
Some fixes need root (installing bubblewrap or socat, allowing bwrap to create user namespaces). cadre has written each as a script; the message you got names the line, for example `sudo sh ~/.cache/cadre/fix/socat.sh`.
Do not run it. Give the user that one line to run in their own terminal (not with `!` here: it cannot ask for the password). Then ask with AskUserQuestion: "Did you run it?" with the options "Done" and "Skip for now".
Done when the user answered.

## Phase 6: stop
Say in two or three lines what you changed. Then stop. cadre checks everything again on its own; if something is still open you get a message naming it.
