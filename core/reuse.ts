// OWNER: wave-3 reuse (resume queue + drain, drive, handoff, cost ledger, compaction). Slots #1 and #8 of DESIGN 2.2.
import type { Hook, Host } from '../types'

// #1 turn.complete: const r = await next(e) -> send this session's queued resumes -> on main, the drive continuation -> return r.
export const drain: Hook = (h, e, next) => next(e)
// turn.step usage per agentId (async generator hook; forward with yield*).
export async function* step(h: Host, e: any, next: (e: any) => any): AsyncGenerator<any, any, any> { return yield* next(e) }
// session.compact: answer {messages:[card,...recent]} without next (DESIGN 8.3).
export const compact: Hook = (h, e, next) => next(e)
