import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
const D = { on: true, level: 'epic' as const, epicId: 'p3', turns: 12, costUsd: 1.2, startedAt: 1_000_000 }
export default sc('v2: epic p3 mid-run, auto drive on, a6 flagged (Needs you)', view(82, { ui: { cfg: { v2: true } }, board: { drive: D } }))
