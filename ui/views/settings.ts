// UI v2 · 9 Settings (TUI-DESIGN 4.6): every key with its value and a muted source tag, grouped (Drive included: bounds + mode), the selected row inverse.
// Keys: e changes the selected row (a toggle flips, an enum cycles, a number/text asks), n/p move. Presses go through acts.run (`config …`); replay is read-only.
import { type Line, S } from '../model'
import { clip, padL, padR } from '../layout'
import { INDENT, SEP, glyph } from '../tokens'
import { actOf, groupOf, rowsOf, val } from '../settings'
import { type Renderer, joinSections, keyLine, muted, relax, title, ucfg, win } from './types'

const WORD = { bool: 'toggle', enum: 'cycle', number: 'change', text: 'change', list: 'change' } as const
const KEY_NOTE: Record<string, string> = { 'drive.mode': 'yolo: no questions after approval' }
const NOTE = (cls: string, key = '') => [KEY_NOTE[key], cls === 'S' ? 'tighten-only from repo' : cls === 'U' ? 'user-level only' : ''].filter(Boolean).join(SEP)

export const settings: Renderer = (v, cols, rows, a) => {
  const w = Math.min(cols, 80)   // keys and values stay close together on a wide pane
  const rs = rowsOf(v), c = ucfg(v), live = v.t === null
  if (!rs.length) return { lines: [[muted('  no settings loaded yet')]], keys: keyLine(live ? [['r', 'refresh', () => a.run?.('refresh')]] : []) }
  const sel = Math.min(Math.max(0, Number(v.ui.ssel ?? 0)), rs.length - 1), tag = w >= 60 ? 8 : 0
  const kw = Math.min(26, Math.floor((w - INDENT - 6) / 2)), vw = Math.max(4, w - INDENT - kw - 1 - (tag ? tag + 2 : 0))
  const secs: Line[][] = []
  rs.forEach((r, i) => {
    if (!i || groupOf(r) !== groupOf(rs[i - 1])) secs.push([title(groupOf(r))])
    const text = ' '.repeat(INDENT) + padR(clip(r.key, kw), kw) + ' ' + padR(clip(val(r), vw), vw), t = tag ? `  ${padL(r.src, tag)}` : ''
    const at = secs.at(-1)!
    at.push(i === sel ? [S(glyph('run', c.ascii) + text.slice(1) + t, undefined, { i: true })] : [S(text), muted(t)])
  })
  const r = rs[sel], note = NOTE(r.cls, r.key)
  const all = joinSections(secs.map(s => relax(s, c.density)), c.density), body = win(all, all.findIndex(l => l.some(x => x.i)), Math.max(2, rows - 1))
  // a section title whose rows were all cut off is not drawn: the "+n more" line is the tail
  const n = body.length
  if (n > 1 && /^\s*\+\d+ more$/.test(body[n - 1][0]?.t ?? '') && body[n - 2].length === 1 && body[n - 2][0].b) body.splice(n - 2, 1)
  return { lines: [...body, [muted(clip(`${' '.repeat(INDENT)}default ${val({ ...r, value: r.def })}${note ? `${SEP}${note}` : ''}`, w))]],
    keys: keyLine(live ? [['e', WORD[r.kind], () => a.run?.(actOf(r))], ['n', 'next', () => a.run?.('sel 1')], ['p', 'prev', () => a.run?.('sel -1')]] : []) }
}
