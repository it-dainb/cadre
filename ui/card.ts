// Decision card (ADR 0008): the ONE renderer of any Decision (core/decide). A framed box: title, the record's lines, its options as Buttons (key = hotkey);
// "n of m" with n/p when several are pending. Driven only by the record: a new kind of decision needs no UI code. The rest of the pane is drawn dim and key-less below.
import { type Acts, type Decision, type Line, type View, L, S, T, attention, cols, gl, padL, tg, col } from './model'
import { sheet } from './sheet'
import { wrap } from './sheet'

export const decisions = (v: View): Decision[] => v.b.decisions ?? []
export const cur = (v: View): number => Math.min(Math.max(0, Number(v.ui.di ?? 0)), Math.max(0, decisions(v).length - 1))
export const defaultTab = (v: View) => (decisions(v).length ? 'card' : 'epic')
const dim = (ls: Line[]): Line[] => ls.map(l => l.map(s => ({ t: s.t, c: s.c, d: true })))   // no keys: only the card's buttons answer
export function card(v: View, w: number, a: Acts): Line[] {
  const all = decisions(v), i = cur(v), d = all[i], c = v.c, n = Math.max(20, Math.min(w, 110) - 4), fr = (l: Line): Line => [S(T(c, '║ ')), ...padL(l, n), S(T(c, ' ║'))]
  const bar = (l: string, m: string, r: string) => L(T(c, `${l}${m.repeat(n + 2)}${r}`))
  const tag = attention(v).find(x => x.d === d)?.tag ?? 'attn', live = v.t === null
  const nav: Line = all.length > 1 ? [S(`${i + 1} of ${all.length}   `), S('prev', undefined, { k: 'p', hk: 'p', p: () => a.step('dec', -1) }), S('  '), S('next', undefined, { k: 'n', hk: 'n', p: () => a.step('dec', 1) })] : []
  const btns: Line = live ? d.options.flatMap((o, j) => [...(j ? [S('   ')] : []), S(o.label, 'suggestion', { k: o.key, hk: o.key, b: true, p: () => (o.fill ? a.fill(o.fill) : a.press(d.id, o.key, d.hash)) })]) : [S('(read-only in replay)')]
  const body: Line[] = [[S(`${tg(tag)} ${gl(c, tag)} ${d.title}`.slice(0, n), col(tag), { b: true })], L(''), ...d.lines.flatMap(x => wrap(x, n, '  ').map(y => L(y))), L(''), ...(nav.length ? [nav] : []), btns]
  const under = d.tab === 'plan' ? sheet(v, w, a) : cols(v.b.tasks).flat().map(t => L(`${t.id} ${t.title}`))
  return [bar('╔', '═', '╗'), ...body.map(fr), bar('╚', '═', '╝'), ...dim(under)]
}
