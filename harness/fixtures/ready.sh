# overlay: cadre already set up in this repo (config, changelog, store in .cadre/store with cadre's statuses and types, dev), as evals/*/scaffold.sh do it
. "$(dirname "$0")/_base.sh"
mkdir -p .cadre
echo '{ "packages": [{"root":".","setup":["node","--version"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n' >CHANGELOG.md
printf '.cadre/store/\n.cadre/store.gate.lock\n' >>.git/info/exclude
commit 'chore: cadre config'
export BEADS_DIR=$PWD/.cadre/store
bd init --non-interactive --skip-agents --skip-hooks -p p >/dev/null
bd config set status.custom draft:frozen,in_review:wip >/dev/null; bd config set types.custom refactor,docs,test,spike,decision,milestone,gate >/dev/null; bd config set events-journal true >/dev/null
git add -A && { git diff --cached --quiet || git commit -qm 'chore: store'; }
git branch dev main
