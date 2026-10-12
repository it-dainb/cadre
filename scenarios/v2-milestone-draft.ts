import { sc } from './base'
import { milestone } from '../tests/fixtures/ui/milestone'
export default sc('milestone m1: the roadmap of 4 epics waits for your approval', milestone('draft'), { tab: 'milestone' })
