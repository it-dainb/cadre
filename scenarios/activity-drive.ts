import { sc } from './base'
import { view, BASE, MIN } from '../tests/fixtures/ui/epic'
import type { CadreEvent } from '../types'
// activity with the drive's own lines: armed at approval, a paused gate, recorded yolo decisions
const ev = (m: number, type: string, data: Record<string, unknown>): CadreEvent => ({ schemaVersion: 1, seq: 0, at: BASE + m * MIN, type: type as CadreEvent['type'], actor: 'mod', severity: 'info', needsHuman: false, data })
const v = view(62, { ui: { tab: 'activity', cfg: { v2: true } } })
const ring = [...v.ring, ev(2, 'drive.status', { state: 'armed' }), ev(33, 'drive.decided', { kind: 'spec', text: 'accepted the spec change on a2: refresh tokens last 30 days', taskId: 'a2' }), ev(47, 'drive.status', { state: 'paused', reason: 'approve p3 release notes' }), ev(48, 'drive.status', { state: 'resumed' }), ev(56, 'drive.decided', { kind: 'question', text: 'answered a3: use the server clock', taskId: 'a3' })]
  .sort((a, b) => a.at - b.at).map((e, i) => ({ ...e, seq: i + 1 }))
export default sc('activity: plain sentences, newest first, with the drive pausing and the decisions it recorded', { ...v, ring })
