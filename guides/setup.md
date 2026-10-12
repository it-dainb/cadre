# Set up cadre on this machine

You prepare this machine for cadre, once. Work through the phases in order. Run every command with Bash so the user sees it. Edit files with Read, Edit and Write.
Rules: never use `sudo`. Never touch the Claude Code install. Prefer user-level fixes (your home folder, an npm prefix you own, a PATH line in your shell profile). Move things aside instead of deleting them. Never make up a name or an email. Say what you changed.

## Phase 1: look
Run these and note what is missing or old:
```
git --version
git var GIT_AUTHOR_IDENT
bd version
command -v bd
npm prefix -g
bwrap --version
socat -V
cat ~/.claude/settings.json
```
Done when you know which of phases 2 to 5 apply. Skip the ones that do not.

## Phase 2: git identity
Only if `git var GIT_AUTHOR_IDENT` failed. Ask the user with AskUserQuestion for the name and the email to commit with (offer what `git config --get user.name` or `$GIT_AUTHOR_NAME` shows, if anything). Then:
```
git config --global user.name "<name>"
git config --global user.email "<email>"
```
Done when `git var GIT_AUTHOR_IDENT` succeeds.

## Phase 3: bd 1.3.0 or newer
Only if `bd version` failed or shows an older version.
- With npm: `npm install -g @beads/bd@latest`. If it fails with a permission error, use a prefix you own: `npm config set prefix ~/.npm-global`, add `export PATH="$HOME/.npm-global/bin:$PATH"` to your shell profile, export it in this shell too, and install again.
- Without npm: `curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash`
- An old `bd` in a folder under your home that comes first on PATH: `mv <that path> <that path>.cadre-old`.
Done when `bd version` shows 1.3.0 or newer and `command -v bd` names the new one.

## Phase 4: user settings
`~/.claude/settings.json` needs `"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"` under `"env"`. Copy the file to `~/.claude/settings.json.bak` first (`cp`), then add the key with Edit, keeping every other key as it is. If the file does not exist, Write `{"env": {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"}}`.
Done when the file holds that key and is valid JSON.

## Phase 5: what needs the password
Some fixes need root (installing bubblewrap or socat, allowing bwrap to create user namespaces). cadre has written each as a script; the message you got names the line, for example `sudo sh ~/.cache/cadre/fix/socat.sh`.
Do not run it. Give the user that one line to run in their own terminal (not with `!` here: it cannot ask for the password). Then ask with AskUserQuestion: "Did you run it?" with the options "Done" and "Skip for now".
Done when the user answered.

## Phase 6: stop
Say in two or three lines what you changed. Then stop. cadre checks everything again on its own; if something is still open you get a message naming it.
