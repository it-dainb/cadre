# Set up cadre in this project

You prepare the current project for cadre. Work through the phases in order. Run every command with Bash and start each Bash call with `cd "<project root>" &&` (your brief names the root); paths below are from the root. Edit files with Read, Edit and Write by full path under the root.
Rules: never make up a name or an email. Commit nothing except the first commit of a new repository. If a check names a `.cadre` folder below the project root, delete it.

## Phase 1: repository
1. `git rev-parse --git-dir`. No repository: `git init -b main`.
2. `git var GIT_AUTHOR_IDENT`. If it fails, ask the user (AskUserQuestion) for the name and email to commit with, then `git config --global user.name "<name>"` and `git config --global user.email "<email>"`.
3. `git rev-parse --verify HEAD`. No commit yet: `git add -A` then `git commit -m "chore: initial commit"`.
4. The main branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (drop the `origin/`), else `git branch --show-current`.
5. `git rev-parse --verify dev`. Missing: `git branch dev <main branch>`.
6. `.git/info/exclude` must hold the lines `.cadre/state/` and `.claude/settings.local.json`. Add only the missing ones.
7. `.cadre/config.json` must hold `{"branches": {"main": "<main branch>", "dev": "dev"}}`. Write it, or merge the key into the existing file with Edit.

## Phase 2: task store
Nothing to run: cadre creates it.

## Phase 3: mission (only when no goal comes next)
If your brief says the user's goal comes next, do nothing here: the mission goes into that goal's plan.
Otherwise ask the user (AskUserQuestion), in one round: the goal in one line, the constraints, the non-goals. Draft it with plan: `"kind": "mission"`, title = the goal, description = `Goal: …\nConstraints: …\nNon-goals: …`.
Tell the user to approve the mission in the cadre dialog (key 1 opens it). Do not wait for it: go on.

## Phase 4: build and test commands
Find how this project installs, builds and tests. Read, in this order (CI wins over prose): CI config, build tools (`Makefile`, `justfile`, `package.json`, `pyproject.toml`, `Cargo.toml`, Go modules), then `README` and `CONTRIBUTING`. `git ls-files` shows what exists.
Write the result into `.cadre/config.json` as `"units"` (keep `branches`):
```
"units": [
  { "root": ".", "checks": { "setup": ["npm", "ci"], "test": ["npm", "test"], "lint": ["npm", "run", "lint"] }, "tdd": { "paths": ["test/**"] } }
]
```
- One entry per unit (package, service or app; no submodule); leave out `checks.setup` when none.
- Pick each unit's `test` argv so it writes JUnit XML to `$CADRE_JUNIT` (`--junitxml=$CADRE_JUNIT`); install a reporter if needed.
- No tests: write the unit without `checks.test`.
- Not code (docs, analysis): ask the user whether to use the docs or analysis profile.
- `tdd.paths` are the globs of the test files.
If the user's goal comes next and a check fails because of the very problem that goal is about, keep it: cadre shows it as known red, and the goal's fix must turn it green. Never weaken or delete a test.

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
Say in two or three lines what you set up. Tell the user what waits in the cadre dialog (key 1): the safety settings, written once everything else passes and they confirm, and the mission if you drafted it. Then stop; cadre checks again and names anything still open.
