# mcp-tools-for-memory — declined

Shipping memory as the 7 MCP tools spec §4.3 assumed (state 3 + memory 4).

**Why not.** Measured: each MCP tool costs ~341 tokens of schema on *every* subagent spawn, because tool schemas are rendered into the spawn prompt and the `ToolSearch` deferral does not reach subagents. Seven tools would be ~2,400 tokens per dispatch to buy what Read and Write already do.

Memory ships as plain markdown under `.cadre/memory/`. cadre has zero MCP servers, and that is a budget line, not an accident.
