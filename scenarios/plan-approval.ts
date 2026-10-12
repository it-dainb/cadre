import { sc } from './base'
import { approval } from '../tests/fixtures/ui/epic'
export default sc('plan p3 waits for approval: Needs you on top, 1 opens the dialog (Approve, Reject; typed text = a change)', approval())
