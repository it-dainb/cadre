import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('v2: containment degraded + sync offline: problem line on the band, ! on Doctor', view(62, { ui: { cfg: { v2: true } }, board: { containment: { state: 'degraded', unsandboxed: 2 }, sync: [{ target: 'pm', state: 'offline', pending: 2, at: 1_000_000 + 40 * 60_000 }] } }))
