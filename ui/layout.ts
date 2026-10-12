// UI v2 layout helpers (BRAND §5, §7): fixed-column rows, priority truncation, relative times, plurals. Pure strings; colour/glyphs come from tokens.
import { ALLOWED } from './tokens'

// cell width: the BRAND glyph set and ASCII are 1; anything else outside Latin/BMP-narrow is flagged (returns 2) so tests can reject it
export const cw = (ch: string): number => {
  const c = ch.codePointAt(0)!
  if (c < 0x20 || (c >= 0x300 && c < 0x370)) return 0
  if (ALLOWED.has(ch) || c < 0x2e80) return 1
  return 2   // CJK, emoji, wide forms: not in the glyph set
}
export const width = (s: string): number => [...s].reduce((n, ch) => n + cw(ch), 0)
export const strange = (s: string): string[] => [...new Set([...s].filter(ch => !ALLOWED.has(ch) && ch.codePointAt(0)! >= 0x2000))]   // characters outside the BRAND set (for lint)

export const clip = (s: string, n: number): string => {
  if (width(s) <= n) return s
  let out = '', w = 0
  for (const ch of s) { if (w + cw(ch) > n - 1) break; out += ch; w += cw(ch) }
  return n > 0 ? out + '…' : ''
}
export const padR = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - width(s)))
export const padL = (s: string, n: number): string => ' '.repeat(Math.max(0, n - width(s))) + s

// A task row: `  <glyph> <id:3>  <title:flex>  <facts…>  <time:6>`. Never cut: indent, glyph, id, key hint. Drop facts right to left first, then shorten the title.
export type RowIn = { glyph: string; id: string; title: string; facts?: string[]; time?: string; key?: string }
export function row(r: RowIn, w: number, indent = 2): string {
  const head = `${' '.repeat(indent)}${r.glyph} ${padR(r.id, 3)}  `, tail = r.key ? `  ${r.key}` : ''
  const time = r.time === undefined ? '' : padL(r.time, 6)
  const facts = [...(r.facts ?? [])]
  const build = () => {
    const f = facts.length ? facts.join(' · ') : '', right = [f, time].filter(Boolean).join(' ')
    return { f, right }
  }
  const room = (right: string) => w - width(head) - width(tail) - (right ? width(right) + 2 : 0)
  let { right } = build()
  while (facts.length && room(right) < Math.min(width(r.title), 12)) { facts.pop(); right = build().right }
  const t = clip(r.title, Math.max(1, room(right)))
  const gap = Math.max(right ? 2 : 0, w - width(head) - width(t) - width(right) - width(tail))
  const out = head + t + ' '.repeat(gap) + right + tail
  return width(out) <= w ? out : clip(out, w)   // only a pathological width (< head + key) clips the end
}

// §5: relative times
export const relTime = (ms: number): string => {
  const m = Math.floor(Math.max(0, ms) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}
export const elapsed = (ms: number): string => {
  const m = Math.floor(Math.max(0, ms) / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
