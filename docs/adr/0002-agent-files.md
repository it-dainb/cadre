# ADR 0002: roles ship as plugin agent files

Status: accepted · Date: 2026-10-10 · Design: `design/DESIGN.md` v2.5 §4.1, §7, §16.1 A28 · Evidence: ADR 0001 S17, S43, S44, S45

## Decision
The four roles are plugin agent files `agents/{worker,tester,reviewer,explorer}.md` (engine names `cadre:<role>`), not `$.agent.register` specs.
- The worker, tester and reviewer files carry `experimental: {cacheTtl: 1h}`; the one-shot explorer keeps the 5 min default and `effort: low`.
- The files carry no `model`: admission sets one per spawn from `roles.<role>.tier` + `models`.
- `roles.<role>.effort` other than `default` is applied per request at `turn.step` (`next({...e, effort})`, TM-03), so the frontmatter is only the default.
- `reuse.cacheTtlMs` defaults to 3,600,000.
- Each file is byte-for-byte `agents/index.file(role)` (the `PROMPTS` body plus the `TOOLS` list). `scripts/budget.mjs` freezes the shipped files into `BUDGET.agents`, and `tests/agents.test.ts` pins them. To change a role, edit `agents/index.ts` or `prompts.ts`, regenerate the `.md` files, then run the budget script.
- Grep and Glob are absent from every list because 2.1.295 does not expose them (S45).

## Why
S43: `$.agent.register` accepted `experimental.cacheTtl: '1h'` and ignored it, so registered agents got the 5 min TTL. A plugin agent file with the same field got the 1h TTL.
S44: after a 5.5 min idle gap, a 5 min agent re-wrote about 6k tokens, while a 1h agent paid nothing extra. Resume, review and rework gaps are minutes to hours long.

## Consequences
- **`mcpAllow` limitation.** A file's `tools` list is static, and the engine exposes only the tools it names. `mcpAllow` (user-level S key) still extends the worker's L1 allowlist in `policy/guards.ts`, but the worker's model is never offered those MCP tools, so in v1 `mcpAllow` has no effect for workers. Workarounds, none adopted in v1:
  - list the MCP tool names in `agents/worker.md`, a static and repo-wide change that also changes the cached prefix;
  - drop `tools` from the worker file and rely on L1 alone, which costs a larger tool list and denied calls;
  - register a second worker spec at runtime when `mcpAllow` is non-empty, which loses the 1h TTL for that worker.
  Revisit if a later engine reads tool lists from config, or if `AgentSpec` gains `cacheTtl`.
- `roster()` and the `session.start` `$.agent.register` loop are gone. `spec()` remains for init stage 6, which renders sample briefs.
- The docs say 1h is ignored while the subscription is on usage credits; it applied on the M0 account. The ledger's `cachePct` shows the effect at runtime.
