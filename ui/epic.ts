// Epic view (UI-DESIGN 5.5, 6.2-6.4): DAG canvas (depth columns, typed edge grid, nodes with pipeline strip + flash, rail), detail strip, 6-row log, stacked list.
import type { CadreEvent, Plan, SnapTask } from '../types'
import { type Acts, type Cfg, type Line, type View, L, S, T, ago, at, col, cols, cut, fit, gl, kindOf, marks, stepsOf, t0, tg, word } from './model'
import { levelOf } from './notify'
import { abbr, laneOf, spansOf } from './timeline'

const W = 18, STRIDE = 23, ROWS = 6
const LIGHT = ' │─└││┌├─┘─┴┐┤┬┼', HEAVY = ' ┃━┗┃┃┏┣━┛━┻┓┫┳╋'   // index = N1 E2 S4 W8
const BORDER = { n: '┌─┐│└┘', s: '┏━┓┃┗┛', f: '╔═╗║╚╝' }
type Cell = { m: number; s?: number; d?: number; a?: string }   // direction mask; weight 3 live, 2 pending, 1 conditional: s = out of a source (widest wins), d = into a target (weakest wins); arrow override

function node(t: SnapTask, all: SnapTask[], c: Cfg, sel: boolean, flash: boolean): string[] {
  const k = kindOf(t, all), tag = `${tg(k)}${gl(c, k)}`, b = BORDER[flash ? 'f' : sel ? 's' : 'n'], wd = word(t, all)
  const body = [fit(`${t.id} ${t.type}`, 16 - tag.length) + tag, fit(t.title, 16), fit(flash ? `» ${wd} «` : `${marks(t).join('')} ${wd}`, 16)]
  return [b[0] + b[1].repeat(16) + b[2], ...body.map(x => b[3] + x + b[3]), b[4] + b[1].repeat(16) + b[5]]
}
function railTag(p: Plan, i: number): ReturnType<typeof kindOf> {
  const landed = p.state === 'done-on-dev' || p.state === 'released'
  return i === 0 ? (landed ? 'ok' : p.state === 'blocked' ? 'crit' : 'run') : i === 1 ? (landed ? 'ok' : p.state === 'integrating' ? 'run' : 'wait') : (p.state === 'released' ? 'ok' : 'wait')
}
const rail = (p: Plan, c: Cfg, rel?: unknown) => [(p.epicBranch || `epic/${p.id}`).replace(/-.*$/, ''), 'dev', p.released ? `main ${p.released.version}` : rel ? `main ${rel}` : 'main'].map((n, i) => ({ n, k: railTag(p, i), t: `${tg(railTag(p, i))}${gl(c, railTag(p, i))}` }))

