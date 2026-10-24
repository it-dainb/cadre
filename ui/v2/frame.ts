// UI v2 Pane v2 frame (TUI-DESIGN §4.1): numbered tab row, header, Needs you, one view body, context footer + key sheet. A view that throws draws the fallback line instead of crashing.
import { type Acts, type Line, type Seg, type View, S } from '../model'
import { asciiText, color, SEP } from '../tokens'
import { clip, relTime, width } from '../layout'
import { activity } from '../views/activity'
import { doctor } from '../views/doctor'
import { graph } from '../views/graph'
import { milestone } from '../views/milestone'
import { settings } from '../views/settings'
import { lessons } from '../views/lessons'
import { timeline } from '../views/timeline'
import { type Renderer, type VOut, keyLine } from '../views/types'
import { needsFull, needsOne, boardView } from './board'
import { dormant, dormantBody, errorBody } from './states'
import { ascii, lr, lw, needsOf, problem } from './facts'

export type Raster = NonNullable<VOut['raster']>
export type P2 = { before: Line[]; raster?: Raster; after: Line[] }
const TABS: [id: string, hk: string, long: string, short: string, one: string, view: Renderer][] = [
  ['board', '1', 'Board', 'Brd', 'B', boardView], ['graph', '2', 'Graph', 'Gph', 'G', graph], ['timeline', '3', 'Timeline', 'Tml', 'T', timeline],
  ['activity', '4', 'Activity', 'Act', 'A', activity], ['milestone', '5', 'Milestone', 'Mst', 'M', milestone], ['lessons', '6', 'Lessons', 'Les', 'L', lessons], ['doctor', '8', 'Doctor', 'Doc', 'D', doctor], ['settings', '9', 'Settings', 'Set', 'S', settings],
]
const tabsOf = (v: View) => TABS.filter(x => (x[0] !== 'milestone' || v.b.plan?.lane === 'milestone') && (x[0] !== 'lessons' || !!(v.ui['lessons.rows'] as unknown[] | undefined)?.length))   // tab 5 only while a milestone is the plan; tab 6 once there are lessons
export const tabOf = (v: View): string => { const t = v.ui.tab as string | undefined; return tabsOf(v).some(x => x[0] === t) ? t! : 'board' }   // v1 names (epic, plan) land on the Board

