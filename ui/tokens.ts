// UI v2 tokens (BRAND §3, §6, §7): the ONLY file that may hold literal theme keys, glyphs or colours for v2 code. Pure; no host reads here.
// The render hooks cannot read env or files, so session.start resolves `ascii`/`theme`/`flash`/`density` once into the ui atom (`cfg`) and `readCfg` reads them back.

export type Role = 'fg' | 'muted' | 'accent' | 'attention' | 'success' | 'danger' | 'rule'
export const ROLE: Record<Role, string> = { fg: 'text', muted: 'inactive', accent: 'claude', attention: 'warning', success: 'success', danger: 'error', rule: 'subtle' }
export const color = (r: Role): string => ROLE[r]

export type GlyphK = 'attn' | 'run' | 'ready' | 'wait' | 'done' | 'fail' | 'skip'
const GLYPH: Record<GlyphK, [string, string, Role]> = {   // unicode, ascii, colour role
  attn: ['!', '!', 'attention'], run: ['›', '>', 'accent'], ready: ['○', 'o', 'fg'], wait: ['·', '-', 'muted'],
  done: ['✓', '+', 'success'], fail: ['✗', 'x', 'danger'], skip: ['–', '.', 'muted'],
}
export const glyph = (k: GlyphK, ascii: boolean): string => GLYPH[k][ascii ? 1 : 0]
export const glyphRole = (k: GlyphK): Role => GLYPH[k][2]
export const RULE = ['─', '-'] as const
export const rule = (n: number, ascii: boolean): string => RULE[ascii ? 1 : 0].repeat(Math.max(0, n))
export const edge = (k: 'blocks' | 'cond', ascii: boolean): string => (ascii ? (k === 'blocks' ? '->' : '..>') : k === 'blocks' ? '─→' : '┄→')
export const cursor = (ascii: boolean): string => (ascii ? '|' : '│')
const BLOCK: Record<Cell, [string, string]> = { work: ['█', '#'], review: ['▓', '='], offline: ['░', ':'], attention: ['▒', '%'], failure: ['█', 'X'] }
export const block = (c: Cell, ascii: boolean): string => BLOCK[c][ascii ? 1 : 0]
export const ELL = '…', SEP = ' · ', ARROWS = '↑↓←→'   // text marks: truncation, fact separator, key-hint arrows
export const BLOCKS = '█▓▒░'   // Raster cells only (width-1, BMP)
// every glyph v2 may draw, for the acceptance lint: BRAND §6 + the rule + Raster blocks + the separators of §5 + the cursor
export const ALLOWED = new Set([...Object.values(GLYPH).flatMap(g => [g[0], g[1]]), RULE[0], RULE[1], ...BLOCKS, ...ARROWS, ELL, '—', '│', '→', '┄', ...Object.values(BLOCK).flat(), '|', '>', '.'])

// §7: spacing scale, indent, gutters, fixed task-row columns
export const SPACE = [0, 1, 2, 3, 4, 6, 8] as const
export const INDENT = 2, DETAIL = 4, GUTTER = 1, BTN_GAP = 2
export const COL = { glyph: 1, id: 3, role: 9, time: 6, ctx: 8, actTime: 7 } as const

// §3.3: Raster palettes (0x00RRGGBB), default-foreground when the theme is unknown
export type Cell = 'work' | 'review' | 'offline' | 'attention' | 'failure'
export const DEFAULT_FG = 0x01000000
const PAL: Record<'dark' | 'light', Record<Cell, number>> = {
  dark: { work: 0xd77757, review: 0x8a8f98, offline: 0x4b4f57, attention: 0xe5c07b, failure: 0xe06c75 },
  light: { work: 0xb4532e, review: 0x5c6370, offline: 0xc8ccd2, attention: 0x9a6a00, failure: 0xb3261e },
}
export type Theme = 'dark' | 'light' | 'unknown'
// `$.config.list()` rows: the value vocabulary is untyped, so match loosely ("light", "light-daltonized", "dark-ansi"...)
export const themeOf = (rows?: { key: string; value?: unknown }[]): Theme => {
  const v = String(rows?.find(r => r.key === 'theme')?.value ?? '')
  return /^light/.test(v) ? 'light' : /^dark/.test(v) ? 'dark' : 'unknown'
}
export const raster = (c: Cell, t: Theme): number => (t === 'unknown' ? DEFAULT_FG : PAL[t][c])

export { asciiOf } from '../config/index'   // ASCII is automatic for TERM=dumb / non-UTF-8 locale (BRAND §6); core/session.start resolves it

export type Density = 'compact' | 'normal' | 'relaxed'
export type UiCfg = { ascii: boolean; flash: boolean; density: Density; theme: Theme; v2: boolean }
export const UI_DEFAULT: UiCfg = { ascii: false, flash: true, density: 'normal', theme: 'unknown', v2: false }
// readers for the `cadre.ui.cfg` mirror (ui.flash / ui.density / ui.v2 arrive as written by core/session.start)
export const readCfg = (u: Record<string, any> | undefined): UiCfg => {
  const c = (u?.cfg ?? {}) as Record<string, any>
  return {
    ascii: c.ascii ?? c.glyphs === 'ascii', flash: c.flash !== false, theme: c.theme ?? 'unknown', v2: c.v2 === true,
    density: c.density === 'compact' || c.density === 'relaxed' ? c.density : 'normal',
  }
}
export const flashOn = (u: Record<string, any> | undefined): boolean => readCfg(u).flash
export const densityOf = (u: Record<string, any> | undefined): Density => readCfg(u).density

// graph edges (TUI-DESIGN 4.3), Raster cell characters and the timeline cursor; each has an ASCII form
export const edge = (k: 'blocks' | 'cond', ascii: boolean): string => (k === 'blocks' ? (ascii ? '->' : '─→') : ascii ? '..>' : '┄→')
const BLOCK: Record<Cell, [string, string]> = { work: ['█', '#'], review: ['▓', '='], offline: ['░', ':'], attention: ['▒', '%'], failure: ['█', 'X'] }
export const block = (c: Cell, ascii: boolean): string => BLOCK[c][ascii ? 1 : 0]
export const cursor = (ascii: boolean): string => (ascii ? '|' : '│')
ALLOWED.add('┄')