// DAG as segments: gutters plain, nodes colored by tag, each node's id row a Button (engine focus ring: Up/Down/Enter)
export function dag(v: View, sel: string, flash: string[], a: Acts): Line[] {
  const b = at(v), ts = b.tasks, cs = cols(ts), c = v.c, h = Math.max(1, ...cs.map(x => x.length)) * ROWS - 1
  const rx = cs.length * STRIDE - 3, rl = b.plan ? rail(b.plan, c, v.ui.rel) : []
  const width = rx + (rl.length ? 14 : 0), grid: string[][] = Array.from({ length: Math.max(h, rl.length * ROWS - 2) }, () => Array(width).fill(' '))
  const own: (string | null)[][] = grid.map(r => r.map(() => null)), pos = new Map<string, [number, number]>(), cells = new Map<string, Cell>()
  cs.forEach((col, x) => col.forEach((t, y) => {
    pos.set(t.id, [x * STRIDE, y * ROWS])
    node(t, ts, c, sel === t.id, flash.includes(t.id)).forEach((s, r) => [...s].forEach((ch, i) => { grid[y * ROWS + r][x * STRIDE + i] = ch; own[y * ROWS + r][x * STRIDE + i] = t.id }))
  }))
  const put = (x: number, y: number, m: number, w: number, r: 's' | 'd', arrow?: string) => { const o = cells.get(`${x},${y}`); cells.set(`${x},${y}`, { m: (o?.m ?? 0) | m, s: r === 's' ? Math.max(o?.s ?? 0, w) : o?.s, d: r === 'd' ? Math.min(o?.d ?? 9, w) : o?.d, a: arrow ?? o?.a }) }
  const stubs: [number, number, string, number][] = []
  for (const t of ts) for (const d of t.deps) {
    const u = pos.get(d.id), p = pos.get(t.id); if (!u || !p || p[0] <= u[0]) continue
    if (p[0] - u[0] !== STRIDE) { stubs.push([u[0] + W, u[1] + 3, `↷${t.id}`, 0], [p[0] - 5, p[1] + 3, `${d.id}↷`, 1]); continue }   // non-adjacent: a ↷ stub marker on both ends, around the gutter's vertical (x0+2)
    const w = d.type === 'conditional-blocks' ? 1 : ts.find(x => x.id === d.id)?.state === 'done' ? 3 : 2, ya = u[1] + 2, yb = p[1] + 2, xr = u[0] + W, vx = xr + 2, xl = p[0] - 1
    for (let x = xr; x < vx; x++) put(x, ya, 10, w, 's')
    put(vx, ya, 8 | (yb > ya ? 4 : yb < ya ? 1 : 2), w, 's')
    for (let y = Math.min(ya, yb) + 1; y < Math.max(ya, yb); y++) put(vx, y, 5, w, 'd')
    if (yb !== ya) put(vx, yb, 2 | (yb > ya ? 1 : 4), w, 'd')
    for (let x = vx + 1; x < xl; x++) put(x, yb, 10, w, 'd')
    put(xl, yb, 10, w, 'd', w === 1 ? '▷' : '▶')
  }
  for (const [k, e] of cells) { const [x, y] = k.split(',').map(Number); const w = e.s ?? e.d; grid[y][x] = e.a ?? (w === 1 && (e.m === 10 || e.m === 5) ? (e.m === 10 ? '┄' : '┆') : (w === 3 ? HEAVY : LIGHT)[e.m]) }
  for (const [x, y, s, end] of stubs) {
    const free = [x, x + 1, x + 3, x + 4], cs = [...s].slice(0, 4), at0 = end ? 4 - cs.length : 0
    cs.forEach((ch, i) => { const f = free[at0 + i]; if (grid[y][f] === ' ') grid[y][f] = ch })
  }
  rl.forEach((r, i) => {
    const y = i * ROWS, ins = (s: string, row: number) => [...s].forEach((ch, j) => { grid[y + row][rx + j] = ch })
    const mid = (s: string) => `│${s.padStart(Math.floor((12 + s.length) / 2)).padEnd(12)}│`
    ins('╭' + '─'.repeat(12) + '╮', 0); ins(mid(cut(r.n, 12)), 1); ins(mid(r.t), 2); ins('╰' + '─'.repeat(12) + '╯', 3)
    if (i < rl.length - 1) { grid[y + 4][rx + 7] = '│'; grid[y + 5][rx + 7] = '▼' }
    for (let rr = 0; rr < 4; rr++) for (let j = 0; j < 14; j++) own[y + rr][rx + j] = `rail:${i}`
  })
  return grid.map((row, y) => {
    const out: Line = []
    for (let x = 0; x < width;) {
      const o = own[y][x]; let e = x; while (e < width && own[y][e] === o) e++
      const s = T(c, row.slice(x, e).join('')), t = o && !o.startsWith('rail') ? ts.find(q => q.id === o) : undefined
      out.push(S(s, t ? col(kindOf(t, ts)) : o ? col(rl[+o.slice(5)].k) : undefined, t && y % ROWS === 1 ? { k: `n:${t.id}`, p: () => a.pick(t.id) } : {}))
      x = e
    }
    return out
  })
}

export function evText(ev: CadreEvent, v: View): string {
  const d = ev.data, id = ev.taskId ?? String(d.taskId ?? ''), c = v.c, ts = v.b.tasks
  switch (ev.type) {
    case 'task.transitioned': {
      const fan = ts.filter(x => x.deps.length && x.deps.every(y => y.id === id && y.type === 'blocks')).map(x => x.id)
      return d.to === 'done' ? (ts.find(x => x.id === id)?.kind === 'spike' ? `${id} spike report${d.cites ? ` · ${d.cites} cites` : ''}` : `${id} pass · ${fan.length ? `fan-out ${fan.join(' ')}` : 'merged'}`)
        : d.from === 'review' && d.to === 'active' ? `${id} changes → resumed` : `${id} ${d.from} → ${d.to}`
    }
    case 'check.ran': return `${id} ${d.phase ?? d.name} ${d.ok ? gl(c, 'ok') : gl(c, 'crit')}${d.failing ? ` · ${d.failing} failing` : d.secs ? ` · ${d.name} ${d.secs}s` : ''}`
    case 'flag.raised': case 'flag.resolved': return `${id} ${ev.type.slice(5)} ${d.flag}`
    case 'approval.pending': return `plan ${d.planId} ready for approval`
    case 'sync.state_changed': return `${d.target} ${d.state === 'ok' ? 'back' : d.state}${d.conflicts ? ` · ${d.conflicts} conflict` : d.pending ? ` · ${d.pending} pending` : ''}`
    case 'drive.status': return `drive ${d.state}`
    case 'cost.updated': return `tokens ${d.tokens}`
    case 'task.phase_changed': return `${id} ${d.from} → ${d.to}`
    case 'task.skipped': return `${id} skipped (${d.on})`
    case 'init.stage': return `init: stage ${d.stage}${d.name ? ` ${d.name}` : ''} ${d.state}`
    case 'plan.landed': return `plan ${d.planId} landed`
    case 'plan.released': return `released ${d.version}`
    case 'release.proposed': return `release ${d.version} ready`
    case 'agent.bound': return `${d.agentId} bound to ${d.taskId} (${d.role})`
    case 'agent.unbound': return `${d.agentId} unbound (${d.reason})`
    default: return ev.type
  }
}
// latest first; the clock is epic time (the timeline's axis), the lane is the agent that made the event
export function log(v: View, n: number, w: number): Line[] {
  const t = v.t ?? v.now, { spans } = spansOf(v), evs = v.ring.filter(e => e.at <= t && !e.type.startsWith('agent.') && levelOf(e) > 0).slice(-n).reverse()
  return Array.from({ length: n }, (_, i) => { const e = evs[i]; return e ? L(cut(`${ago(e.at - t0(v)).padStart(3)} ${'.o*!'[levelOf(e)]} ${abbr(laneOf(spans, e) ?? (e.actor === 'mod' ? 'main' : e.actor)).padEnd(3)} ${evText(e, v)}`, w)) : L('') })
}

