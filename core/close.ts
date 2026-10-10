// OWNER: wave-3 close (report -> review -> verdict -> close). Slot #2 of DESIGN 2.2.
import type { Hook } from '../types'

// #2 turn.complete observe: nudge / auto-report / release (3.4), L3 sweep, cost, checkpoints, main compaction trigger.
export const observe: Hook = (h, e, next) => next(e)
