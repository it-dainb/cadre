// Timeline swimlanes as ONE Raster (UI-DESIGN 6.2, 8; UI-21): spans from agent.bound/unbound, outages from sync.state_changed, markers by notification level, the cursor.
// Cursor moves repaint through $.ui.blit (no tree re-render); in replay the cursor is the moment and later spans draw ╌.
import type { CadreEvent, Host } from '../types'
import { type Cfg, type View, T, ago, t0 } from './model'
import { levelOf } from './notify'

const FG: Record<string, number> = { '█': 0x61afef, '▒': 0xc678dd, '░': 0xe5c07b, '╌': 0x5c6370, '┃': 0xe5c07b, '▼': 0xe5c07b, '.': 0x5c6370, o: 0x98c379, '*': 0xe5c07b, '!': 0xe06c75 }
const DEF = 0x01000000, NAME: Record<string, string> = { human: 'hum', main: 'mai', tester: 'tst', 'worker 1': 'w1', 'worker 2': 'w2', reviewer: 'rev', explorer: 'exp', sync: 'syn' }

export type Span = { lane: string; from: number; to: number; ch: string; task?: string; open?: boolean }
// agent spans and sync outages folded from the ring; workers take the first free lane, tasks in plan order (so a task keeps its lane across resumes)
export function spansOf(v: View): { spans: Span[]; workers: number } {
  const open = new Map<string, Omit<Span, 'to'>>(), spans: Span[] = []
  for (const e of v.ring) {
    if (e.type === 'agent.bound') open.set(String(e.data.agentId), { lane: String(e.data.role), from: e.at, ch: e.data.role === 'reviewer' ? '▒' : '█', task: String(e.data.taskId) })
    else if (e.type === 'agent.unbound') { const o = open.get(String(e.data.agentId)); if (o) { spans.push({ ...o, to: e.at }); open.delete(String(e.data.agentId)) } }
    else if (e.type === 'sync.state_changed') {
      const k = `sync:${e.data.target}`, o = open.get(k)
      if (e.data.state !== 'ok' && !o) open.set(k, { lane: 'sync', from: e.at, ch: '░' })
      else if (e.data.state === 'ok' && o) { spans.push({ ...o, to: e.at }); open.delete(k) }
    }
  }
  for (const o of open.values()) spans.push({ ...o, to: Math.max(v.now, v.t ?? 0), open: true })
  const order = v.b.tasks.map(t => t.id), lanes: Span[][] = []
  for (const s of spans.filter(x => x.lane === 'worker').sort((x, y) => order.indexOf(x.task!) - order.indexOf(y.task!) || x.from - y.from)) {
    let i = lanes.findIndex(l => l.every(x => x.to <= s.from || x.from >= s.to)); if (i < 0) i = lanes.push([]) - 1
    lanes[i].push(s); s.lane = `worker ${i + 1}`
  }
  return { spans, workers: Math.max(1, lanes.length) }
}
// the lane an agent-made event belongs to: the span of its task that ends at it, else one containing it
export const laneOf = (spans: Span[], e: CadreEvent) => { const s = spans.filter(x => x.task && x.task === e.taskId); return (s.find(x => x.to === e.at) ?? s.find(x => x.from <= e.at && e.at < x.to))?.lane }
export const abbr = (lane: string) => NAME[lane] ?? lane

export type Tl = { head: string; rows: string[]; cols: number; mpc: number }
export function timeline(v: View, w: number): Tl {
  const wide = w >= 116, lab = wide ? 10 : 4, n = w - lab - 1, base = t0(v), cur = v.t ?? v.now, end = Math.max(v.now, cur, ...v.ring.map(e => e.at))
  const mpc = Math.max(1, Math.ceil((((end - base) / 60000) + 1) / n)), colOf = (t: number) => Math.min(n - 1, Math.max(0, Math.floor((t - base) / 60000 / mpc))), cc = colOf(cur)
  const { spans, workers } = spansOf(v)
  const lanes = ['human', 'main', 'tester', ...Array.from({ length: workers }, (_, i) => `worker ${i + 1}`), 'reviewer', 'explorer', 'sync']
  const rows = lanes.map(() => Array(n).fill(' ') as string[])
  const put = (lane: string, x: number, ch: string) => { const r = rows[lanes.indexOf(lane)]; if (r) r[x] = ch }
  for (const s of spans) for (let x = colOf(s.from), e = s.open ? colOf(s.to) + 1 : Math.min(n, Math.ceil((s.to - base) / 60000 / mpc)); x < e; x++) put(s.lane, x, x > cc ? '╌' : s.ch)   // [from, to) in minutes: the verdict mark sits on `to`
  for (const e of v.ring) { const l = levelOf(e); const al = e.actor === 'mod' ? laneOf(spans, e) : undefined; if (l && e.at <= cur && (al || e.actor !== 'mod' || l > 1)) put(al ?? (e.actor === 'human' || e.needsHuman ? 'human' : e.actor === 'mod' ? 'main' : e.actor), colOf(e.at), '.o*!'[l]) }
  const axis = Array(n).fill(' ') as string[], step = wide ? 10 : 20
  for (let m = 0; m + step <= n * mpc; m += step) [...`${m}m`].forEach((ch, i) => { if (m / mpc + i < n) axis[m / mpc + i] = ch })
  for (const r of rows) if (r[cc] === ' ') r[cc] = '┃'
  axis[cc] = '▼'
  const line = (name: string, r: string[]) => (wide ? name.padEnd(lab) : (NAME[name] ?? name).padEnd(lab)) + r.join('')
  const mode = v.t === null ? '[LIVE]' : `[REPLAY t-${ago(v.now - v.t).slice(0, -1)}m]`
  const head = wide ? `TIMELINE  ${mode} now ${ago(cur - base)} · █ work ▒ review ░ offline · . silent o band * toast ! notify · t: hide` : `TIMELINE  ${mpc} min/col · ░ offline · ┃ ${ago(cur - base)}`
  return { head: T(v.c, head), rows: [' '.repeat(lab) + axis.join(''), ...lanes.map((l, i) => line(l, rows[i]))].map(r => r.padEnd(w)), cols: w, mpc }
}
export function cells(tl: Tl, c: Cfg): string {
  const u = new Uint32Array(tl.cols * tl.rows.length * 3)
  tl.rows.forEach((r, y) => [...r].forEach((ch, x) => { const i = (y * tl.cols + x) * 3; u[i] = T(c, ch).codePointAt(0)!; u[i + 1] = FG[ch] ?? DEF; u[i + 2] = DEF }))
  const b = new Uint8Array(u.buffer)
  return (b as { toBase64?: () => string }).toBase64?.() ?? btoa(Array.from(b, x => String.fromCharCode(x)).join(''))
}
// cursor-only repaint (live clock tick, replay keys): same size, no re-render
export async function blit(h: Host, v: View, w: number): Promise<void> {
  const tl = timeline(v, w)
  await h.ops?.blit({ requestId: 'cadre', key: 'tl', cells: cells(tl, v.c) })
}
