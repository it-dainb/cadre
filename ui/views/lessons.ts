// UI v2 · 6 Lessons (H10): what the work taught, one row each: the text, its scope (repo or you) and how many records back it. x prunes the selected row for good, n/p move, r refreshes.
// The rows ride in the ui atom (`lessons.rows`, written by config/route.refreshLessons: the pane cannot read the store). Presses go through acts.run (`config lprune <id>`).
import { type Line, S } from '../model'
import { clip, padR } from '../layout'
import { INDENT, SEP, glyph } from '../tokens'
import { type Renderer, keyLine, muted, ucfg, win } from './types'

type Row = { id: string; text: string; scope: 'repo' | 'user'; ev: number }
export const lessons: Renderer = (v, cols, rows, a) => {
  const w = Math.min(cols, 80), rs = (v.ui['lessons.rows'] as Row[] | undefined) ?? [], c = ucfg(v), live = v.t === null
  const sel = Math.min(Math.max(0, Number(v.ui.lsel ?? 0)), Math.max(0, rs.length - 1)), at = rs[sel]
  const lines: Line[] = rs.length ? rs.map((r, i) => {
    const tag = `${r.scope === 'user' ? 'you' : 'repo'}${SEP}${r.ev} ${r.ev === 1 ? 'record' : 'records'}`, text = ' '.repeat(INDENT) + clip(r.text, w - INDENT - tag.length - 2)
    return i === sel ? [S(glyph('run', c.ascii) + padR(text, w - tag.length - 2).slice(1) + `  ${tag}`, undefined, { i: true })] : [S(padR(text, w - tag.length - 2)), muted(`  ${tag}`)]
  }) : [[muted('  no lessons yet: they appear after a plan lands, when the work has something to teach')]]
  return { lines: win(lines, sel, Math.max(2, rows - 1)), keys: keyLine(live ? [...(at ? [['x', 'prune', () => a.run?.(`lprune ${at.id}`)] as const, ['n', 'next', () => a.run?.('lsel 1')] as const, ['p', 'prev', () => a.run?.('lsel -1')] as const] : []), ['r', 'refresh', () => a.run?.('lessons')]] : []) }
}
