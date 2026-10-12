// UI v2 · Shared by the v2 pane views (graph, timeline, activity, doctor, settings): the return shape, key lines, density, scrolling. Pure; colours and glyphs come from ../tokens only.
import { type Line, type Seg, type TagK, type View, L, S } from '../model'
import { type Density, type GlyphK, color, glyph, glyphRole, readCfg, rule } from '../tokens'

// lines: the body (the frame draws header, tabs, needs-you); keys: one Line of Buttons for the footer; raster: the timeline block, drawn after lines[0..at)
export type VOut = { lines: Line[]; keys: Line; raster?: { cols: number; rows: number; cells: string; at: number } }
export type Renderer = (v: View, cols: number, rows: number, a: import('../model').Acts) => VOut

export const ucfg = (v: View) => readCfg(v.ui)
export const hue = (r: Parameters<typeof color>[0]) => color(r)
// TagK (the board's task classification) → v2 glyph kind
const KIND: Record<TagK, GlyphK> = { attn: 'attn', crit: 'fail', warn: 'attn', run: 'run', ok: 'done', ready: 'ready', wait: 'wait', idle: 'skip' }
export const gk = (k: TagK): GlyphK => KIND[k]
export const gseg = (k: GlyphK, ascii: boolean, o: Partial<Seg> = {}): Seg => S(glyph(k, ascii), color(glyphRole(k)), o)
export const muted = (t: string): Seg => S(t, color('muted'))
export const title = (t: string): Line => [S(t, undefined, { b: true })]
export const ruleLine = (n: number, ascii: boolean): Line => [S(rule(n, ascii), color('rule'))]

// footer keys: the engine draws `k: label` for a plain Button, so labels carry no key
export const keyLine = (ks: [hk: string, label: string, run: () => void][]): Line => ks.flatMap(([hk, label, p], i) => [...(i ? [S('  ')] : []), S(label, undefined, { k: `key:${hk}`, hk, p })])

// BRAND §7 density: sections are separated by one blank row (normal), none (compact); relaxed adds a blank row after every row
export const gapRows = (d: Density): number => (d === 'compact' ? 0 : 1)
export const joinSections = (secs: Line[][], d: Density): Line[] => secs.filter(s => s.length).flatMap((s, i) => [...(i ? Array.from({ length: gapRows(d) }, () => L('')) : []), ...s])
export const relax = (rows: Line[], d: Density): Line[] => (d === 'relaxed' ? rows.flatMap(r => [r, L('')]) : rows)

// scroll window of `rows` lines keeping `at` visible; hidden counts become muted `+n more` lines (within the budget)
export function win(lines: Line[], at: number, rows: number): Line[] {
  if (lines.length <= rows) return lines
  const room = Math.max(1, rows - 2), top = Math.min(Math.max(0, at - Math.floor(room / 2)), lines.length - room)
  return [...(top > 0 ? [[muted(`  +${top} more`)]] : []), ...lines.slice(top, top + room), ...(top + room < lines.length ? [[muted(`  +${lines.length - top - room} more`)]] : [])]
}
