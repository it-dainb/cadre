import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('v2: drive stopped by a bound; 2: resume', view(62, { ui: { cfg: { v2: true } }, board: { drive: { on: false, level: 'epic', epicId: 'p3', turns: 100, costUsd: 18.2, startedAt: 1_000_000, stopped: 'turn limit reached' } as never } }))
