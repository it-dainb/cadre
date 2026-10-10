// OWNER: wave-2 policy (L1 allowlists, fence, tool.check allow, session.send isolation, config.set guard). Slots #4, #5, #7, config.set.
import type { Hook } from '../types'

// Event-only judgement for the re-entry .catch (G2): a deny reason, or undefined to let the call through. Must not use $.
export const judge = (e: any): string | undefined => undefined
// #4 tool.check allow mirrors fence rule 2 (tester) and rule 3 (owner). Fail-closed answer is {decision:'deny'}.
export const check: Hook = (h, e, next) => next(e)
// #5 tool.call guards: L1 allowlist, fence, MCP pre-checks. Judge before next.
export const guard: Hook = (h, e, next) => next(e)
// #7 session.send: SendMessage naming another task id -> {isDelivered:false} (4.6).
export const send: Hook = (h, e, next) => next(e)
// config.set: refuse strictness changes while tasks run.
export const configSet: Hook = (h, e, next) => next(e)
