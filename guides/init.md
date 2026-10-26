# Set up cadre in this project

You prepare the current project for cadre. Work through the phases in order. Run every command with Bash so the user sees it, and start every Bash call with `cd "<project root>" &&` (your brief names the root), so each path below is from the root. Edit files with Read, Edit and Write, by their full path under the root.
Rules: never make up a name or an email. Never commit anything except the first commit of a new repository. If a check names a `.cadre` folder below the project root, delete it.

## Phase 1: repository
1. `git rev-parse --git-dir`. No repository: `git init -b main`.
2. `git var GIT_AUTHOR_IDENT`. If it fails, ask the user with AskUserQuestion for the name and email to commit with, then `git config --global user.name "<name>"` and `git config --global user.email "<email>"`.
3. `git rev-parse --verify HEAD`. No commit yet: `git add -A` then `git commit -m "chore: initial commit"`.
4. The main branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (drop the `origin/`), else `git branch --show-current`.
5. `git rev-parse --verify dev`. Missing: `git branch dev <main branch>`.
6. `.git/info/exclude` must hold the lines `.cadre/state/` and `.claude/settings.local.json`. Add only the missing ones.
7. `.cadre/config.json` must hold `{"branches": {"main": "<main branch>", "dev": "dev"}}`. Create it with Write, or merge the key into the existing file with Edit.

## Phase 2: task store
Nothing to run: cadre creates it.

## Phase 3: mission (only when no goal comes next)
If your brief says the user's goal comes next, do nothing in this phase: no question and no plan call. The mission goes into that goal's plan later.
Otherwise ask the user with AskUserQuestion, in one round: the goal in one line, the constraints, the non-goals. Then draft it with plan: `"kind": "mission"`, title = the goal, description = `Goal: …\nConstraints: …\nNon-goals: …`.
Tell the user to approve the mission in the cadre dialog (key 1 opens it). Do not wait for it: go on with phase 4.

## Phase 4: build and test commands
Find how this project installs, builds and tests. Read, in this order (CI wins over prose): CI config (`ls .github/workflows` and the files there, or other CI files), task runners (`Makefile`, `justfile`, `package.json` scripts, `pyproject.toml`, `Cargo.toml`, `go.mod`), then `README` and `CONTRIBUTING`. `git ls-files` shows what exists.
Write the result into `.cadre/config.json` as `"units"` (keep `branches`):
```
"units": [
  { "root": ".", "setup": ["npm", "ci"], "runner": "junit", "checks": { "test": ["npm", "test"], "lint": ["npm", "run", "lint"] }, "tdd": { "paths": ["test/**"] } }
]
```
- One entry per unit (a package, service, app or submodule); `setup` is `[]` when there is none.
- `runner` is `"junit"` when the test command can write a JUnit report, else `"text"` (its output is read: red then means any failing exit plus the test names found in the output).
- `tdd.paths` are the globs of the test files.
If the user's goal comes next and a check fails because of the very problem that goal is about, keep the check as it is: cadre shows it to the user as known red, and the goal's fix must turn it green. Never weaken or delete a test. You may run a check once to see that it works.

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
Say in two or three lines what you set up. Tell the user what waits for them in the cadre dialog (key 1 opens it): the safety settings, which cadre writes once everything else passes and they confirm, and the mission if you drafted it in phase 3. Then stop. cadre checks everything again on its own; if something is still open you get a message naming it.
