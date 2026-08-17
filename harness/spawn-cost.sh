#!/bin/bash
# Measure subagent spawn cost with and without `tools:` scoping.
#
# `claude plugin details` cannot measure this — it reports always-on catalog cost
# and explicitly excludes MCP tool schemas ("resolved at runtime; not counted").
# The spawn tax lives precisely in those schemas.
#
# Instrument: Claude Code writes each subagent's own transcript to
#   ~/.claude/projects/<proj>/<session>/subagents/agent-*.jsonl
# whose first assistant message carries cache_creation_input_tokens — the exact
# size of that subagent's spawn prompt (system prompt + rendered tool schemas).
#
#   ./harness/spawn-cost.sh [agent-name]      default: code-reviewer
#
# Both arms run in identical fresh containers; the only difference is the
# agent's frontmatter, so the delta is attributable to tool surface alone.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="${1:-code-reviewer}"
IMAGE=cadre-harness:latest
CREDS="${CLAUDE_CREDS:-$HOME/.claude/.credentials.json}"
SCOPED_TOOLS="${SCOPED_TOOLS:-Read, Grep, Glob, Bash, Agent}"

[ -f "$CREDS" ] || { echo "no credentials at $CREDS" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" "$REPO/harness"

STAGE=$(mktemp -d)
cleanup() {
  docker rm -f spawn-a spawn-b >/dev/null 2>&1 || true
  docker run --rm -v "$STAGE":/s "$IMAGE" -c "rm -rf /s/a /s/b" >/dev/null 2>&1 || true
  rm -rf "$STAGE" 2>/dev/null || true
}
trap cleanup EXIT

# Two copies of the plugin, minus the heavy reference trees (`claude plugin
# install` copies everything, so excluding refs/ keeps each arm fast).
for arm in a b; do
  mkdir -p "$STAGE/$arm"
  tar -C "$REPO" --exclude=.git --exclude=refs --exclude=node_modules --exclude=dist -cf - . \
    | tar -C "$STAGE/$arm" -xf -
done

# Arm A (control): no tools: line -> agent inherits the full subagent tool pool.
sed -i '/^tools:/d' "$STAGE/a/agents/$AGENT.md"
# Arm B (scoped): exactly one tools: line, builtins only, zero MCP tools.
sed -i '/^tools:/d' "$STAGE/b/agents/$AGENT.md"
awk -v t="tools: $SCOPED_TOOLS" \
  'NR>1 && /^---$/ && !ins {print t; ins=1} {print}' \
  "$STAGE/b/agents/$AGENT.md" > "$STAGE/b/agents/$AGENT.md.tmp"
mv "$STAGE/b/agents/$AGENT.md.tmp" "$STAGE/b/agents/$AGENT.md"

echo "--- arm B frontmatter ---"; sed -n '1,8p' "$STAGE/b/agents/$AGENT.md"

run_arm() {
  local arm=$1 name=$2 work
  work=$(mktemp -d); chmod 777 "$work"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" \
    -v "$STAGE/$arm":/plugin:ro \
    -v "$CREDS":/home/node/.claude/.credentials.json:ro \
    -v "$work":/project \
    "$IMAGE" -c "sleep infinity" >/dev/null
  docker exec "$name" /usr/local/bin/seed.sh >/dev/null
  docker exec "$name" claude plugin marketplace add /plugin >/dev/null 2>&1
  docker exec "$name" claude plugin install oh-my-claudecode@omc >/dev/null 2>&1

  # Live interactive session via tmux (not -p), so this exercises the real path.
  docker exec "$name" bash -c "tmux new-session -d -s m -x 200 -y 50 'cd /project && claude'"
  sleep 20
  docker exec "$name" bash -c \
    "tmux send-keys -t m 'Spawn subagent_type oh-my-claudecode:$AGENT with prompt: Reply with exactly OK. Do not use any tools.' Enter; sleep 2; tmux send-keys -t m Enter"
  sleep 60

  docker exec "$name" bash -c '
    f=$(find /root/.claude/projects -path "*/subagents/agent-*.jsonl" | head -1)
    [ -n "$f" ] || { echo "NO_SUBAGENT_TRANSCRIPT"; exit 0; }
    jq -s "[.[] | select(.message.usage != null)][0].message.usage
           | {spawn_prompt_tokens: (.cache_creation_input_tokens + .cache_read_input_tokens),
              cache_creation: .cache_creation_input_tokens,
              cache_read: .cache_read_input_tokens,
              output: .output_tokens}" "$f"
  '
  rm -rf "$work" 2>/dev/null || true
}

echo "agent: $AGENT"
echo "arm A = control (no tools: line, full pool)"
echo "arm B = scoped ($SCOPED_TOOLS)"
echo
echo "--- arm A (control) ---"; run_arm a spawn-a
echo "--- arm B (scoped)  ---"; run_arm b spawn-b
