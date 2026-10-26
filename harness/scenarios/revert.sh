# revert-epic (S, LANDED=1, the default script; the `scripted/revert` overlay holds two decoy branches): the plan lands on dev, then the user types /cadre revert <epic>:
# the card dialog, the second confirm (the watcher answers both), the revert commits land on dev through the integrate path, the epic's recorded branches go (oracle: revert).
# revert.json = what the cell saw: the epic id, the files the epic added, the branch the store recorded for its task (put back before the revert), dev's tree after
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan; landed
W=$D/work; ug() { git -C "$W" -c user.name=user -c user.email=user@localhost "$@"; }
idle 120
M=$(ug log dev --merges -1 --format=%H); EPIC=$(ug log -1 --format=%s "$M" | sed -E 's/.*\(([^()]+)\)$/\1/')
FILES=$(ug diff --name-only "$M^1" "$M" | grep -v '^CHANGELOG.md$' | tr '\n' ' ')
SQ=$(ug log --no-merges -1 --format=%B "$M^2"); TID=$(sed -nE 's/^Refs: (.*)$/\1/p' <<<"$SQ"); TT=$(ug log --no-merges -1 --format=%s "$M^2")
BR=$(cd "$H/.." && node --experimental-transform-types --no-warnings -e 'import("./core/branches.ts").then(b => console.log(b.taskBranch(process.argv[1], process.argv[2], process.argv[3])))' "${TT%%:*}" "$TID" "${TT#*: }")
ug branch "$BR" dev; log "revert $EPIC: files [$FILES] task branch $BR"
send "/cadre revert $EPIC"
for _ in $(seq "$(left)"); do ug log dev --format=%s -1 | grep -q '^revert ' && break; sleep 1; done; log "revert landed"; idle 60
node -e 'const [epic, files, br, tree] = process.argv.slice(1); console.log(JSON.stringify({ epic, files: files.split(" ").filter(Boolean), taskBranch: br, devTree: tree.split("\n").filter(Boolean) }))' "$EPIC" "$FILES" "$BR" "$(ug ls-tree -r --name-only dev)" >"$O/revert.json"
