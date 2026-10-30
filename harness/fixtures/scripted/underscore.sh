# base: the repo in a folder with `_` (my_lib/; run with CWD=my_lib), cadre set up as by `single ready`
. "$(dirname "$0")/../_base.sh"
mkdir my_lib && cd my_lib && cp -a "$TS"/. . && gi
mkdir -p .cadre
echo '{ "units": [{"root":".","checks":{"setup":["node","--version"],"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n' >CHANGELOG.md
printf '.cadre/state/\n' >>.git/info/exclude
mkdir -p .claude && echo '{ "env": { "CLAUDE_CODE_ENABLE_TASKS": "false", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }' >.claude/settings.local.json   # the task-tool gate init writes
printf '.claude/settings.local.json\n' >>.git/info/exclude
commit 'chore: cadre config'
git branch dev main
