// UI v2 shared facts (TUI-DESIGN §3-§5): what is running, who owns it, the step names, the drive cell. Pure; colours/glyphs only via ../tokens, widths via ../layout.
import type { Decision, SnapTask } from '../../types'
import { type Line, type Seg, type View, S, attention, kindOf, stepsOf } from '../model'
import { type GlyphK, color, glyph, glyphRole, readCfg, SEP } from '../tokens'
import { elapsed, clip, width } from '../layout'

export const ascii = (v: View) => readCfg(v.ui).ascii
export const g = (v: View, k: GlyphK, o: Partial<Seg> = {}): Seg => S(glyph(k, ascii(v)), color(glyphRole(k)), k === 'attn' ? { b: true, ...o } : o)
export const sw = (s: Seg) => width(s.t) + (s.hk ? width(s.hk) + 2 : 0)   // a plain Button draws `k: label`
export const lw = (l: Line) => l.reduce((n, s) => n + sw(s), 0)

// BRAND §5 step names
const STEP: Record<string, string> = { tester: 'spec', red: 'red', worker: 'implement', green: 'green', reviewer: 'review', merge: `merged`, explorer: 'explore', report: 'report' }
export const stepName = (s: string) => STEP[s] ?? s
export const steps = (t: SnapTask): string[] => stepsOf(t).filter(s => !(t.lane === 'lite' && (s === 'tester' || s === 'red')))
export const glyphOf = (t: SnapTask, all: SnapTask[]): GlyphK => ({ crit: 'fail', ok: 'done', run: 'run', idle: 'skip', wait: 'wait', ready: 'ready', attn: 'attn', warn: 'attn' } as const)[kindOf(t, all)]

export const running = (ts: SnapTask[]) => ts.filter(t => kindOf(t, ts) === 'run').sort((a, b) => b.phaseSince - a.phaseSince)
export const prog = (ts: SnapTask[]) => `${ts.filter(t => t.state === 'done').length}/${ts.length}`
export const since = (v: View, t: SnapTask) => v.ring.find(e => e.type === 'agent.bound' && e.data.taskId === t.id && e.data.role === t.owner?.split(' ')[0])?.at ?? t.phaseSince
export const lapse = (v: View, t: SnapTask) => elapsed(v.now - since(v, t))
export const selId = (v: View, ts: SnapTask[]) => { const u = v.ui.sel as string | undefined; return u && ts.some(t => t.id === u) ? u : running(ts)[0]?.id ?? ts[0]?.id ?? '' }
export const why = (t: SnapTask, all: SnapTask[]) => {
  const c = t.deps.find(d => d.type === 'conditional-blocks')
  if (c) return `runs only if ${c.id} fails`
  const open = t.deps.filter(d => all.find(x => x.id === d.id)?.state !== 'done').map(d => d.id)
  return open.length ? `after ${open.join(' ')}` : t.state === 'blocked' ? 'blocked' : 'ready'
}

// the decisions the human owes (+ a blocked task's question), oldest first; containment/sync are problems, not needs
export type Need = { id?: string; text: string; short: string; d?: Decision; sel?: string; tab: string }
export const isRun = (d?: Decision) => !!d?.id.startsWith('run:')
export const needsOf = (v: View): Need[] => attention(v).filter(i => (i.d && !isRun(i.d)) || i.key.startsWith('q:')).map(i => ({ id: i.d?.id, text: i.text, short: i.short ?? i.text, d: i.d, sel: i.sel, tab: i.tab }))
// an init/setup run in flight is progress, not a question: the band and the Board draw it as the "now" line
export const runOf = (v: View): Decision | undefined => (v.b.decisions ?? []).find(isRun)
export const stopK = (reason?: string): GlyphK => (/fail|outside|moved|changed|degraded/i.test(reason ?? '') ? 'fail' : 'wait')   // danger colour is for failures; a limit is a plain stop
export const problem = (v: View): string | undefined => {
  if (v.b.containment.state === 'degraded') return `containment degraded${SEP}/cadre doctor`
  const s = v.b.sync.find(x => x.state === 'offline' && v.now - x.at > 60000)
  return s ? `sync offline ${elapsed(v.now - s.at)}` : undefined
}

// drive cell (band line 2 / header). Extra fields arrive with the autonomy modes; absent = auto defaults.
type Drv = { on: boolean; turns: number; costUsd: number; mode?: string; maxTurns?: number; paused?: string; stopped?: string }
export type Cell = { kind: 'run' | 'paused' | 'stopped' | 'unfinished'; mode: string; text: string; key: 'stop' | 'resume' | 'continue'; reason?: string }
// a plan asked for yolo but the drive runs auto: the agents are not contained
export const downgraded = (v: View): boolean => v.b.drive.mode === 'auto' && (v.b.plan as { mode?: string } | undefined)?.mode === 'yolo'
export function driveOf(v: View): Cell | undefined {
  const d = v.b.drive as Drv, p = v.b.plan
  if (p && !d.on && !d.stopped && v.ui.cont === p.id && p.state === 'approved') return { kind: 'unfinished', mode: (p as { mode?: string }).mode ?? 'auto', text: `unfinished plan${SEP}${prog(v.b.tasks)}`, key: 'continue' }   // an earlier session left it (core/session.rehydrate): one key, 0, means continue while nothing drives it
  if (!p || p.state === 'done-on-dev' || p.state === 'released' || !(d.on || d.stopped)) return undefined
  const pm = (p as { mode?: string }).mode, mode = d.mode ?? pm ?? 'auto', max = d.maxTurns ?? v.c.maxTurns
  const label = downgraded(v) ? `${mode} (yolo needs containment)` : mode
  if (d.stopped) return { kind: 'stopped', mode, text: `stopped${SEP}${d.stopped}`, key: 'resume', reason: d.stopped }
  if (d.paused) return { kind: 'paused', mode, text: `${label}${SEP}paused${SEP}${d.paused}`, key: 'stop', reason: d.paused }
  return { kind: 'run', mode, text: `${label}${SEP}turn ${d.turns}/${max}${SEP}$${d.costUsd.toFixed(2)}`, key: 'stop' }
}
// one line, left + right, the widest left segment gives way first
export function lr(w: number, left: Line, right: Line): Line {
  const room = w - lw(right) - (right.length ? 2 : 0)
  let over = lw(left) - room
  const out = left.map(s => s)
  if (over > 0) { const i = out.reduce((m, s, j) => (width(s.t) > width(out[m].t) ? j : m), 0); out[i] = { ...out[i], t: clip(out[i].t, Math.max(1, width(out[i].t) - over)) } }
  return right.length ? [...out, S(' '.repeat(Math.max(1, w - lw(out) - lw(right)))), ...right] : out
}