export function detail(v: View, id: string, w: number, compact: boolean): Line[] {
  const b = at(v), ts = b.tasks, t = ts.find(x => x.id === id) ?? ts[0], c = v.c, now = v.t ?? v.now
  if (!t) return [L('no tasks yet', 'inactive')]
  const k = kindOf(t, ts), mk = marks(t), names: Record<string, string> = { tester: 'spec', red: 'red', worker: 'impl', green: 'green', reviewer: 'review', merge: 'merged', explorer: 'explore', report: 'report' }
  const rework = v.ring.some(e => e.taskId === t.id && e.at <= now && e.type === 'task.transitioned' && e.data.from === 'review' && e.data.to === 'active') ? '   (rework)' : ''
  const pipe = T(c, stepsOf(t).map((s, i) => `${names[s]}${mk[i]}`).join(' ')).split(' ')
  const unb = ts.filter(x => x.deps.some(d => d.id === t.id && d.type === 'blocks') && x.deps.every(d => d.id === t.id || ts.find(y => y.id === d.id)?.state === 'done')).map(x => `${x.id}${x.deps.length > 1 ? ` (with ${x.deps.filter(d => d.id !== t.id).map(d => d.id).join(' ')})` : ''}`)
  const down = [...(unb.length ? [`unblocks ${unb.join(' ')}`] : []), ...ts.filter(x => x.deps.some(d => d.id === t.id && d.type === 'conditional-blocks')).map(x => `${x.id} runs only if ${t.id} fails`)]
  const ups = t.deps.map(d => { const u = ts.find(x => x.id === d.id); return `${d.id} ${tg(u ? kindOf(u, ts) : 'wait')}${compact ? '' : ` ${T(c, d.type === 'conditional-blocks' ? '┄ runs only if it fails' : u?.state === 'done' ? '━ live edge' : '─ pending')}`}` })
  if (compact) return [[S(`SEL ${t.id} ${t.type} · ${t.title} · `), S(`${tg(k)} ${gl(c, k)} ${word(t, ts)}`, col(k))], L(pipe.join(' ') + rework), L(cut([ups.length ? `after ${ups.join(' · ')}` : 'no deps', ...down].join(' · '), w))]
  const role = t.owner?.split(' ')[0], since = v.ring.find(e => e.type === 'agent.bound' && e.data.taskId === t.id && e.data.role === role)?.at ?? t.phaseSince
  return [[S(`SELECTED  ${t.id} · ${t.type}`.padEnd(w - 8)), S(`${tg(k)} ${gl(c, k)}`, col(k))], L(cut(t.title, w)), L(pipe.slice(0, 4).join(' ')), L(pipe.slice(4).join(' ') + rework),
    ...ups.map(u => L(cut(`after ${u}`, w))), ...down.map(x => L(cut(x, w))),
    ...(t.owner && t.state !== 'done' ? [L(cut(`${t.owner} · ${ago(now - since)}${t.ctx !== undefined ? ` · ctx ${t.ctx}%` : ''}`, w))] : [])]
}

// stacked list grouped by depth (narrow replacement for the lane board)
export function list(v: View, w: number, a: Acts): Line[] {
  const ts = at(v).tasks, c = v.c, live = (cl: SnapTask[]) => [...new Set(cl.flatMap(t => t.deps.map(d => d.id)))].filter(x => ts.find(y => y.id === x)?.state === 'done').join(' ')   // the live edges into a depth
  return cols(ts).flatMap((cl, i) => [L(`DEPTH ${i}${live(cl) ? `  after ${live(cl)} ${T(c, '━ live')}` : ''}`, 'inactive'), ...cl.map(t => {
    const k = kindOf(t, ts)
    return [S(cut(`${gl(c, k)} ${t.id} ${t.type.padEnd(5)} ${fit(t.title, 15)} ${T(c, marks(t).join('')).padEnd(6)} ${tg(k)} ${word(t, ts)}`, w), col(k), { k: `n:${t.id}`, p: () => a.pick(t.id) })]
  })])
}
export const railLine = (v: View): Line => { const p = at(v).plan; return p ? L(`rail  ${rail(p, v.c, v.ui.rel).map(r => `${r.n} ${r.t}`).join(' → ')}`) : L('') }
