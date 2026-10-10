// OWNER: wave-6 sync (level-triggered tick: leases, adapters, heartbeats). Called from the one $.clock.every(5000) in register.ts.
import type { Host } from '../../types'

export const tick = async (h: Host): Promise<void> => {}
