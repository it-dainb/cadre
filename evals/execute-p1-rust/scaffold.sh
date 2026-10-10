#!/bin/bash
# Scaffold for the cadre eval (DESIGN §14 "Eval bootstrap"): runs in the empty sandbox cwd (home/cwd) via `plugin eval --scaffold`.
# Copies evals/fixtures/rust, writes a validated .cadre/config.json, git init + dev, and a pre-initialised .beads/ holding the APPROVED plan p-p1 (kit-only approval: the human step is simulated by status open + the epic branch).
set -euo pipefail
FIX="$(cd "$(dirname "$0")/../fixtures/rust" && pwd)"
cp -a "$FIX"/. .
mkdir -p .cadre
cat > .cadre/config.json <<'JSON'
{ "packages": [{"root":".","setup":["cargo","--version"],"checks":{"test":["cargo","test","--offline"]},"tdd":{"paths":["tests/**"]},"viewInclude":["Cargo.toml"]}] }
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
bd create --parent p-p1 -t feature -s draft --title='Add slug_max' --priority=2 \
  --acceptance=$'S1: Given the title "Hello, World!" When slug_max is called with max 5 Then it returns "hello"\nS2: Given the title "ab cd ef" When slug_max is called with max 3 Then it returns "ab" (no trailing dash)\nS3: Given any title When slug_max is called with a max at least as long as the slug Then it equals the slug' \
  --design='{"symbols":[{"name":"slug_max","kind":"function","params":["s: &str","max: usize"],"returns":"String","status":"new"}]}' \
  --metadata='{"cadre.package":".","cadre.changelog":"{\"category\":\"Added\",\"entry\":\"slug_max truncates a slug to a maximum length\"}"}' --stdin --allow-empty-description <<<'Cap a slug at max characters without leaving a trailing dash.' >/dev/null
bd update p-p1.1 -s open >/dev/null
git add -A && git commit -qm 'chore: beads gitignore'
git branch dev main
git branch epic/p-p1-slug-length-cap dev
[ -z "$(git status --short)" ] || { echo "scaffold left a dirty tree" >&2; git status --short >&2; exit 1; }
