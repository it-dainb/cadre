// Epic view (UI-DESIGN 5.5, 6.2-6.4): DAG canvas (depth columns, typed edge grid, nodes with pipeline strip + flash, rail), detail strip, 6-row log, stacked list.
import type { CadreEvent, Plan, SnapTask } from '../types'
import { type Acts, type Cfg, type Line, type View, L, S, T, PH, ago, at, col, cols, cut, fit, gl, kindOf, marks, stepsOf, tg, word } from './model'
import { levelOf } from './notify'

const W = 18, STRIDE = 23, ROWS = 6
const LIGHT = ' │─└││┌├─┘─┴┐┤┬┼', HEAVY = ' ┃━┗┃┃┏┣━┛━┻┓┫┳╋'   // index = N1 E2 S4 W8
const BORDER = { n: '┌─┐│└┘', s: '┏━┓┃┗┛', f: '╔═╗║╚╝' }
type Cell = { m: number; w: number; a?: string }   // direction mask, weight (3 live, 2 pending, 1 conditional), arrow override

function node(t: SnapTask, all: SnapTask[], c: Cfg, sel: boolean, flash: boolean): string[] {
  const k = kindOf(t, all), tag = `${tg(k)}${gl(c, k)}`, b = BORDER[flash ? 'f' : sel ? 's' : 'n'], wd = word(t, all)
  const body = [fit(`${t.id} ${t.type}`, 16 - tag.length) + tag, fit(t.title, 16), fit(flash ? `» ${wd} «` : `${marks(t).join('')} ${wd}`, 16)]
  return [b[0] + b[1].repeat(16) + b[2], ...body.map(x => b[3] + x + b[3]), b[4] + b[1].repeat(16) + b[5]]
}
function railTag(p: Plan, i: number): ReturnType<typeof kindOf> {
  const landed = p.state === 'done-on-dev' || p.state === 'released'
  return i === 0 ? (landed ? 'ok' : p.state === 'blocked' ? 'crit' : 'run') : i === 1 ? (landed ? 'ok' : p.state === 'integrating' ? 'run' : 'wait') : (p.state === 'released' ? 'ok' : 'wait')
}
const rail = (p: Plan, c: Cfg) => [(p.epicBranch || `epic/${p.id}`).replace(/-.*$/, ''), 'dev', p.released ? `main ${p.released.version}` : 'main'].map((n, i) => ({ n, k: railTag(p, i), t: `${tg(railTag(p, i))}${gl(c, railTag(p, i))}` }))

