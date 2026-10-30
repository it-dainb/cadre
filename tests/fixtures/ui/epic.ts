// UI fixtures: the artifact's epic p3 (design/artifact/replay.js, 7 tasks) as human view + event ring. Times in minutes; `view` folds the ring up to `nowMin`.
import type { CadreEvent, Decision, Snapshot, SnapTask } from '../../../types'
import { emptySnapshot } from '../../../core/board'
import { flagDecision } from '../../../core/flags'
import { type Acts, type Cfg, CFG, type View, at } from '../../../ui/model'

export const MIN = 60_000, BASE = 1_000_000
// what core/dispatch.redraw asks for a plan (same shape)
export const planDec = (n = 7): Decision => ({ id: 'plan:p3', kind: 'plan', title: 'approve plan p3', short: 'approve p3', tab: 'plan', hash: 'h1', lines: [`${n} tasks · 12 scenarios`], change: 'Change p3: ',
  options: [{ key: 'a', label: 'Approve', verb: 'approve', run: 'approve p3' }, { key: 'x', label: 'Reject', verb: 'reject', run: 'reject p3 rejected in the dialog' }] })
type Spec = { id: string; title: string; type: string; kind: SnapTask['kind']; deps: SnapTask['deps']; ph: [number, string][] }
const D = (id: string, type: SnapTask['deps'][0]['type'] = 'blocks') => ({ id, type })
export const SPECS: Spec[] = [
  { id: 'a1', title: 'Add login', type: 'feat', kind: 'code', deps: [], ph: [[3, 'spec'], [9, 'red'], [11, 'impl'], [24, 'green'], [26, 'review'], [31, 'done']] },
  { id: 'a2', title: 'Session refresh', type: 'feat', kind: 'code', deps: [D('a1')], ph: [[32, 'spec'], [37, 'red'], [39, 'impl'], [52, 'green'], [54, 'review'], [58, 'impl'], [64, 'green'], [66, 'review'], [70, 'done']] },
  { id: 'a3', title: 'Token clock skew', type: 'fix', kind: 'code', deps: [D('a1')], ph: [[32, 'spec'], [35, 'red'], [37, 'impl'], [46, 'green'], [48, 'review'], [53, 'done']] },
  { id: 'a4', title: 'README auth', type: 'docs', kind: 'docs', deps: [], ph: [[5, 'impl'], [14, 'review'], [18, 'done']] },
  { id: 'a5', title: 'Rate-limit fallback', type: 'fix', kind: 'code', deps: [D('a3', 'conditional-blocks')], ph: [] },
  { id: 'a6', title: 'Remember me', type: 'feat', kind: 'code', deps: [D('a2'), D('a3')], ph: [[71, 'spec'], [75, 'red'], [77, 'impl'], [81, 'flag'], [84, 'impl'], [87, 'green'], [88, 'review'], [91, 'done']] },
  { id: 'a7', title: 'Spike: passkeys', type: 'spike', kind: 'spike', deps: [], ph: [[6, 'explore'], [16, 'report']] },
]
const STEP: Record<string, string> = { spec: 'tester', red: 'red', impl: 'worker', green: 'green', review: 'reviewer', explore: 'explorer', report: 'report' }
const SPANS: [string, string, number, number][] = [   // role, task, from, to
  ['tester', 'a1', 3, 9], ['worker', 'a1', 11, 24], ['reviewer', 'a1', 26, 31], ['worker', 'a4', 5, 14], ['reviewer', 'a4', 14, 18], ['explorer', 'a7', 6, 16],
  ['tester', 'a2', 32, 37], ['tester', 'a3', 37, 40], ['worker', 'a2', 39, 52], ['worker', 'a3', 40, 46], ['reviewer', 'a3', 48, 53], ['reviewer', 'a2', 54, 58],
  ['worker', 'a2', 58, 64], ['reviewer', 'a2', 66, 70], ['tester', 'a6', 71, 75], ['worker', 'a6', 77, 87], ['reviewer', 'a6', 88, 91],
]
export function ring(): CadreEvent[] {
  const out: Omit<CadreEvent, 'seq'>[] = []
  const ev = (m: number, type: CadreEvent['type'], data: Record<string, unknown>, o: Partial<CadreEvent> = {}) => out.push({ schemaVersion: 1, at: BASE + m * MIN, type, actor: 'mod', severity: 'info', needsHuman: false, data, ...o })
  ev(1, 'approval.pending', { planId: 'p3', missing: [] }, { needsHuman: true })
  for (const s of SPECS) {
    let st = 'todo', step = ''
    for (const [m, ph] of s.ph) {
      if (ph === 'flag') { ev(m, 'flag.raised', { taskId: s.id, flag: 'git:dev:agent' }, { taskId: s.id, severity: 'warn', needsHuman: true }); continue }
      if (ph === 'done') { ev(m, 'task.transitioned', { taskId: s.id, from: st, to: 'done' }, { taskId: s.id }); st = 'done'; continue }
      const nst = ph === 'review' ? 'review' : 'active', nstep = STEP[ph]
      if (st !== nst) ev(m, 'task.transitioned', { taskId: s.id, from: st, to: nst }, { taskId: s.id })
      if (step !== nstep) ev(m, 'task.phase_changed', { taskId: s.id, from: step, to: nstep }, { taskId: s.id })
      st = nst; step = nstep
      if (ph === 'report') { ev(m, 'task.transitioned', { taskId: s.id, from: st, to: 'done', cites: 4 }, { taskId: s.id }); st = 'done' }
      if (ph === 'impl' && m === 84) ev(m, 'flag.resolved', { taskId: s.id, flag: 'git:dev:agent' }, { taskId: s.id, actor: 'human' })
    }
  }
  ev(9, 'check.ran', { taskId: 'a1', name: 'test', phase: 'red', ok: true, failing: 3 }, { taskId: 'a1' }); ev(24, 'check.ran', { taskId: 'a1', name: 'test', phase: 'green', ok: true, secs: 41 }, { taskId: 'a1' })
  ev(53, 'task.transitioned', { taskId: 'a5', from: 'todo', to: 'cancelled' }, { taskId: 'a5' }); ev(53, 'task.skipped', { taskId: 'a5', on: 'a3' }, { taskId: 'a5' })
  SPANS.forEach(([role, id, f, t], i) => { ev(f, 'agent.bound', { agentId: `g${i}`, taskId: id, role }, { agentId: `g${i}`, taskId: id }); ev(t, 'agent.unbound', { agentId: `g${i}`, reason: 'answer' }, { agentId: `g${i}` }) })
  ev(40, 'sync.state_changed', { target: 'pm', state: 'offline', at: BASE + 40 * MIN, pending: 2 }, { actor: 'sync', severity: 'warn' }); ev(54, 'sync.state_changed', { target: 'pm', state: 'ok', at: BASE + 54 * MIN, conflicts: 1 }, { actor: 'sync' })
  return out.sort((a, b) => a.at - b.at).map((e, i) => ({ ...e, seq: i + 1 }))
}
// the epic as of `nowMin`: tasks folded from the ring (same fold as replay), plan, mode, counters
export function view(nowMin: number, o: { t?: number | null; cfg?: Partial<Cfg>; ui?: Record<string, unknown>; board?: Partial<Snapshot>; tweak?: (ts: SnapTask[]) => SnapTask[] } = {}): View {
  const evs = ring().filter(e => e.at <= BASE + nowMin * MIN)
  const proto: Snapshot = { ...emptySnapshot('repo'), seq: evs.length, mission: 'Auth v2', epic: 'p3', tasks: SPECS.map(s => ({ id: s.id, title: s.title, type: s.type, kind: s.kind, merges: s.kind !== 'spike', state: 'todo', step: '', phaseSince: 0, deps: s.deps, flags: [] })),
    plan: { id: 'p3', slug: 'auth-login', state: nowMin >= 93 ? 'done-on-dev' : 'approved', epicBranch: 'epic/p3-auth-login', approvedAt: BASE },
    drive: { on: true, level: 'epic', epicId: 'p3', turns: 12, costUsd: 0, startedAt: BASE }, containment: { state: 'contained', unsandboxed: 0 }, cost: { tokens: 1, cachePct: 87 }, sync: [{ target: 'pm', state: 'ok', pending: 0, at: 0 }] }
  const folded = at({ b: proto, ring: evs, sec: {}, ui: {}, c: CFG, now: BASE + nowMin * MIN, sx: 'strict', t: BASE + nowMin * MIN })
  const tasks = folded.tasks.map(t => (t.id === 'a2' && t.state === 'active' ? { ...t, owner: 'worker 1', ctx: 41 } : t))
  const flagged = folded.tasks.flatMap(t => t.flags.map(f => flagDecision(t.id, f, t.title))).filter((d): d is Decision => !!d)
  const b: Snapshot = { ...proto, decisions: flagged, ...o.board, tasks: o.board?.tasks ?? (o.tweak ? o.tweak(tasks) : tasks), plan: o.board?.plan ?? folded.plan }
  return { b, ring: evs, sec: {}, ui: { ctx: 34, ...o.ui }, c: { ...CFG, ...o.cfg }, now: BASE + nowMin * MIN, sx: 'strict', t: o.t === undefined || o.t === null ? null : BASE + o.t * MIN }
}

export const approval = (n = 62): View => view(n, { board: { decisions: [planDec()], approval: { planId: 'p3', missing: [] }, plan: { id: 'p3', slug: 'auth-login', state: 'draft', epicBranch: 'epic/p3-auth-login' }, drive: { on: false, level: 'epic', epicId: 'p3', turns: 0, costUsd: 0, startedAt: null, paused: 'approval' }, tasks: SPECS.map(x => ({ id: x.id, title: x.title, type: x.type, kind: x.kind, merges: true, state: 'todo' as const, step: '', phaseSince: 0, deps: x.deps, flags: [] })) } as Partial<Snapshot> })

export const NOOP: Acts = { go() {}, pick() {}, answer() {}, step() {} }
