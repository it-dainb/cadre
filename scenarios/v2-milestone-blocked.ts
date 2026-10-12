import { sc } from './base'
import { milestone } from '../tests/fixtures/ui/milestone'
export default sc('milestone m1: epic e2 stopped (red after one fix), e3 stops with it, e4 goes on', milestone('blocked'), { tab: 'milestone' })