// DAG as segments: gutters plain, nodes colored by tag, each node's id row a Button (engine focus ring: Up/Down/Enter)
export function dag(v: View, sel: string, flash: string[], a: Acts): Line[] {
  const b = at(v), ts = b.tasks, cs = cols(ts), c = v.c, h = Math.max(1, ...cs.map(x => x.length)) * ROWS - 1
  const rx = cs.length * STRIDE - 3, rl = b.plan ? rail(b.plan, c) : []
  const width = rx + (rl.length ? 14 : 0), grid: string[][] = Array.from({ length: Math.max(h, rl.length * ROWS - 2) }, () => Array(width).fill(' '))
  const own: (string | null)[][] = grid.map(r => r.map(() => null)), pos = new Map<string, [number, number]>(), cells = new Map<string, Cell>()
  cs.forEach((col, x) => col.forEach((t, y) => {
    pos.set(t.id, [x * STRIDE, y * ROWS])
    node(t, ts, c, sel === t.id, flash.includes(t.id)).forEach((s, r) => [...s].forEach((ch, i) => { grid[y * ROWS + r][x * STRIDE + i] = ch; own[y * ROWS + r][x * STRIDE + i] = t.id }))
  }))
  const put = (x: number, y: number, m: number, w: number, arrow?: string) => { const o = cells.get(`${x},${y}`); cells.set(`${x},${y}`, { m: (o?.m ?? 0) | m, w: Math.max(o?.w ?? 0, w), a: arrow ?? o?.a }) }
  for (const t of ts) for (const d of t.deps) {
    const u = pos.get(d.id), p = pos.get(t.id); if (!u || !p || p[0] - u[0] !== STRIDE) continue
    const w = d.type === 'conditional-blocks' ? 1 : ts.find(x => x.id === d.id)?.state === 'done' ? 3 : 2, ya = u[1] + 2, yb = p[1] + 2, xr = u[0] + W, vx = xr + 2, xl = p[0] - 1
    for (let x = xr; x < vx; x++) put(x, ya, 10, w)
    put(vx, ya, 8 | (yb > ya ? 4 : yb < ya ? 1 : 2), w)
    for (let y = Math.min(ya, yb) + 1; y < Math.max(ya, yb); y++) put(vx, y, 5, w)
    if (yb !== ya) put(vx, yb, 2 | (yb > ya ? 1 : 4), w)
    for (let x = vx + 1; x < xl; x++) put(x, yb, 10, w)
    put(xl, yb, 10, w, w === 1 ? '▷' : '▶')
  }
  for (const [k, e] of cells) { const [x, y] = k.split(',').map(Number); grid[y][x] = e.a ?? (e.w === 1 && (e.m === 10 || e.m === 5) ? (e.m === 10 ? '┄' : '┆') : (e.w === 3 ? HEAVY : LIGHT)[e.m]) }
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

const ROLE: Record<string, string> = { tester: 'tst', red: 'tst', worker: 'wrk', green: 'wrk', reviewer: 'rev', merge: 'rev', explorer: 'exp', report: 'exp' }
const LANE: Record<string, string> = { human: 'hum', main: 'mai', tester: 'tst', worker: 'wrk', reviewer: 'rev', explorer: 'exp', sync: 'syn', mod: 'mod' }
export function evText(ev: CadreEvent, c: Cfg): string {
  const d = ev.data, id = ev.taskId ?? String(d.taskId ?? '')
  switch (ev.type) {
    case 'task.transitioned': return `${id} ${d.from} → ${d.to}`
    case 'task.phase_changed': return `${id} ${PH[String(d.to)] ?? d.to}`
    case 'task.skipped': return `${id} skipped (${d.on} passed)`
    case 'check.ran': return `${id} ${d.name} ${d.ok ? gl(c, 'ok') : gl(c, 'crit')}`
    case 'flag.raised': case 'flag.resolved': return `${id} ${ev.type.slice(5)} ${d.flag}`
    case 'approval.pending': return `plan ${d.planId} ready for approval`
    case 'sync.state_changed': return `${d.target} ${d.state}`
    case 'drive.status': return `drive ${d.state}`
    case 'cost.updated': return `tokens ${d.tokens}`
    case 'agent.bound': return `${d.role} bound to ${d.taskId}`
    case 'agent.unbound': return `agent unbound (${d.reason})`
    default: return `${ev.type} ${JSON.stringify(d)}`
  }
}
export function log(v: View, n: number, w: number): Line[] {
  const t = v.t ?? v.now, evs = v.ring.filter(e => e.at <= t && !e.type.startsWith('agent.') && (levelOf(e) > 0 || e.type !== 'task.transitioned')).slice(-n).reverse(), lv = '.o*!'
  return Array.from({ length: n }, (_, i) => { const e = evs[i]; return e ? L(cut(`${ago(t - e.at).padStart(3)} ${lv[levelOf(e)]} ${e.actor === 'mod' && ROLE[String(e.data.to)] || LANE[e.actor] || e.actor} ${evText(e, v.c)}`, w)) : L('') })
}

export function detail(v: View, id: string, w: number, compact: boolean): Line[] {
  const b = at(v), ts = b.tasks, t = ts.find(x => x.id === id) ?? ts[0], c = v.c
  if (!t) return [L('no tasks yet', 'inactive')]
  const k = kindOf(t, ts), mk = marks(t), names: Record<string, string> = { tester: 'spec', red: 'red', worker: 'impl', green: 'green', reviewer: 'review', merge: 'merged', explorer: 'explore', report: 'report' }
  const pipe = T(c, stepsOf(t).map((s, i) => `${names[s]}${mk[i]}`).join(' ')).split(' '), downs = ts.filter(x => x.deps.some(d => d.id === t.id)).map(x => x.id)
  const ups = t.deps.map(d => { const u = ts.find(x => x.id === d.id); return `${d.id} ${tg(u ? kindOf(u, ts) : 'wait')} ${T(c, d.type === 'conditional-blocks' ? '┄ runs only if it fails' : u?.state === 'done' ? '━ live edge' : '─ pending')}` })
  if (compact) return [[S(`SEL ${t.id} ${t.type} · ${t.title} · `), S(`${tg(k)} ${gl(c, k)} ${word(t, ts)}`, col(k))], L(pipe.join(' ')), L(cut(`${ups.length ? `after ${ups.join(' · ')}` : 'no deps'}${downs.length ? ` · unblocks ${downs.join(' ')}` : ''}`, w))]
  return [[S(`SELECTED  ${t.id} · ${t.type}`.padEnd(w - 8)), S(`${tg(k)} ${gl(c, k)}`, col(k))], L(cut(t.title, w)), L(pipe.slice(0, 4).join(' ')), L(pipe.slice(4).join(' ')),
    ...ups.map(u => L(cut(`after ${u}`, w))), ...(downs.length ? [L(`unblocks ${downs.join(' ')}`)] : []),
    ...(t.owner && t.state !== 'done' ? [L(cut(`${t.owner} · ${ago((v.t ?? v.now) - t.phaseSince)}`, w))] : [])]
}

// stacked list grouped by depth (narrow replacement for the lane board)
export function list(v: View, w: number, a: Acts): Line[] {
  const ts = at(v).tasks, c = v.c
  return cols(ts).flatMap((cl, i) => [L(`DEPTH ${i}${i ? `  after ${[...new Set(cl.flatMap(t => t.deps.map(d => d.id)))].join(' ')}` : ''}`, 'inactive'), ...cl.map(t => {
    const k = kindOf(t, ts)
    return [S(cut(`${gl(c, k)} ${t.id} ${t.type.padEnd(5)} ${fit(t.title, 16)} ${T(c, marks(t).join('')).padEnd(6)} ${tg(k)} ${word(t, ts)}`, w), col(k), { k: `n:${t.id}`, p: () => a.pick(t.id) })]
  })])
}
export const railLine = (v: View): Line => { const p = at(v).plan; return p ? L(`rail  ${rail(p, v.c).map(r => `${r.n} ${r.t}`).join(' → ')}`) : L('') }
