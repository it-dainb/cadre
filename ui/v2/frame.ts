// UI v2 Pane v2 frame (TUI-DESIGN §4.1): numbered tab row, header, Needs you, one view body, context footer + key sheet. A view that throws draws the fallback line instead of crashing.
import { type Acts, type Line, type Seg, type View, S } from '../model'
import { color, SEP } from '../tokens'
import { clip, relTime } from '../layout'
import { activity } from '../views/activity'
import { doctor } from '../views/doctor'
import { graph } from '../views/graph'
import { settings } from '../views/settings'
import { timeline } from '../views/timeline'
import { type Renderer, type VOut, keyLine } from '../views/types'
import { needsFull, needsOne, boardView } from './board'
import { dormant, dormantBody, errorBody } from './states'
import { driveOf, lr, lw, needsOf, problem, prog } from './facts'

export type Raster = NonNullable<VOut['raster']>
export type P2 = { before: Line[]; raster?: Raster; after: Line[] }
const TABS: [id: string, hk: string, long: string, short: string, one: string, view: Renderer][] = [
  ['board', '1', 'Board', 'Brd', 'B', boardView], ['graph', '2', 'Graph', 'Gph', 'G', graph], ['timeline', '3', 'Timeline', 'Tml', 'T', timeline],
  ['activity', '4', 'Activity', 'Act', 'A', activity], ['doctor', '8', 'Doctor', 'Doc', 'D', doctor], ['settings', '9', 'Settings', 'Set', 'S', settings],
]
export const tabOf = (v: View): string => { const t = v.ui.tab as string | undefined; return TABS.some(x => x[0] === t) ? t! : 'board' }   // v1 names (epic, plan) land on the Board

function tabRow(v: View, w: number, a: Acts, cur: string, owed: boolean): Line {
  const out: Line = []
  for (const [id, hk, long, short, one] of TABS) {
    const on = id === cur, label = w >= 80 || (on && w >= 50) ? long : w >= 50 ? short : one
    if (out.length) out.push(S(w < 40 ? ' ' : '  '))
    out.push(S(hk === '1' && owed ? `1 ${label}` : label, on ? color('accent') : color('muted'), { b: on, k: `tab${hk}`, ...(hk === '1' && owed ? {} : { hk }), p: () => a.go(id) }))   // `1` answers while a decision waits
    if ((id === 'board' && owed) || (id === 'doctor' && problem(v))) out.push(S('!', color('attention'), { b: true }))
  }
  return out
}
function header(v: View, w: number): Line {
  const p = v.b.plan, dr = driveOf(v), ts = v.b.tasks
  const left = p ? [`${p.id} ${p.slug}`, ...(w >= 100 && p.epicBranch ? [p.epicBranch] : []), ...(dr && dr.kind !== 'run' ? [`${dr.kind === 'stopped' ? 'drive stopped' : 'drive paused'}: ${dr.reason}`] : [])].join(`${SEP}`) : 'no plan yet'
  const right: Seg = v.t === null ? S('live', color('muted')) : S(`replay${SEP}${relTime(v.now - v.t)}`, color('attention'), { i: true })
  return lr(w, [S(left, color('muted'))], [right])
}
const SHEET: [string, string][] = [['1 2 3 4 8 9', 'switch view (1 answers while a decision waits)'], ['k', 'this list'], ['esc', 'back to the prompt']]
const keySheet = (vo: VOut, w: number): Line[] => [
  [S('Keys', undefined, { b: true })], ...SHEET.map(([k, t]) => [S(clip(`  ${k.padEnd(12)}${t}`, w))]),
  ...(vo.keys.length ? [[S(' ')], [S('This view', undefined, { b: true })], [S('  '), ...vo.keys.map(s => ({ ...s, hk: undefined, k: undefined, p: undefined, t: (s.hk ? `${s.hk}: ` : '') + s.t }))]] as Line[] : []),
]

export function pane2(v: View, w: number, rows: number, a: Acts, canRaster = true): P2 {
  try { return frame(v, w, rows, a, canRaster) } catch { return { before: errorBody(w), after: [] } }   // never crash the pane on a shape it cannot draw
}
function frame(v: View, w: number, rows: number, a: Acts, canRaster: boolean): P2 {
  const cur = tabOf(v), owed = needsOf(v).length > 0, dense = (v.ui.cfg as { density?: string } | undefined)?.density === 'compact'
  const gap: Line[] = dense ? [] : [[S(' ')]]
  const head: Line[] = [tabRow(v, w, a, cur, owed), header(v, w)]
  const needs = cur === 'board' ? needsFull(v, w, a) : needsOne(v, w, a)
  const used = head.length + needs.length + 3
  let vo: VOut
  try {
    vo = cur === 'board' && dormant(v) ? { lines: dormantBody(w), keys: [] } : TABS.find(x => x[0] === cur)![5](v, w, Math.max(4, rows - used), a)
  } catch { vo = { lines: errorBody(w), keys: [] } }
  const sheet = v.ui.ks === true
  const body = sheet ? keySheet(vo, w) : vo.lines, ras = sheet || !canRaster ? undefined : vo.raster
  const fk = lw(vo.keys) + 14 > w ? [] : vo.keys   // a footer that does not fit drops the view's keys, never overflows
  const foot: Line = [...fk, ...(fk.length ? [S('  ')] : []), ...keyLine([['k', sheet ? 'close' : 'keys', () => a.step('keys', 0)]])]
  const top = [...head, ...(needs.length ? [...gap, ...needs] : []), ...gap]
  if (!ras) return { before: [...top, ...body, ...gap, foot], after: [] }
  return { before: [...top, ...body.slice(0, ras.at)], raster: ras, after: [...body.slice(ras.at), ...gap, foot] }
}
