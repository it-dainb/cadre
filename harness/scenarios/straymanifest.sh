# setup-stray-manifest (S, the `stray` script, LANDED=1): the worker asks for the same install twice; the second changes no file and its reply says what the manifest holds (oracle: straymanifest)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan
