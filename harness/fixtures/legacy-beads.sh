# overlay: the older store layout, .beads/ at the repo root (setup offers the move to .cadre/store)
. "$(dirname "$0")/_base.sh"
bd init --non-interactive --skip-agents --skip-hooks -p p >/dev/null
bd config set status.custom draft:frozen,in_review:wip >/dev/null; bd config set types.custom refactor,docs,test,spike,decision,milestone,gate >/dev/null; bd config set events-journal true >/dev/null
bd create --type task --title 'an older task' >/dev/null
[ -d .git ] && commit 'chore: beads' || true
