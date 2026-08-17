#!/bin/bash
# Reproducible plugin cost measurement in a clean container.
#
#   ./harness/measure.sh            measure the current working tree
#   ./harness/measure.sh --shell    drop into the container instead
#   ./harness/measure.sh --tmux     attach a live claude session in tmux
#
# The plugin is mounted read-only and installed via the real CLI path, so this
# measures what a user would actually get — not the dev tree.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE=cadre-harness:latest
NAME=cadre-measure
CREDS="${CLAUDE_CREDS:-$HOME/.claude/.credentials.json}"
PLUGIN_ID="${PLUGIN_ID:-oh-my-claudecode@omc}"
# Point at a subdirectory to measure a plugin that lives inside the repo.
PLUGIN_DIR="${PLUGIN_DIR:-$REPO}"

[ -f "$CREDS" ] || { echo "no credentials at $CREDS (set CLAUDE_CREDS)" >&2; exit 1; }

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" "$REPO/harness"

docker rm -f "$NAME" >/dev/null 2>&1 || true
WORK=$(mktemp -d)
docker run -d --name "$NAME" \
  -v "$PLUGIN_DIR":/plugin:ro \
  -v "$CREDS":/home/node/.claude/.credentials.json:ro \
  -v "$WORK":/project \
  "$IMAGE" -c "sleep infinity" >/dev/null

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

docker exec "$NAME" /usr/local/bin/seed.sh >/dev/null

# Install through the real CLI path, so every run measures the current tree.
#
# `install` populates ~/.claude/plugins/cache, but for a local-path marketplace
# the hooks still execute from the mounted source: ${CLAUDE_PLUGIN_ROOT}
# resolves to /plugin, not the cache. Editing the cache copy does not change
# behaviour — proven by a control that neutered the cache copy and watched the
# gate keep firing.
docker exec "$NAME" claude plugin marketplace add /plugin >/dev/null 2>&1
docker exec "$NAME" claude plugin install "$PLUGIN_ID" >/dev/null 2>&1

# Installing is not loading. cadre 1.0.0 installed cleanly and then failed to
# load on a duplicate hooks declaration — every token number measured against
# it was really measuring a disabled plugin. Assert enabled before measuring.
# Strip ANSI first — the status glyph is colourised, so a literal match on
# "Status: ✔ enabled" fails against real output.
if ! docker exec "$NAME" claude plugin list 2>&1 \
     | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' | grep -qE 'Status:.*enabled'; then
  echo "FAIL — $PLUGIN_ID installed but is not enabled:" >&2
  docker exec "$NAME" claude plugin list 2>&1 | grep -E 'Status|Error' >&2
  exit 1
fi

case "${1:-}" in
  --shell) exec docker exec -it "$NAME" bash ;;
  --tmux)
    docker exec "$NAME" bash -c "tmux new-session -d -s t -x 200 -y 50 'cd /project && claude'"
    echo "live session running. attach with:"
    echo "  docker exec -it $NAME tmux attach -t t"
    trap - EXIT   # leave the container up for interactive use
    exit 0 ;;
esac

docker exec "$NAME" claude plugin details "$PLUGIN_ID"
