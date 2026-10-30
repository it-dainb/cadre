// The default profile (plan 2.11), grown slice by slice: S2 holds the check slots only. Data, JSON-serializable, no code.
import type { Profile } from '../types/profile'

export const checks = {
  test: { failExit: [1], network: false },
  setup: { network: true },
} as const satisfies Profile['checks']
