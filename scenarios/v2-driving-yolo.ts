import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('v2: yolo drive running, a2 implementing, nothing needs you', view(62, { ui: { cfg: { v2: true } }, board: { drive: { on: true, level: 'epic', epicId: 'p3', turns: 31, costUsd: 4.7, startedAt: 1_000_000, mode: 'yolo' } as never } }))
