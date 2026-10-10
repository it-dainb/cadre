// UI fixtures: the artifact's epic p3 (design/artifact/replay.js, 7 tasks) as human view + event ring. Times in minutes; `view` folds the ring up to `nowMin`.
import type { CadreEvent, Snapshot, SnapTask } from '../../../types'
import { emptySnapshot } from '../../../core/board'
import { type Cfg, CFG, type View, at } from '../../../ui/model'

export const MIN = 60_000, BASE = 1_000_000
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
      if (ph === 'report') { ev(m, 'task.transitioned', { taskId: s.id, from: st, to: 'done' }, { taskId: s.id }); st = 'done' }
      if (ph === 'impl' && m === 84) ev(m, 'flag.resolved', { taskId: s.id, flag: 'git:dev:agent' }, { taskId: s.id, actor: 'human' })
    }
  }
  ev(53, 'task.transitioned', { taskId: 'a5', from: 'todo', to: 'cancelled' }, { taskId: 'a5' }); ev(53, 'task.skipped', { taskId: 'a5', on: 'a3' }, { taskId: 'a5' })
  SPANS.forEach(([role, id, f, t], i) => { ev(f, 'agent.bound', { agentId: `g${i}`, taskId: id, role }, { agentId: `g${i}`, taskId: id }); ev(t, 'agent.unbound', { agentId: `g${i}`, reason: 'answer' }, { agentId: `g${i}` }) })
  ev(40, 'sync.state_changed', { target: 'pm', state: 'offline', at: BASE + 40 * MIN }, { actor: 'sync', severity: 'warn' }); ev(54, 'sync.state_changed', { target: 'pm', state: 'ok', at: BASE + 54 * MIN }, { actor: 'sync' })
  return out.sort((a, b) => a.at - b.at).map((e, i) => ({ ...e, seq: i + 1 }))
}
// the epic as of `nowMin`: tasks folded from the ring (same fold as replay), plan, mode, counters
export function view(nowMin: number, o: { t?: number | null; cfg?: Partial<Cfg>; ui?: Record<string, unknown>; code8?: string; board?: Partial<Snapshot>; tweak?: (ts: SnapTask[]) => SnapTask[] } = {}): View {
  const evs = ring().filter(e => e.at <= BASE + nowMin * MIN)
  const proto: Snapshot = { ...emptySnapshot('repo'), seq: evs.length, mission: 'Auth v2', epic: 'p3', tasks: SPECS.map(s => ({ id: s.id, title: s.title, type: s.type, kind: s.kind, merges: s.kind !== 'spike', state: 'todo', step: '', phaseSince: 0, deps: s.deps, flags: [] })),
    plan: { id: 'p3', slug: 'auth-login', state: nowMin >= 93 ? 'done-on-dev' : 'approved', epicBranch: 'epic/p3-auth-login', approvedAt: BASE },
    drive: { on: true, level: 'epic', epicId: 'p3', turns: 12, costUsd: 0, startedAt: BASE }, containment: { state: 'contained', unsandboxed: 0 }, cost: { tokens: 1, cachePct: 87 }, sync: [{ target: 'pm', state: 'ok', pending: 0, at: 0 }] }
  const folded = at({ b: proto, ring: evs, sec: {}, ui: {}, c: CFG, now: BASE + nowMin * MIN, sx: 'strict', t: BASE + nowMin * MIN })
  const tasks = folded.tasks.map(t => (t.id === 'a2' && t.state === 'active' ? { ...t, owner: 'worker 1' } : t))
  const b: Snapshot = { ...proto, ...o.board, tasks: o.board?.tasks ?? (o.tweak ? o.tweak(tasks) : tasks), plan: o.board?.plan ?? folded.plan }
  return { b, ring: evs, sec: o.code8 ? { approval: { planId: 'p3', code8: o.code8 } } : {}, ui: { ctx: 34, ...o.ui }, c: { ...CFG, ...o.cfg }, now: BASE + nowMin * MIN, sx: 'strict', t: o.t === undefined || o.t === null ? null : BASE + o.t * MIN }
}

