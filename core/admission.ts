// OWNER: wave-2 admission (agent.spawn: claim, rebind, review-spawn, lease staleness, recovery). Slot #3.
import type { Hook } from '../types'

// Judge before next; on spawn rejection release and rethrow. Return next(e)'s result (any other answer refuses the spawn, A1).
export const admit: Hook = (h, e, next) => next(e)
