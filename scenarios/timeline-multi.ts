import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
// two workers at once, a reviewer, an explorer and a sync outage (40m-54m); the cursor sits at 50m (replay) so later spans are not drawn yet
export default sc('timeline: several agents, an offline span; replay at 50m (step with h/l, e returns to live)', view(62, { t: 50, ui: { tab: 'timeline', cfg: { v2: true, theme: 'dark' } } }))
