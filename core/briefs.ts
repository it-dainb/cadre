// OWNER: wave-2 briefs (role templates, deltas, main context line, resume card, id matcher). Slot #8.
import type { Hook } from '../types'

// prompt.submit: main context, diff-gated by viewHash (4.5).
export const context: Hook = (h, e, next) => next(e)
// prompt.attachment: {text:null} for todo_reminder/task_reminder (BT-23, PC-11).
export const attachment: Hook = (h, e, next) => next(e)
