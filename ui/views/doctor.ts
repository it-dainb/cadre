// UI v2 · 8 Doctor (TUI-DESIGN 4.6): Drive (state, bounds, turns/$), Decisions (what yolo recorded, newest first), then the health checks as glyph + colour rows with muted `fix:` lines.
// The checks ride in the ui atom (`doctor.rows`, written by /cadre doctor); drive state is the board's; decisions are the epic's `drive.decided` events (read-only).
import { type Line, type View, S } from '../model'
import { clip, elapsed, padL, relTime } from '../layout'
import { COL, DETAIL, INDENT, SEP, type GlyphK } from '../tokens'
import { type Renderer, gseg, joinSections, muted, relax, title, ucfg } from './types'

const SP = ' '.repeat(INDENT), usd = (n: number) => `$${n.toFixed(2)}`
const KIND: Record<string, GlyphK> = { ok: 'done', warn: 'attn', crit: 'fail' }

export function driveRows(v: View, w: number): Line[] {
  const c = ucfg(v), d = v.b.drive, mode = d.mode ?? v.b.plan?.mode
  const of = (k: GlyphK, text: string, fix?: string): Line[] => [[S(SP), gseg(k, c.ascii), S(clip(` ${text}`, w - INDENT - 1))], ...(fix ? [[muted(clip(`${' '.repeat(DETAIL)}fix: ${fix}`, w))]] : [])]
  if (d.stopped) return of('fail', `drive stopped: ${d.stopped}`, 'check the cause, then press 2 on the band to resume')
  if (!d.on) return of('wait', `drive off${SEP}it starts when you approve a plan`)
  const bounds = [`turn ${d.turns}${d.maxTurns ? ` of ${d.maxTurns}` : ''}`, `${usd(d.costUsd)}${d.maxUsd ? ` of ${usd(d.maxUsd)}` : ''}`, ...(d.startedAt ? [`${elapsed(v.now - d.startedAt)}${d.maxMinutes ? ` of ${elapsed(d.maxMinutes * 60000)}` : ''}`] : [])]
  return of(d.paused ? 'attn' : 'run', [d.paused ? `drive paused: ${d.paused}` : 'drive running', ...(mode ? [mode] : []), ...bounds].join(SEP))
}
export function decisionRows(v: View, w: number, max = 5): Line[] {
  const ds = v.ring.filter(e => String(e.type) === 'drive.decided' && e.at <= (v.t ?? v.now)).reverse()
  return [...ds.slice(0, max).map((e): Line => [muted(`${SP}${padL(relTime((v.t ?? v.now) - e.at), COL.actTime)}  `), S(clip(String(e.data.text), Math.max(1, w - INDENT - COL.actTime - 2)))]), ...(ds.length > max ? [[muted(`${SP}+${ds.length - max} older`)]] : [])]
}

export const doctor: Renderer = (v, w, rows) => {
  const c = ucfg(v), rs = (v.ui['doctor.rows'] as [string, string, string?][] | undefined) ?? []
  const checks: Line[] = rs.length ? rs.flatMap(([k, t, f]) => [[S(SP), gseg(KIND[k] ?? 'wait', c.ascii), S(clip(` ${t}`, w - INDENT - 1))] as Line, ...(f ? [[muted(clip(`${' '.repeat(DETAIL)}fix: ${f}`, w))] as Line] : [])]) : [[muted(`  no report yet${SEP}run /cadre doctor`)]]
  const dec = decisionRows(v, w)
  const lines = joinSections([[title('Drive'), ...driveRows(v, w)], ...(dec.length ? [[title('Decisions'), ...dec]] : []), [title('Checks'), ...relax(checks, c.density)]], c.density)
  return { lines: lines.slice(0, Math.max(1, rows)), keys: [] }
}
