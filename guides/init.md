# Set up cadre in this project

You prepare the current project for cadre. Work through the phases in order. Run every command with Bash in the project folder so the user sees it. Edit files with Read, Edit and Write.
Rules: change only the files this guide names (`.cadre/`, `.git/info/exclude`, `.claude/settings.local.json`, `CHANGELOG.md`). Never edit source files. Never make up a name or an email. Never commit anything except the first commit of a new repository.

## Phase 1: repository
1. `git rev-parse --git-dir`. No repository: `git init -b main`.
2. `git var GIT_AUTHOR_IDENT`. If it fails, ask the user with AskUserQuestion for the name and email to commit with, then `git config --global user.name "<name>"` and `git config --global user.email "<email>"`.
3. `git rev-parse --verify HEAD`. No commit yet: `git add -A` then `git commit -m "chore: initial commit"`.
4. The main branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (drop the `origin/`), else `git branch --show-current`.
5. `git rev-parse --verify dev`. Missing: `git branch dev <main branch>`.
6. `.git/info/exclude` must hold the lines `.beads/` and `.claude/settings.local.json`. Add only the missing ones (`printf '%s\n' ... >> .git/info/exclude`).
7. `.cadre/config.json` must hold `{"branches": {"main": "<main branch>", "dev": "dev"}}`. Create it with Write, or merge the key into the existing file with Edit.
Done when all seven hold.

## Phase 2: task store
Run, in the project folder:
```
bd init --non-interactive --init-if-missing --skip-agents --skip-hooks
bd config set status.custom draft:frozen,in_review:wip
bd config set types.custom refactor,docs,test,spike,decision,milestone,gate
bd config set events-journal true
```
Done when `bd config get events-journal` prints `true`.

## Phase 3: mission
Ask the user with AskUserQuestion, in one round: the goal in one line, the constraints, the non-goals. Then draft it with TaskCreate: subject = the goal, description = `Goal: …\nConstraints: …\nNon-goals: …`, metadata `{"kind": "mission"}`.
Tell the user to approve the mission on the cadre card. Do not wait for it: go on with phase 4.

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
Say in two or three lines what you set up. Tell the user that two things wait for them on the cadre card: the mission (if not approved yet) and the safety settings, which cadre writes once everything else passes and they confirm. Then stop. cadre checks everything again on its own; if something is still open you get a message naming it.
