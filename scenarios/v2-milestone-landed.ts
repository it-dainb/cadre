import { sc } from './base'
import { milestone } from '../tests/fixtures/ui/milestone'
export default sc('milestone m1: all 4 epics landed on the milestone branch, then m1 on dev', milestone('landed'), { tab: 'milestone' })