// approval sheet data (human view `sheet`): 7 tasks, 12 scenarios, 3 NEW / 2 CHANGED / 4 same symbols
import type { SheetTask } from '../../../ui/sheet'
export const SHEET: SheetTask[] = [
  { id: 'a1', type: 'feat', scope: 'auth', title: 'Add login', package: 'api', tdd: 'required', changelog: 'Added "Login with email+pw"', scenarios: ['S1 Given a registered user When valid login Then a session is returned', 'S2 Given wrong pw When login Then AuthError'],
    contract: [{ sig: 'login(email: Email, pw: Secret) -> Session ! AuthError', status: 'new' }, { sig: 'Session.expiresAt: Instant', status: 'unchanged' }, { sig: 'authenticate(req: Request) -> User|null', status: 'changed', before: 'authenticate(req: Request) -> User' }] },
  { id: 'a2', type: 'feat', title: 'Session refresh', package: 'api', tdd: 'required', scenarios: ['S1 Given an expired token When refresh Then new token issued', 'S2 Given a revoked token When refresh Then RefreshError'], contract: [{ sig: 'refreshSession(token: Token) -> Session ! ExpiredError', status: 'new' }, { sig: 'Token.ttl: Duration', status: 'unchanged' }] },
  { id: 'a3', type: 'fix', title: 'Token clock skew', package: 'api', tdd: 'required', scenarios: ['S1 Given a token 30s in the future When validate Then accepted', 'S2 Given a token 5m in the future When validate Then rejected'], contract: [{ sig: 'validateToken(t: Token) -> Claims', status: 'changed', before: 'validateToken(t: Token) -> Claims|null' }, { sig: 'Clock.now() -> Instant', status: 'unchanged' }] },
  { id: 'a4', type: 'docs', title: 'README auth', package: 'web', tdd: 'none', scenarios: ['S1 Given the README When read Then login steps are listed'], contract: [] },
  { id: 'a5', type: 'fix', title: 'Rate-limit fallback', package: 'api', tdd: 'required', scenarios: ['S1 Given the limiter is down When login Then allow with a warning'], contract: [{ sig: 'Limiter.fallback() -> Policy', status: 'unchanged' }] },
  { id: 'a6', type: 'feat', title: 'Remember me', package: 'web', tdd: 'required', scenarios: ['S1 Given remember-me When login Then a 30d cookie', 'S2 Given no remember-me When login Then a session cookie', 'S3 Given a stolen cookie When used Then rejected'], contract: [{ sig: 'rememberMe(s: Session) -> Cookie', status: 'new' }] },
  { id: 'a7', type: 'chore', title: 'Spike: passkeys', tdd: 'none', scenarios: ['S1 Given the spike When done Then findings are filed'], contract: [] },
]
export const approval = (n = 62, code8 = 'ab12cd34'): View => view(n, { code8, board: { approval: { planId: 'p3', missing: [] }, plan: { id: 'p3', slug: 'auth-login', state: 'draft', epicBranch: 'epic/p3-auth-login' }, sheet: SHEET, drive: { on: false, level: 'epic', epicId: 'p3', turns: 0, costUsd: 0, startedAt: null, paused: 'approval' }, tasks: SPECS.map(x => ({ id: x.id, title: x.title, type: x.type, kind: x.kind, merges: true, state: 'todo' as const, step: '', phaseSince: 0, deps: x.deps, flags: [] })) } as Partial<Snapshot> })

// named render cases shared by the golden generator and tests/ui.test.ts
import { band } from '../../../ui/band'
import { pane } from '../../../ui/pane'
import { sheet, sheetSig } from '../../../ui/sheet'
import { dag } from '../../../ui/epic'
import { type Acts, T, txt } from '../../../ui/model'
export const NOOP: Acts = { go() {}, pick() {}, fill() {}, step() {} }
export const rtrim = (ls: string[]) => ls.map(l => l.trimEnd())
export const withStub = (ts: SnapTask[]): SnapTask[] => [...ts, { ...ts[0], id: 'a8', title: 'Ship docs', type: 'docs', kind: 'docs', state: 'todo', step: '', deps: [D('a1'), D('a6')] }]
export const CASES: Record<string, () => string[]> = {
  'epic stubs|118': () => txt(pane(view(62, { tweak: withStub }), 118, 40, NOOP).before).slice(0, 26),
  'band working|115': () => txt(band(view(62), 115, NOOP)),
  'band working|55': () => txt(band(view(62), 55, NOOP)),
  'band working ascii|115': () => txt(band(view(62, { cfg: { glyphs: 'ascii' } }), 115, NOOP)),
  'band attention|115': () => txt(band(approval(), 115, NOOP)),
  'band attention|55': () => txt(band(approval(), 55, NOOP)),
  'band critical|115': () => txt(band(view(82), 115, NOOP)),
  'band landed|115': () => txt(band(view(95, { ui: { ctx: 41, rel: 'v1.4.0' }, board: { cost: { tokens: 1, cachePct: 88 } } }), 115, NOOP)),
  'epic live wide|118': () => { const p = pane(view(62), 118, 40, NOOP); return [...txt(p.before), ...p.tl!.rows, ...txt(p.after)] },
  'epic replay stacked|58': () => { const p = pane(view(62, { t: 50 }), 58, 40, NOOP); return [...txt(p.before), ...p.tl!.rows, ...txt(p.after)] },
  'epic live wide ascii|118': () => { const v = view(62, { cfg: { glyphs: 'ascii' } }), p = pane(v, 118, 40, NOOP); return [...txt(p.before), ...p.tl!.rows.map(r => T(v.c, r)), ...txt(p.after)] },
  'sheet wide|116': () => txt(sheet(approval(), 116, NOOP)),
  'sheet narrow|56': () => txt(sheet(approval(), 56, NOOP)),
  'sheet amended|56': () => { const v = approval(), t = v.b as any; return txt(sheet({ ...v, sec: { approval: { planId: 'p3', code8: '5c1e09fa' } }, ui: { seen: { code: 'ab12cd34', sig: { ...sheetSig(v), a3: 'old' } } }, b: t }, 56, NOOP)).slice(0, 4) },
}
