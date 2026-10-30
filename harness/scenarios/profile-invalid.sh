# profile-invalid (S, `single ready` + a refused .cadre/profile.json): cadre is dormant for the repo; the refusal line is shown at the start, /cadre profile names it, Doctor reports a failing row (its text: tests/doctor-coverage.test.ts); nothing is planned or started (oracle: profile-invalid)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
sleep 3; send "/cadre profile"; for _ in $(seq 15); do tui capture "$N" | grep -q "cadre stays off" && break; sleep 1; done; sleep 2
send "/cadre doctor"; for _ in $(seq 15); do tui capture "$N" | grep -q "doctor: [0-9]* fail" && break; sleep 1; done; sleep 2
