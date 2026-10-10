#!/bin/bash
# Scaffold for the cadre eval (DESIGN §14 "Eval bootstrap"): runs in the empty sandbox cwd (home/cwd) via `plugin eval --scaffold`.
# Copies evals/fixtures/ts, writes a validated .cadre/config.json, git init + dev, and a pre-initialised .beads/ with no plan.
set -euo pipefail
FIX="$(cd "$(dirname "$0")/../fixtures/ts" && pwd)"
cp -a "$FIX"/. .
mkdir -p .cadre
cat > .cadre/config.json <<'JSON'
{ "packages": [{"root":".","setup":["node","--version"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }
JSON
# planted bug: slug() no longer trims leading/trailing dashes
sed -i "s|\.replace(/^-\|-\$/g, '')||" src/slug.mjs
grep -q "replace(/^-" src/slug.mjs && { echo "bug not planted" >&2; exit 1; }
cat > CHANGELOG.md <<'MD'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
MD
git init -q -b main
git config user.email eval@example.com; git config user.name eval
printf '.beads/\n' >> .git/info/exclude
git add -A && git commit -qm 'chore: initial commit'
bd init --non-interactive --skip-agents --skip-hooks -p p >/dev/null
bd config set status.custom draft:frozen,in_review:wip >/dev/null
bd config set types.custom refactor,docs,test,spike,decision,milestone,gate >/dev/null
bd config set events-journal true >/dev/null
git add -A && git commit -qm 'chore: beads gitignore'
git branch dev main
[ -z "$(git status --short)" ] || { echo "scaffold left a dirty tree" >&2; git status --short >&2; exit 1; }
