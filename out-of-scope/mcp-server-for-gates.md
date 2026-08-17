# mcp-server-for-gates — declined

`spec_write` / `plan_write` as MCP tools, per the original P3 plan.

**Why not.** Plan validation is a `PreToolUse` gate instead — same enforcement, rung 1 of the ladder, zero context cost, and no server to build, spawn or version. The Discovery-section check lives in `hooks/write-gate.mjs`.

Reconsider only if a gate ever needs state the hook cannot see.
