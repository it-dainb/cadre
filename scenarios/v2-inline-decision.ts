import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('v2: 60 columns inline, a short pane (12 rows), a decision pending: the one-line Needs-you form, footer visible', view(82, { ui: { cfg: { v2: true } } }), { width: 60, rows: 12 })
