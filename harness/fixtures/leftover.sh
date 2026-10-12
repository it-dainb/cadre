# overlay (user 1): an earlier attempt left a board pointer to a draft plan the task store cannot back,
# under the repo root and under kit/ (where a session whose shell had moved into kit/ saved it)
. "$(dirname "$0")/_base.sh"
for p in /work/run /work/run/kit; do
  seed "cadre:$(repokey $p):board" '{"epic":"p-32t","plan":{"id":"p-32t","slug":"earlier-goal","state":"draft","epicBranch":"epic/p-32t-earlier-goal"},"drive":{"on":false},"bind":{},"session":"gone-session","proc":"goneproc"}'
done
