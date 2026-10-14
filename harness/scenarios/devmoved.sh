# dev-moved (S, the `slow` script, LANDED=1): while the worker runs, the user checks out dev and commits a file there; after the landing,
# the landing waits for the user's checkout and the watcher answers its dialog (Land). devmoved.json says what became of the user's commit and checkout (oracle: devmoved)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
W=$D/work; ug() { git -C "$W" -c user.name=user -c user.email=user@localhost "$@"; }
if until_debug 'SCRIPTED step agent=\S+ who=worker index=0'; then
  ug checkout -q dev && echo 'a note the user keeps' >"$W/USER.md" && ug add USER.md && ug commit -qm 'docs: user note'
  SHA=$(ug rev-parse HEAD); SUM=$(sha256sum <"$W/USER.md" | cut -c1-16); log "user commit $SHA on dev"
  landed
  node -e 'const [sha, sum, onDev, reach, head, st, file] = process.argv.slice(1); console.log(JSON.stringify({ sha, sum, onDev, reachable: reach === "0", head, status: st, file }))' \
    "$SHA" "$SUM" "$(ug show dev:USER.md 2>/dev/null | sha256sum | cut -c1-16)" "$(ug merge-base --is-ancestor "$SHA" dev; echo $?)" "$(ug symbolic-ref --short HEAD)" "$(ug status --porcelain | tr '\n' ';')" "$(sha256sum <"$W/USER.md" | cut -c1-16)" >"$O/devmoved.json"
fi
