# underscore-id (run with CWD=my_lib REPO=my_lib LANDED=1 on fixtures/scripted/underscore): ids with `_` resolve; no explorer but main's one (oracle: underscore)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
landed() { while [ "$(left)" -gt 0 ]; do git -C "$D/work/$REPO" log --oneline dev 2>/dev/null | grep -qiE "${LAND_RE:-titlecase|title}" && { log "landed"; return 0; }; sleep 1; done; log "budget: not landed"; }   # the repo is in $REPO
