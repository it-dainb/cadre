// UI v2 · 3 Timeline (TUI-DESIGN 4.4): swimlanes as ONE Raster, only for lanes that had activity, plain lane names, the BRAND palette (tokens.raster) and a `│` cursor.
// The activity rows up to the cursor sit under the lanes. Below 60 columns the lanes are hidden: activity only.
// Replay moves the cursor with h/l (the engine allows letters and digits as hotkeys, not arrows); `s` jumps to the start, `e` back to live. Buttons act only in live (acts guard replay).
import type { CadreEvent } from '../../types'
import { type View, t0 } from '../model'
import { padR, width } from '../layout'
import { type Cell, DEFAULT_FG, block, cursor, raster } from '../tokens'
import { activityRows } from './activity'
import { type Renderer, joinSections, keyLine, muted, ucfg } from './types'

type Span = { lane: string; from: number; to: number; cell: Cell; task?: string }
// agent spans and sync outages folded from the ring (open spans end at the cursor); workers take the first free lane, tasks in plan order
export function spansOf(v: View, upTo: number): Span[] {
  const open = new Map<string, Omit<Span, 'to'>>(), spans: Span[] = []
  for (const e of v.ring) {
    if (e.at > upTo) break
    if (e.type === 'agent.bound') open.set(String(e.data.agentId), { lane: String(e.data.role), from: e.at, cell: e.data.role === 'reviewer' ? 'review' : 'work', task: String(e.data.taskId) })
    else if (e.type === 'agent.unbound') { const o = open.get(String(e.data.agentId)); if (o) { spans.push({ ...o, to: e.at }); open.delete(String(e.data.agentId)) } }
    else if (e.type === 'sync.state_changed') {
      const k = `sync:${e.data.target}`, o = open.get(k)
      if (e.data.state !== 'ok' && !o) open.set(k, { lane: 'sync', from: e.at, cell: 'offline' })
      else if (e.data.state === 'ok' && o) { spans.push({ ...o, to: e.at }); open.delete(k) }
    }
  }
  for (const o of open.values()) spans.push({ ...o, to: upTo })
  const order = v.b.tasks.map(t => t.id), lanes: Span[][] = []
  for (const s of spans.filter(x => x.lane === 'worker').sort((x, y) => order.indexOf(x.task!) - order.indexOf(y.task!) || x.from - y.from)) {
    let i = lanes.findIndex(l => l.every(x => x.to <= s.from || x.from >= s.to)); if (i < 0) i = lanes.push([]) - 1
    lanes[i].push(s); s.lane = `worker ${i + 1}`
  }
  return spans
}
const ORDER = ['tester', 'worker', 'reviewer', 'explorer', 'sync'], rank = (l: string) => ORDER.indexOf(l.split(' ')[0]) * 10 + Number(l.split(' ')[1] ?? 0)
const mark = (e: CadreEvent): Cell | undefined => (e.type === 'flag.raised' ? 'attention' : e.type === 'check.ran' && !e.data.ok ? 'failure' : undefined)

export const timeline: Renderer = (v, w, rows, a) => {
  const c = ucfg(v), cur = v.t ?? v.now, live = v.t === null
  const keys = keyLine(live ? [] : [['h', 'back', () => a.step('time', -1)], ['l', 'forward', () => a.step('time', 1)], ['s', 'start', () => a.step('time', -1e6)], ['e', 'live', () => a.step('live', 0)]])
  const spans = spansOf(v, cur), lanes = [...new Set(spans.map(s => s.lane))].sort((x, y) => rank(x) - rank(y))
  const acts = activityRows(v, w, cur)
  if (w < 60 || !lanes.length) return { lines: [...(lanes.length ? [] : [[muted('  no agent has worked yet')]]), ...acts.slice(0, Math.max(1, rows))], keys }
  const lab = Math.max(...lanes.map(width)) + 1, n = w - lab - 1, base = t0(v), end = Math.max(cur, ...spans.map(s => s.to))
  const mpc = Math.max(1, Math.ceil(((end - base) / 60000 + 1) / n)), colOf = (t: number) => Math.min(n - 1, Math.max(0, Math.floor((t - base) / 60000 / mpc))), cc = colOf(cur)
  const grid = [...Array(lanes.length + 1)].map(() => Array<[string, number]>(w).fill([' ', DEFAULT_FG]))
  const put = (r: number, x: number, ch: string, fg: number) => { grid[r][lab + x] = [ch, fg] }
  const text = (r: number, x: number, s: string) => [...s].forEach((ch, i) => { if (x + i < w) grid[r][x + i] = [ch, DEFAULT_FG] })
  for (let m = 0; m / mpc < n - 4; m += 10 * mpc) text(0, lab + Math.floor(m / mpc), `${m}m`)
  lanes.forEach((l, i) => text(i + 1, 0, padR(l, lab)))
  for (const s of spans) for (let x = colOf(s.from), e = Math.max(x + 1, colOf(s.to) + (s.to === cur ? 1 : 0)); x < Math.min(n, e); x++) put(lanes.indexOf(s.lane) + 1, x, block(s.cell, c.ascii), raster(s.cell, c.theme))
  for (const e of v.ring) { const m = e.at <= cur ? mark(e) : undefined, s = m && spans.find(x => x.task === e.taskId && x.from <= e.at && e.at <= x.to); if (m && s) put(lanes.indexOf(s.lane) + 1, colOf(e.at), block(m, c.ascii), raster(m, c.theme)) }
  for (let r = 0; r <= lanes.length; r++) if (grid[r][lab + cc][0] === ' ') put(r, cc, cursor(c.ascii), raster('review', c.theme))
  const u = new Uint32Array(w * grid.length * 3)
  grid.forEach((r, y) => r.forEach(([ch, fg], x) => { const i = (y * w + x) * 3; u[i] = ch.codePointAt(0)!; u[i + 1] = fg; u[i + 2] = DEFAULT_FG }))
  const b = new Uint8Array(u.buffer), cells = (b as { toBase64?: () => string }).toBase64?.() ?? btoa(Array.from(b, x => String.fromCharCode(x)).join(''))
  const head = [muted(`  ${mpc} min per column`)]   // live / replay is the frame header's
  const room = Math.max(1, rows - grid.length - 2)
  return { raster: { cols: w, rows: grid.length, cells, at: 0 }, lines: joinSections([[head], acts.slice(0, room)], c.density), keys }
}
