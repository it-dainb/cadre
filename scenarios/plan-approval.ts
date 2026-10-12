import { sc } from './base'
import { approval } from '../tests/fixtures/ui/epic'
export default sc('plan p3 waits for approval: the card over the sheet (a approve, x reject, c change)', approval(), { tab: 'card' })
