#!/bin/bash
# Run Claude Code 2.1.295 in the cadre-harness container. Args pass through to `claude`.
#   harness/run.sh -p "hi" --plugin-dir /work/spike --debug-file /out/x.log --model haiku
# Env: WORK=<host scratch dir mounted at /work/run (cwd)>, OUT=<host dir at /out>, SPIKE=<plugin dir at /work/spike>,
#      CADRE_SOURCE=marketplace (install cadre@cadre from GitHub in the container; omit --plugin-dir from args), CADRE_REF=<branch|tag>,
#      PROJECTS=<host dir for session transcripts> (default harness/state/projects), EXTRA_DOCKER="..." (extra docker flags), SHELL_MODE=1 (run bash instead of claude), HARNESS_NET=host|bridge
H=$(cd "$(dirname "$0")" && pwd); R=$(dirname "$H")
. "$H/check.sh"
CRED=${CRED:-$HOME/.claude/.credentials.json}
WORK=${WORK:-${TMPDIR:-/tmp}/cadre-harness/work}; OUT=${OUT:-$H/out}; SPIKE=${SPIKE:-$R}
mkdir -p "$OUT" "$WORK"
ENTRY=()
[ -n "$SHELL_MODE" ] && ENTRY=(--entrypoint bash)
if [ "$CADRE_SOURCE" = marketplace ] && [ -z "$SHELL_MODE" ]; then
  # ref syntax owner/repo#ref (verified: `@ref` also works). Installs into the container's ephemeral ~/.claude, then runs claude with the args.
  ENTRY=(--entrypoint bash); set -- -c 'claude plugin marketplace add "it-dainb/cadre${CADRE_REF:+#$CADRE_REF}" && claude plugin install cadre@cadre && exec claude "$@"' _ "$@"
  EXTRA_DOCKER="$EXTRA_DOCKER -e CADRE_REF"
fi
# seccomp/apparmor unconfined: bubblewrap (Claude sandbox + mod jails) needs user namespaces, which docker's default seccomp blocks.
exec docker run --rm -i --user "$(id -u):$(id -g)" \
  -e GIT_AUTHOR_NAME=cadre -e GIT_AUTHOR_EMAIL=cadre@localhost -e GIT_COMMITTER_NAME=cadre -e GIT_COMMITTER_EMAIL=cadre@localhost \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
  -v "${PROJECTS:-$H/state/projects}":/cchome/.claude/projects -v "$CRED":/cchome/.claude/.credentials.json \
  -v "$SPIKE":/work/spike -v "$WORK":/work/run -v "$OUT":/out \
  -w /work/run "${ENTRY[@]}" $EXTRA_DOCKER cadre-harness "$@"
