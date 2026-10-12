import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('drive paused (budget): [WAIT] status, no running tasks drive on', view(62, { board: { drive: { on: true, level: 'epic', epicId: 'p3', turns: 40, costUsd: 12.5, startedAt: 1_000_000, paused: 'budget', heldBy: 'human' } } }))
