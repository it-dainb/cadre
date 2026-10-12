import type { SnapTask } from '../types'
import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
const T = (i: number, state: SnapTask['state'], step: string, deps: string[], owner?: string): SnapTask => ({ id: `b${i}`, title: `Task number ${i} with a fairly long descriptive title`, type: i % 3 ? 'feat' : 'fix', kind: 'code', merges: true, state, step, phaseSince: 1_000_000 + (60 + i) * 60_000, owner, ctx: owner ? 10 + i * 6 : undefined, deps: deps.map(id => ({ id, type: 'blocks' as const })), flags: [] })
const ts = [T(1, 'done', '', []), T(2, 'done', '', []), T(3, 'done', '', ['b1']), T(4, 'done', '', ['b2']), T(5, 'active', 'worker', ['b3'], 'worker 1'), T(6, 'active', 'tester', ['b4'], 'tester 1'), T(7, 'review', 'reviewer', ['b3'], 'reviewer 1'), T(8, 'active', 'worker', ['b4'], 'worker 2'), T(9, 'todo', '', ['b5']), T(10, 'todo', '', ['b6', 'b7']), T(11, 'todo', '', ['b8']), T(12, 'todo', '', ['b9', 'b10'])]
export default sc('v2: big epic: 12 tasks, 4 agents', view(75, { ui: { cfg: { v2: true } }, board: { tasks: ts, decisions: [] } }))
