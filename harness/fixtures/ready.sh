# overlay: cadre already set up in this repo (config, changelog, the task-tool gate, dev); the task store in .cadre/state is made on first use
. "$(dirname "$0")/_base.sh"
mkdir -p .cadre
echo '{ "units": [{"root":".","setup":["node","--version"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n' >CHANGELOG.md
printf '.cadre/state/\n' >>.git/info/exclude
mkdir -p .claude && echo '{ "env": { "CLAUDE_CODE_ENABLE_TASKS": "false", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }' >.claude/settings.local.json   # the task-tool gate init writes (main plans with cadre's tools)
printf '.claude/settings.local.json\n' >>.git/info/exclude
commit 'chore: cadre config'
git branch dev main
