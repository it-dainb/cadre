import { sc } from './base'
import { view, BASE, MIN } from '../tests/fixtures/ui/epic'
import type { CadreEvent } from '../types'
const ev = (m: number, text: string): CadreEvent => ({ schemaVersion: 1, seq: 0, at: BASE + m * MIN, type: 'drive.decided' as CadreEvent['type'], actor: 'mod', severity: 'info', needsHuman: false, data: { kind: 'spec', text } })
const v = view(62, { board: { drive: { on: true, level: 'epic', epicId: 'p3', turns: 41, costUsd: 12.4, startedAt: BASE, mode: 'yolo', stopped: 'integration failed twice', maxTurns: 100, maxUsd: 20, maxMinutes: 240 } } })
const ring = [...v.ring, ev(33, 'accepted the spec change on a2: refresh tokens last 30 days'), ev(47, 'answered a3: use the server clock'), ev(56, 'rejected the spec change on a6: it widened the scope')].sort((a, b) => a.at - b.at).map((e, i) => ({ ...e, seq: i + 1 }))
export default sc('doctor: drive stopped (yolo) with the decisions it recorded, plus the checks', { ...v, ring, ui: { ...v.ui, tab: 'doctor', cfg: { v2: true }, 'doctor.rows': [['ok', 'git identity set'], ['warn', 'sync pm: not answering', '/cadre sync now'], ['crit', 'containment degraded: 2 unsandboxed tools', '/cadre init'], ['ok', 'no stale leases; 2 agent(s) bound']] } })