function tabRow(v: View, w: number, a: Acts, cur: string, owed: boolean): Line {
  // the widest label set that fits the row (gap 2, then 1); the current tab is spelled out and drawn inverse (it reads without colour), short only when even that cannot fit
  const mark = (owed ? 2 : 0) + (problem(v) ? 2 : 0)
  const tabs = tabsOf(v), labels = (set: 2 | 3 | 4, cl: 2 | 3 | 4) => tabs.map(x => (x[0] === cur ? x[cl] : x[set]))
  const need = (ls: string[], gap: number) => ls.reduce((n, l, i) => n + 3 + width(l) + (i ? gap : 0), 0) + mark
  const pick = ([[2, 2, 2], [3, 2, 2], [4, 2, 2], [4, 2, 1], [4, 3, 1], [4, 4, 1]] as const).find(([s, c, g]) => need(labels(s, c), g) <= w) ?? [4, 4, 1] as const
  const ls = labels(pick[0], pick[1]), gap = ' '.repeat(pick[2])
  const out: Line = []
  tabs.forEach(([id, hk], i) => {
    const on = id === cur, label = ls[i]
    if (out.length) out.push(S(gap))
    // `1` answers while a decision waits (the Needs-you button owns the key): the tab is plain text then
    out.push(S(hk === '1' && owed ? `1: ${label}` : label, on ? undefined : color('muted'), { ...(on ? { i: true } : {}), k: `tab${hk}`, ...(hk === '1' && owed ? {} : { hk }), p: () => a.go(id) }))
    if ((id === 'board' && owed) || (id === 'doctor' && problem(v))) out.push(S(' !', color('attention'), { b: true }))
  })
  return out
}
function header(v: View, w: number): Line {
  const p = v.b.plan   // the drive's state belongs to the band (and Doctor): not repeated here
  const es = p?.epics ?? [], run = es.filter(e => e.state === 'running').map(e => e.id)   // a milestone: its epics' progress here, its branch on tab 5
  const left = !p ? 'no plan yet' : [`${p.id} ${p.slug}`, ...(p.lane === 'milestone' ? [`epics ${es.filter(e => e.state === 'landed').length}/${es.length} landed`, w >= 60 && run.length ? `${run.join(' ')} running` : ''] : [w >= 100 && p.epicBranch]).filter(Boolean)].join(SEP)
  const right: Seg = v.t === null ? S('live', color('muted')) : S(`replay${SEP}${relTime(v.now - v.t)}`, color('attention'), { i: true })
  return lr(w, [S(left, color('muted'))], [right])
}
const keySheet = (v: View, vo: VOut, w: number): Line[] => [
  [S('Keys', undefined, { b: true })], ...([[tabsOf(v).map(x => x[1]).join(' '), 'switch view (1 answers while a decision waits)'], ['k', 'this list'], ['esc', 'back to the prompt']] as const).map(([k, t]) => [S(clip(`  ${k.padEnd(14)}${t}`, w))]),
  ...(vo.keys.length ? [[S(' ')], [S('This view', undefined, { b: true })], [S('  '), ...vo.keys.map(s => ({ ...s, hk: undefined, k: undefined, p: undefined, t: (s.hk ? `${s.hk}: ` : '') + s.t }))]] as Line[] : []),
]

export function pane2(v: View, w: number, rows: number, a: Acts, canRaster = true): P2 {
  let p: P2
  try { p = frame(v, w, rows, a, canRaster) } catch { p = { before: errorBody(w), after: [] } }   // never crash the pane on a shape it cannot draw
  if (!ascii(v)) return p
  const asc = (ls: Line[]) => ls.map(l => l.map(s => ({ ...s, t: asciiText(s.t) })))
  return { ...p, before: asc(p.before), after: asc(p.after) }
}
function frame(v: View, w: number, rows: number, a: Acts, canRaster: boolean): P2 {
  const live = v.t === null, cur = tabOf(v), owed = live && needsOf(v).length > 0, dense = (v.ui.cfg as { density?: string } | undefined)?.density === 'compact'
  const gap: Line[] = dense ? [] : [[S(' ')]]
  const head: Line[] = [tabRow(v, w, a, cur, owed), header(v, w)]
  const needs = !live ? [] : cur === 'board' && rows >= 16 ? needsFull(v, w, a, rows) : needsOne(v, w, a)   // a short pane gets the one-line form; replay is the past: no live decision, no key
  const used = head.length + needs.length + 3
  let vo: VOut
  try {
    vo = cur === 'board' && dormant(v) ? { lines: dormantBody(w), keys: [] } : TABS.find(x => x[0] === cur)![5](v, w, Math.max(4, rows - used), a)
  } catch { vo = { lines: errorBody(w), keys: [] } }
  const sheet = v.ui.ks === true
  const body = sheet ? keySheet(v, vo, w) : vo.lines, ras = sheet || !canRaster ? undefined : vo.raster
  const fk = lw(vo.keys) + 14 > w ? [] : vo.keys   // a footer that does not fit drops the view's keys, never overflows
  const foot: Line = [...fk, ...(fk.length ? [S('  ')] : []), ...keyLine([['k', sheet ? 'close' : 'keys', () => a.step('keys', 0)]])]
  const top = [...head, ...(needs.length ? [...gap, ...needs] : []), ...gap]
  if (!ras) return { before: [...top, ...body, ...gap, foot], after: [] }
  return { before: [...top, ...body.slice(0, ras.at)], raster: ras, after: [...body.slice(ras.at), ...gap, foot] }
}
