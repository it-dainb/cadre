# Set up cadre in this project

You prepare the current project for cadre. Work through the phases in order. Run every command with Bash in the project folder so the user sees it. Edit files with Read, Edit and Write.
Rules: change only the files this guide names (`.cadre/`, `.git/info/exclude`, `CHANGELOG.md`). Never edit source files or a Claude Code settings file; cadre applies settings after the user confirms them in the dialog. Never make up a name or an email. Never commit anything except the first commit of a new repository.

## Phase 1: repository
1. `git rev-parse --git-dir`. No repository: `git init -b main`.
2. `git var GIT_AUTHOR_IDENT`. If it fails, ask the user with AskUserQuestion for the name and email to commit with, then `git config --global user.name "<name>"` and `git config --global user.email "<email>"`.
3. `git rev-parse --verify HEAD`. No commit yet: `git add -A` then `git commit -m "chore: initial commit"`.
4. The main branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (drop the `origin/`), else `git branch --show-current`.
5. `git rev-parse --verify dev`. Missing: `git branch dev <main branch>`.
6. `.git/info/exclude` must hold the lines `.cadre/store/`, `.cadre/store.gate.lock` and `.claude/settings.local.json`. A project that already has a `.beads/` folder (and no `.cadre/store/`) needs `.beads/` instead of the first two. Add only the missing ones (`printf '%s\n' ... >> .git/info/exclude`).
7. `.cadre/config.json` must hold `{"branches": {"main": "<main branch>", "dev": "dev"}}`. Create it with Write, or merge the key into the existing file with Edit.
Done when all seven hold.

## Phase 2: task store
The task store lives in `.cadre/store`. Put `BEADS_DIR="$PWD/.cadre/store"` in front of every `bd` command (a variable set in one Bash call is gone in the next). A project that already has a `.beads/` folder and no `.cadre/store/` keeps it: run the same commands without `BEADS_DIR`.
Run, in the project folder:
```
mkdir -p .cadre
BEADS_DIR="$PWD/.cadre/store" bd init --non-interactive --init-if-missing --skip-agents --skip-hooks
BEADS_DIR="$PWD/.cadre/store" bd config set status.custom draft:frozen,in_review:wip
BEADS_DIR="$PWD/.cadre/store" bd config set types.custom refactor,docs,test,spike,decision,milestone,gate
BEADS_DIR="$PWD/.cadre/store" bd config set events-journal true
```
Done when `BEADS_DIR="$PWD/.cadre/store" bd config get events-journal` prints `true`.

## Phase 3: mission (only when no goal comes next)
If your brief says the user's goal comes next, do nothing in this phase: no question and no TaskCreate. The mission goes into that goal's plan later.
Otherwise ask the user with AskUserQuestion, in one round: the goal in one line, the constraints, the non-goals. Then draft it with TaskCreate: subject = the goal, description = `Goal: …\nConstraints: …\nNon-goals: …`, metadata `{"kind": "mission"}`.
Tell the user to approve the mission in the cadre dialog (key 1 opens it). Do not wait for it: go on with phase 4.

## Phase 4: build and test commands
Find how this project installs, builds and tests. Read, in this order (CI wins over prose): CI config (`ls .github/workflows` and the files there, or other CI files), task runners (`Makefile`, `justfile`, `package.json` scripts, `pyproject.toml`, `Cargo.toml`, `go.mod`), then `README` and `CONTRIBUTING`. `git ls-files` shows what exists.
Write the result into `.cadre/config.json` as `"packages"` (keep `branches`):
```
"packages": [
  { "root": ".", "setup": ["npm", "ci"], "checks": { "test": ["npm", "test"], "lint": ["npm", "run", "lint"] }, "tdd": { "paths": ["test/**"] } }
]
```
- One entry per package; `root` is relative to the project (`.` for a single package).
- `setup` is one command as an argument list (no shell string); `[]` when there is none.
- `checks` maps a name to one command each. Keep only checks that pass offline after `setup`; leave out anything that downloads at test time.
- `tdd.paths` are the globs of the test files.
You may run a check once to see that it works. Done when `.cadre/config.json` holds the list. cadre then runs every check on a clean checkout without network; if one fails, you get a message naming it: fix the command or leave the check out.

## Phase 5: changelog
`CHANGELOG.md` must follow Keep a Changelog 1.1.0. If it does not exist, Write exactly:
```
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
```
If it exists and a message names a line, fix only that heading.

## Phase 6: stop
Say in two or three lines what you set up. Tell the user what waits for them in the cadre dialog (key 1 opens it): the safety settings, which cadre writes once everything else passes and they confirm, and the mission if you drafted it in phase 3. Then stop. If the user's goal comes next, cadre sends it to you once the checks pass. cadre checks everything again on its own; if something is still open you get a message naming it.
