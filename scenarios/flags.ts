import { sc } from './base'
import { view } from '../tests/fixtures/ui/epic'
import { flagDecision } from '../core/flags'
const F: Record<string, string> = { a2: 'conflict', a3: 'drift', a6: 'spec_change' }
const ds = [flagDecision('', 'git:dev:agent'), ...Object.entries(F).map(([id, f]) => flagDecision(id, f, id))].map(d => d!)
export default sc('four flags at once: git (CRIT), conflict, drift, spec_change; Needs you lists all four, 1 answers the oldest',
  view(75, { board: { decisions: ds }, tweak: ts => ts.map(t => (F[t.id] ? { ...t, state: 'active' as const, step: 'worker', flags: [F[t.id]] } : t)) }))
