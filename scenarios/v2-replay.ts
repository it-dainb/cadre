import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('v2: replay at minute 50 of an epic that is further along; the band stays live', view(82, { t: 50, ui: { cfg: { v2: true } } }))
