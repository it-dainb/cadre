// UI fixture: milestone m1 "user accounts" (ADR 0015), a core epic e1 and three epics on it: e2 signup → e3 login, e4 password reset. Four moments:
// draft (the roadmap waits for approval), parallel (e1 landed, e2 + e4 run, e3 waits on e2), blocked (e2 stopped, e3 stops with it, e4 goes on), landed (all four, then m1 on dev).
import type { CadreEvent, MEpic, Snapshot, SnapTask } from '../../../types'
import { emptySnapshot } from '../../../core/board'
import { CFG, type View } from '../../../ui/model'
import { BASE, MIN } from './epic'

export type Moment = 'draft' | 'parallel' | 'blocked' | 'landed'
const MSB = 'milestone/m1-user-accounts'
const EPICS: [id: string, title: string, deps: string[], size: number, core?: true][] = [['e1', 'Account model', [], 2, true], ['e2', 'Signup', ['e1'], 3], ['e3', 'Login', ['e2'], 3], ['e4', 'Password reset', ['e1'], 2]]
const TASKS: [id: string, title: string, epic: string][] = [['e1.1', 'User table', 'e1'], ['e1.2', 'Password hashing', 'e1'], ['e2.1', 'Signup form', 'e2'], ['e2.2', 'Email verification', 'e2'], ['e2.3', 'Welcome mail', 'e2'],
  ['e3.1', 'Login form', 'e3'], ['e3.2', 'Session cookie', 'e3'], ['e3.3', 'Login rate limit', 'e3'], ['e4.1', 'Reset token', 'e4'], ['e4.2', 'Reset form', 'e4']]
// per moment: each epic's state, each task's [state, step, owner] (absent = not planned yet)
const STATE: Record<Moment, Record<string, MEpic['state']>> = {
  draft: { e1: 'draft', e2: 'draft', e3: 'draft', e4: 'draft' }, parallel: { e1: 'landed', e2: 'running', e3: 'waiting', e4: 'running' },
  blocked: { e1: 'landed', e2: 'stopped', e3: 'stopped', e4: 'running' }, landed: { e1: 'landed', e2: 'landed', e3: 'landed', e4: 'landed' },
}
const RUN: Record<Moment, Record<string, [SnapTask['state'], string, string?]>> = {
  draft: {},
  parallel: { 'e1.1': ['done', 'merge'], 'e1.2': ['done', 'merge'], 'e2.1': ['done', 'merge'], 'e2.2': ['active', 'worker', 'worker 1'], 'e2.3': ['todo', ''], 'e4.1': ['review', 'reviewer', 'reviewer'], 'e4.2': ['todo', ''] },
  blocked: { 'e1.1': ['done', 'merge'], 'e1.2': ['done', 'merge'], 'e2.1': ['done', 'merge'], 'e2.2': ['done', 'merge'], 'e2.3': ['done', 'merge'], 'e4.1': ['done', 'merge'], 'e4.2': ['active', 'worker', 'worker 1'] },
  landed: Object.fromEntries(TASKS.map(([id]) => [id, ['done', 'merge']])),
}
const NOW: Record<Moment, number> = { draft: 4, parallel: 46, blocked: 80, landed: 140 }

