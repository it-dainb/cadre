#!/bin/bash
# Scaffold for the cadre eval (DESIGN §14 "Eval bootstrap"): runs in the empty sandbox cwd (home/cwd) via `plugin eval --scaffold`.
# Copies evals/fixtures/ts, writes a validated .cadre/config.json, git init + dev, and a pre-initialised .beads/ holding the APPROVED plan p-p1 (kit-only approval: the human step is simulated by status open + the epic branch).
set -euo pipefail
FIX="$(cd "$(dirname "$0")/../fixtures/ts" && pwd)"
cp -a "$FIX"/. .
mkdir -p .cadre
cat > .cadre/config.json <<'JSON'
{ "packages": [{"root":".","setup":["node","--version"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }
JSON
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
bd create --id p-p1 -t epic -s draft --title='Slug length cap' --stdin --allow-empty-description <<<'Let callers cap the length of a slug.' >/dev/null
bd create --parent p-p1 -t feature -s draft --title='Add slugMax' --priority=2 \
  --acceptance=$'S1: Given the title "Hello, World!" When slugMax is called with max 5 Then it returns "hello"\nS2: Given the title "ab cd ef" When slugMax is called with max 3 Then it returns "ab" (no trailing dash)\nS3: Given any title When slugMax is called with a max at least as long as the slug Then it equals the slug' \
  --design='{"symbols":[{"name":"slugMax","kind":"function","params":["s: string","max: number"],"returns":"string","errors":["RangeError(\"max must be a positive integer\") when max is not a positive integer","RangeError(\"max too large\") when max > 255","TypeError(\"s must be a string\") when s is null, undefined or not a string","RangeError(\"max must be a positive integer\") also for NaN, Infinity and negative zero","never throws for an all-punctuation title: returns the empty string"],"status":"new"}]}' \
  --metadata='{"cadre.package":".","cadre.changelog":"{\"category\":\"Added\",\"entry\":\"slugMax truncates a slug to a maximum length\"}"}' --stdin --allow-empty-description <<<'Cap a slug at max characters without leaving a trailing dash.' >/dev/null
bd update p-p1.1 -s open >/dev/null
git add -A && git commit -qm 'chore: beads gitignore'
git branch dev main
git branch epic/p-p1-slug-length-cap dev
[ -z "$(git status --short)" ] || { echo "scaffold left a dirty tree" >&2; git status --short >&2; exit 1; }
