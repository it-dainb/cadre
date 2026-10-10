// OWNER: wave-2 commands (/cadre <sub> -> dispatcher; status, approve sheet, open, config, drive...). Slot #8.
import type { Hook } from '../types'

// command.run {command:'cadre'}: queue only, never submit or spawn (P4, G6).
export const run: Hook = (h, e, next) => next(e)
