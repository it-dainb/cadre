# base: the repo in a folder with `_` (my_lib/; run with CWD=my_lib), cadre set up as by `single ready` but with the task prefix m_lib (ids m_lib-xxx.1)
. "$(dirname "$0")/../_base.sh"
mkdir my_lib && cd my_lib && cp -a "$TS"/. . && gi
mkdir -p .cadre
echo '{ "packages": [{"root":".","setup":["node","--version"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n' >CHANGELOG.md
printf '.cadre/store/\n.cadre/store.gate.lock\n' >>.git/info/exclude
commit 'chore: cadre config'
export BEADS_DIR=$PWD/.cadre/store
bd init --non-interactive --skip-agents --skip-hooks -p m_lib >/dev/null
bd config set status.custom draft:frozen,in_review:wip >/dev/null; bd config set types.custom refactor,docs,test,spike,decision,milestone,gate >/dev/null; bd config set events-journal true >/dev/null
git add -A && { git diff --cached --quiet || git commit -qm 'chore: store'; }
git branch dev main
