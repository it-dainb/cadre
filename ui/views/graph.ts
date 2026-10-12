// UI v2 · 2 Graph (TUI-DESIGN 4.3): frameless, one line per task, the depth as indent, `─→` blocks / `┄→` conditional-blocks after the title, the selected task inverse.
// Below 80 columns: the depth list (a title per depth, no indent).
import { type Line, L, S, at, cols, kindOf } from '../model'
import { row } from '../layout'
import { SEP, edge, glyph } from '../tokens'
import { type Renderer, gk, gseg, joinSections, keyLine, muted, relax, title, ucfg, win } from './types'

export const graph: Renderer = (v, w, rows, a) => {
  const c = ucfg(v), ts = at(v).tasks
  if (!ts.length) return { lines: [[muted(`  no tasks yet${SEP}/cadre <goal> to start`)]], keys: [] }
  const sel = (v.ui.sel as string | undefined) ?? [...ts].filter(t => t.state === 'active' || t.state === 'review').sort((x, y) => y.phaseSince - x.phaseSince)[0]?.id ?? ts[0].id
  const out = (id: string, kind: 'blocks' | 'conditional-blocks') => ts.filter(t => t.deps.some(d => d.id === id && d.type === kind)).map(t => t.id)
  const narrow = w < 80
  const secs = cols(ts).map((col, depth) => {
    const lines: Line[] = narrow ? [title(`Depth ${depth}`)] : []
    for (const t of col) {
      const k = gk(kindOf(t, ts)), b = out(t.id, 'blocks'), cd = out(t.id, 'conditional-blocks')
      const s = row({ glyph: glyph(k, c.ascii), id: t.id, title: t.title, facts: [...(b.length ? [`${edge('blocks', c.ascii)} ${b.join(' ')}`] : []), ...(cd.length ? [`${edge('cond', c.ascii)} ${cd.join(' ')}`] : [])] }, Math.min(w, 72), narrow ? 2 : 2 + Math.min(depth, 4) * 2)
      const i = s.search(/\S/), press = { k: `n:${t.id}`, p: () => a.pick(t.id) }
      if (t.id === sel) { lines.push([S(s, undefined, { i: true, ...press })]) }
      else lines.push([S(s.slice(0, i)), gseg(k, c.ascii), S(s.slice(i + 1), undefined, press)])
    }
    return relax(lines, c.density)
  })
  const all = joinSections(secs, c.density)
  return { lines: win(all, Math.max(0, all.findIndex(l => l.some(s => s.i))), rows), keys: keyLine([['n', 'next', () => a.step('node', 1)], ['p', 'prev', () => a.step('node', -1)], ['o', 'open', () => a.pick(sel)]]) }
}
