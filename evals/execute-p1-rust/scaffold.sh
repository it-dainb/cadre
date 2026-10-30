#!/bin/bash
# Scaffold for the cadre eval (DESIGN §14 "Eval bootstrap"): runs in the empty sandbox cwd (home/cwd) via `plugin eval --scaffold`.
# Copies evals/fixtures/rust, writes a validated .cadre/config.json and the task-tool gate, git init + dev, and the APPROVED plan in .cadre/state (evals/seed.mjs: the human step is simulated by approving its tasks in the store, plus the epic branch).
set -euo pipefail
FIX="$(cd "$(dirname "$0")/../fixtures/rust" && pwd)"
cp -a "$FIX"/. .
mkdir -p .cadre
cat > .cadre/config.json <<'JSON'
{ "units": [{"root":".","setup":["cargo","--version"],"checks":{"test":["cargo","test","--offline"]},"tdd":{"paths":["tests/**"]},"viewInclude":["Cargo.toml"]}] }
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
printf '.cadre/state/\n.claude/settings.local.json\n' >> .git/info/exclude
mkdir -p .claude && echo '{ "env": { "CLAUDE_CODE_ENABLE_TASKS": "false", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }' > .claude/settings.local.json   # the task-tool gate init writes
git add -A && git commit -qm 'chore: initial commit'
git branch dev main
node --experimental-transform-types --no-warnings "$(dirname "$0")/../seed.mjs" >/dev/null <<'JSON'   # the approved plan, in cadre's task store (.cadre/state), and its epic branch
{
 "epic": {
  "title": "Slug length cap",
  "goal": "Let callers cap the length of a slug."
 },
 "tasks": [
  {
   "title": "Add slug_max",
   "description": "Cap a slug at max characters without leaving a trailing dash.",
   "type": "feature",
   "acceptance": "S1: Given the title \"Hello, World!\" When slug_max is called with max 5 Then it returns \"hello\"\nS2: Given the title \"ab cd ef\" When slug_max is called with max 3 Then it returns \"ab\" (no trailing dash)\nS3: Given any title When slug_max is called with a max at least as long as the slug Then it equals the slug",
   "design": "{\"items\":[{\"name\":\"slug_max\",\"kind\":\"function\",\"params\":[\"s: &str\",\"max: usize\"],\"returns\":\"String\",\"status\":\"new\"}]}",
   "meta": {
    "cadre.package": ".",
    "cadre.changelog": "{\"category\":\"Added\",\"entry\":\"slug_max truncates a slug to a maximum length\"}"
   }
  }
 ]
}
JSON
[ -z "$(git status --short)" ] || { echo "scaffold left a dirty tree" >&2; git status --short >&2; exit 1; }
