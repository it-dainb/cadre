# profile-docs (S, `profile-docs` script, LANDED=1): the built-in docs profile end to end: writer -> critic -> landing; the goal lands as a docs commit, no tester, no check, no changelog entry (oracle: profile-docs)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
