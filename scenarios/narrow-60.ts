import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('60 columns, replay at 50 min: the stacked layout with the replay header', view(62, { t: 50 }), { width: 60 })
