// UI v2 · 2 Graph (TUI-DESIGN 4.3): frameless, one line per task, the depth as indent, `─→` blocks / `┄→` conditional-blocks after the title, the selected task inverse.
// Below 80 columns: the depth list (a title per depth, no indent). dag() is the idiom; the Milestone tab draws its roadmap of epics with it.
import type { SnapTask } from '../../types'
import { type Line, type Seg, type View, S, at, cols, kindOf } from '../model'
import { row } from '../layout'
import { type GlyphK, SEP, edge, glyph } from '../tokens'
import { type Renderer, gk, gseg, joinSections, keyLine, muted, relax, title, ucfg, win } from './types'

// one row per node: kind = its glyph, facts lead (edges follow, dropped first), press = the row's Button
export function dag(v: View, ts: SnapTask[], w: number, sel: string, kind: (t: SnapTask) => GlyphK, facts: (t: SnapTask) => string[] = () => [], press: (t: SnapTask) => Partial<Seg> = () => ({})): Line[] {
  const c = ucfg(v), out = (id: string, k: 'blocks' | 'conditional-blocks') => ts.filter(t => t.deps.some(d => d.id === id && d.type === k)).map(t => t.id)
  const narrow = w < 80
  return joinSections(cols(ts).map((col, depth) => {
    const lines: Line[] = narrow ? [title(`Depth ${depth}`)] : []
    for (const t of col) {
      const k = kind(t), b = out(t.id, 'blocks'), cd = out(t.id, 'conditional-blocks'), p = press(t)
      const s = row({ glyph: glyph(k, c.ascii), id: t.id, title: t.title, facts: [...facts(t), ...(b.length ? [`${edge('blocks', c.ascii)} ${b.join(' ')}`] : []), ...(cd.length ? [`${edge('cond', c.ascii)} ${cd.join(' ')}`] : [])] }, Math.min(w, 72), narrow ? 2 : 2 + Math.min(depth, 4) * 2)
      const i = s.search(/\S/)
      lines.push(t.id === sel ? [S(s, undefined, { i: true, ...p })] : [S(s.slice(0, i)), gseg(k, c.ascii), S(s.slice(i + 1), undefined, p)])
    }
    return relax(lines, c.density)
  }), c.density)
}

export const graph: Renderer = (v, w, rows, a) => {
  const ts = at(v).tasks
  if (!ts.length) return { lines: [[muted(`  no tasks yet${SEP}/cadre <goal> to start`)]], keys: [] }
  const sel = (v.ui.sel as string | undefined) ?? [...ts].filter(t => t.state === 'active' || t.state === 'review').sort((x, y) => y.phaseSince - x.phaseSince)[0]?.id ?? ts[0].id
  const all = dag(v, ts, w, sel, t => gk(kindOf(t, ts)), undefined, t => ({ k: `n:${t.id}`, p: () => a.pick(t.id) }))
  return { lines: win(all, Math.max(0, all.findIndex(l => l.some(s => s.i))), rows), keys: keyLine([['n', 'next', () => a.step('node', 1)], ['p', 'prev', () => a.step('node', -1)], ['o', 'open', () => a.pick(sel)]]) }
}