export function milestone(m: Moment): View {
  const at = (n: number) => BASE + n * MIN, out: Omit<CadreEvent, 'seq'>[] = []
  const ev = (n: number, type: string, data: Record<string, unknown>, taskId?: string) => out.push({ schemaVersion: 1, at: at(n), type: type as CadreEvent['type'], actor: 'mod', severity: 'info', needsHuman: false, data, ...(taskId ? { taskId } : {}) })
  const epics: MEpic[] = EPICS.map(([id, title, deps, size, core]) => ({ id, title, deps, size, ...(core ? { core } : {}), branch: `epic/${id}-${title.toLowerCase().replace(/ /g, '-')}`, state: STATE[m][id],
    ...(m === 'blocked' && id === 'e2' ? { why: 'checks stayed red after one fix task' } : m === 'blocked' && id === 'e3' ? { why: 'waits on e2, which stopped' } : {}) }))
  const tasks: SnapTask[] = TASKS.filter(([id]) => RUN[m][id]).map(([id, title, epic], i) => { const [state, step, owner] = RUN[m][id]
    return { id, title, epic, type: 'feat', kind: 'code', merges: true, state, step, phaseSince: at(NOW[m] - 3 - i), deps: [], flags: [], ...(owner ? { owner, ctx: 30 + i * 7 } : {}) } })
  ev(2, 'approval.pending', { planId: 'm1', missing: [] })
  if (m !== 'draft') {
    ev(5, 'drive.decided', { kind: 'plan', text: 'plan e1 approved automatically for milestone m1' }); ev(26, 'plan.landed', { planId: 'e1', sha: 'a1b2c3d', on: MSB })
    ev(27, 'drive.decided', { kind: 'plan', text: 'plan e2 approved automatically for milestone m1' }); ev(28, 'drive.decided', { kind: 'plan', text: 'plan e4 approved automatically for milestone m1' })
    ev(40, 'agent.bound', { agentId: 'g1', taskId: 'e2.2', role: 'worker' }, 'e2.2'); ev(42, 'agent.bound', { agentId: 'g2', taskId: 'e4.1', role: 'reviewer', tier: 'light' }, 'e4.1')
  }
  if (m === 'blocked') { ev(70, 'check.ran', { taskId: 'e2', name: 'test', ok: false }, 'e2'); ev(72, 'flag.raised', { taskId: 'e2', flag: 'stopped' }, 'e2') }
  if (m === 'landed') {
    ev(60, 'plan.landed', { planId: 'e2', sha: 'b2', on: MSB }); ev(62, 'plan.landed', { planId: 'e4', sha: 'c3', on: MSB }); ev(63, 'drive.decided', { kind: 'plan', text: 'plan e3 approved automatically for milestone m1' })
    ev(110, 'plan.landed', { planId: 'e3', sha: 'd4', on: MSB }); ev(112, 'plan.landed', { planId: 'm1', sha: 'e5' })
  }
  const stopped = { id: 'flag:e2:stopped', kind: 'flag', title: 'epic e2 stopped', short: 'e2 stopped', hash: 'h', tab: 'epic', lines: ['Signup', 'checks stayed red after one fix task', 'Retry: the epic goes on. The epics that wait on it start after it lands.'], options: [{ key: 'r', label: 'Retry', verb: 'change', run: 'resolve e2 keep' }] }
  const road = { id: 'plan:m1', kind: 'plan', title: 'approve milestone m1', short: 'approve m1', tab: 'plan', hash: 'h', change: 'Change m1: ', lines: ['auto · milestone · 4 epics', 'e1 Account model (core) · e2 Signup after e1 · e3 Login after e2 · e4 Password reset after e1'],
    options: [{ key: 'a', label: 'Approve', verb: 'approve', run: 'approve m1' }, { key: 'x', label: 'Reject', verb: 'reject', run: 'reject m1' }] }
  const b: Snapshot = { ...emptySnapshot('repo'), seq: out.length, mission: 'Accounts', epic: 'm1', tasks,
    plan: { id: 'm1', slug: 'user-accounts', lane: 'milestone', mode: 'auto', epicBranch: MSB, epics, state: m === 'draft' ? 'draft' : m === 'landed' ? 'done-on-dev' : 'approved', ...(m === 'draft' ? {} : { approvedAt: at(3) }) },
    decisions: m === 'draft' ? [road] : m === 'blocked' ? [stopped] : [], approval: { planId: m === 'draft' ? 'm1' : null, missing: [] },
    drive: m === 'draft' || m === 'landed' ? { on: false, level: 'epic', epicId: 'm1', turns: 0, costUsd: 0, startedAt: null } : { on: true, level: 'epic', epicId: 'm1', turns: 24, costUsd: 3.1, startedAt: at(3), ...(m === 'blocked' ? { paused: 'epic e2 stopped' } : {}) },
    containment: { state: 'contained', unsandboxed: 0 }, cost: { tokens: 1, cachePct: 80 }, sync: [{ target: 'pm', state: 'ok', pending: 0, at: 0 }] } as Snapshot
  return { b, ring: out.map((e, i) => ({ ...e, seq: i + 1 })), sec: {}, ui: { tab: 'milestone' }, c: { ...CFG }, now: at(NOW[m]), sx: 'strict', t: null }
}
