// OWNER: wave-2 native (Task* {result} answers, field mapping, TaskList; tool.describe isDeferred:false).
import type { Hook } from '../types'

// Chained inside slot #5, after the guards: Task* tool.call answers for main.
export const answer: Hook = (h, e, next) => next(e)
// tool.describe: isDeferred:false and tightened descriptions (TP-15, TP-16); byte-stable.
export const describe: Hook = (h, e, next) => next(e)
