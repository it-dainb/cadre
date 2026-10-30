# profile-invalid (S, `single ready` + a refused .cadre/profile.json): cadre is dormant for the repo; /cadre doctor shows `repo profile invalid`, /cadre profile names it, nothing is planned or started (oracle: profile-invalid)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
sleep 3; send "/cadre doctor"; for _ in $(seq 20); do tui capture "$N" | grep -q "repo profile invalid" && break; sleep 1; done; sleep 2
send "/cadre profile"; for _ in $(seq 15); do tui capture "$N" | grep -q "cadre stays off" && break; sleep 1; done; sleep 2
