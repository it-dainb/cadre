#!/bin/bash
# Run inside the harness container (tui.sh VIA=ccr): start claude-code-router as a passthrough to Anthropic on the mounted OAuth login,
# the way its UI's "Claude Code login detected · Import" does it. Prints the gateway client key on stdout (Claude Code sends it as ANTHROPIC_AUTH_TOKEN).
set -e; trap 'echo "ccr-up failed at line $LINENO: $(tail -2 /tmp/ccr.log 2>/dev/null)" >&2' ERR
export CCR_WEB_AUTH_TOKEN=harness-$RANDOM$RANDOM
: >/tmp/ccr.log; ( setsid ccr serve --no-open --port 3458 >/tmp/ccr.log 2>&1 & )
# the management port is the first free one from --port: read it from the log
for i in $(seq 60); do U=$(grep -o 'http://127.0.0.1:[0-9]*' /tmp/ccr.log | head -1) && [ -n "$U" ] && break; sleep 1; done
rpc() { curl -sf -H 'content-type: application/json' -H "x-ccr-web-auth: $CCR_WEB_AUTH_TOKEN" "$U/api/ccr/rpc" -d "$1"; }
rpc '{"method":"getConfig"}' >/tmp/ccr-cfg.json
rpc '{"method":"importLocalAgentProvider","args":[{"id":"claude-code-api"}]}' >/tmp/ccr-imp.json || { echo "ccr: import of the Claude Code login failed: $(tail -3 /tmp/ccr.log)" >&2; exit 1; }
# every model id this Claude Code build may send (the gateway refuses an id its provider does not list)
grep -aoE '"claude-(opus|sonnet|haiku|fable)-[0-9][0-9a-z-]*"' "$(readlink -f "$(command -v claude)")" | sort -u | tr -d '"' >/tmp/ccr-models
node -e '
const fs = require("fs"), c = JSON.parse(fs.readFileSync("/tmp/ccr-cfg.json")).value, d = JSON.parse(fs.readFileSync("/tmp/ccr-imp.json")).value
const models = fs.readFileSync("/tmp/ccr-models", "utf8").split("\n").filter(Boolean)
c.Providers = [{ id: "claude", name: "claude", api_base_url: d.provider.baseUrl, api_key: d.provider.apiKey, type: "anthropic_messages", models }]
c.providerPlugins = [{ ...d.providerPlugins[0], providerName: "claude" }]
fs.writeFileSync("/tmp/ccr-save.json", JSON.stringify({ method: "saveConfig", args: [c] }))'
rpc @/tmp/ccr-save.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).value.APIKEY))'
rm -f /tmp/ccr-cfg.json /tmp/ccr-imp.json /tmp/ccr-save.json
for i in $(seq 30); do curl -s -o /dev/null http://127.0.0.1:3456/ && exit 0; sleep 1; done; echo "ccr gateway did not come up" >&2; exit 1
