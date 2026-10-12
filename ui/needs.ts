// Needs you (TUI-DESIGN 5.1, ADR 0012): the pending decisions, read-only. A decision is answered ONLY in the native dialog: `1` (band or pane) opens it for the oldest.
// The epic tab lists every decision with its full detail; the other tabs and the band carry the one-line form. A row with more (the plan sheet, a task) opens it on enter.
import { type Acts, type Decision, type Line, type View, L, S, attention, col, cut, wid } from './model'
import { wrap } from './sheet'

export const decisions = (v: View): Decision[] => v.b.decisions ?? []
const ANS = 'answer'
// `! NEEDS YOU · <title> · +N more · 1: answer` (`1` opens the dialog; an item that is not a decision opens its tab). Below 40 columns it wraps, never truncates.
export function needLine(v: View, w: number, a: Acts, items = attention(v)): Line[] {
  const top = items[0]; if (!top) return []
  const label = top.d ? ANS : 'open', more = items.length > 1 ? ` · +${items.length - 1} more` : ''
  const bt = S(label, undefined, { k: 'att', hk: '1', p: () => (top.d ? a.answer(top.d.id) : top.sel ? a.pick(top.sel) : a.go(top.tab)) })
  const word = w >= 50 ? 'NEEDS YOU · ' : '', rest = `${w >= 100 ? top.text : top.short ?? top.text}${more}`
  if (w < 40) { const [f, ...r] = wrap(`! ${word}${rest}`, w, '  '); return [[S(f, col('attn'), { b: true })], ...r.map(x => L(x)), [bt]] }
  const room = w - wid([bt]) - 1, head: Line = [S(`! ${word}`, col('attn'), { b: true }), S(cut(rest, Math.max(8, room - 2 - word.length)))]
  return [[...head, S(' '.repeat(Math.max(1, w - wid(head) - wid([bt])))), bt]]
}
// the epic tab's section: one row per decision (`1: answer` on the oldest), its lines under it
export function needs(v: View, w: number, a: Acts): Line[] {
  const ds = decisions(v); if (!ds.length) return []
  const row = (d: Decision, i: number): Line[] => {
    const bt = i ? S(ANS, undefined, { k: `ans:${d.id}`, p: () => a.answer(d.id) }) : S(ANS, undefined, { k: 'att', hk: '1', p: () => a.answer(d.id) })
    const go = d.tab === 'plan' || d.sel ? { k: `nd:${d.id}`, p: () => (d.tab === 'plan' ? a.go('plan') : a.pick(d.sel!)) } : {}
    const t = S(cut(d.title, Math.max(8, w - 6 - wid([bt]))), undefined, { b: true, ...go }), head: Line = [S('  '), S('!', col('attn'), { b: true }), S(' '), t]
    return [[...head, S(' '.repeat(Math.max(1, w - wid(head) - wid([bt])))), bt], ...(d.error ? [L(`    ! ${d.error}`, 'error')] : []), ...d.lines.flatMap(x => wrap(x, w - 4, '  ').map(y => L(`    ${y}`)))]
  }
  return [[S('NEEDS YOU', col('attn'), { b: true })], ...ds.flatMap(row), L('')]
}
