import { sc } from './base'
import { milestone } from '../tests/fixtures/ui/milestone'
export default sc('milestone m1: core epic e1 landed, e2 and e4 run in parallel, e3 waits on e2', milestone('parallel'), { tab: 'milestone' })
