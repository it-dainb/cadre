// UI v2 Board (TUI-DESIGN §4.2): Needs you › Agents › Running › Waiting › Done, the inspector, a timeline summary line. Wide (>= 116): inspector on the right; narrower: below.
import type { SnapTask } from '../../types'
import { type Acts, type Line, type Seg, type View, S, at, kindOf, t0 } from '../model'
import { COL, color, densityOf, flashOn, glyph, readCfg, SEP, ARROWS, glyphRole , cursor} from '../tokens'
import { clip, elapsed, padL, padR, plain, plural, relTime, row, width } from '../layout'
import { type Renderer, keyLine } from '../views/types'
import { noPlanBody } from './states'
import { ascii, g, glyphOf, lapse, lw, needsOf, running, runOf, selId, stepName, steps, why } from './facts'

const sp = (...a: Seg[]): Line => a
const blank: Line = [S(' ')]
const title = (t: string, right = ''): Line => sp(S(t, undefined, { b: true }), ...(right ? [S(right, color('muted'))] : []))
const NARROW_INSPECTOR = 116, INSPECTOR_W = 44

const checkColor = (m: string) => color(m === glyph('done', false) ? glyphRole('done') : m === glyph('fail', false) ? glyphRole('fail') : m === glyph('attn', false) ? 'attention' : 'muted')
// ---- Needs you (read-only; `1` opens the dialog, ADR 0012) ----
export function needsFull(v: View, w: number, a: Acts, rows = 40): Line[] {
  const ns = needsOf(v); if (!ns.length) return []
  const out: Line[] = [sp(S('NEEDS YOU', color('attention'), { b: true }))]
  ns.forEach((n, i) => {
    const bt = S(n.d ? 'answer' : 'open', undefined, { k: i ? `ans:${n.id ?? n.sel}` : 'att', ...(i ? {} : { hk: '1' }), p: () => (n.d ? a.answer(n.id!) : n.sel ? a.pick(n.sel) : a.go(n.tab)) })
    const head = sp(S('  '), g(v, 'attn'), S(' '), S(clip(n.text, Math.max(8, w - 6 - lw([bt]))), undefined, { b: true }))
    out.push([...head, S(' '.repeat(Math.max(1, w - lw(head) - lw([bt])))), bt])
    const tk = v.b.tasks.find(t => t.id === n.sel)
    if (n.d?.error) out.push(sp(S(clip(`    ${plain(n.d.error)}`, w), color('danger'))))
    // at most two detail lines per decision on a short pane (the dialog has the rest); a bare task title gets its id; a `! command` is shown as `$ command` (`!` marks a needs-you row only)
    for (const l of (n.d?.lines ?? []).slice(0, rows < 24 ? 2 : 6)) out.push(sp(S(clip(`    ${/^\s*! /.test(l) ? l.replace('! ', '$ ') : tk && l === tk.title ? `${tk.id} ${l}` : plain(l)}`, w), color('muted'))))
  })
  return out
}
// every other view: the one-line form
export function needsOne(v: View, w: number, a: Acts): Line[] {
  const ns = needsOf(v); if (!ns.length) return []
  const n = ns[0], more = ns.length > 1 ? `${SEP}+${ns.length - 1} more` : ''
  const bt = S(n.d ? 'answer' : 'open', undefined, { k: 'att', hk: '1', p: () => (n.d ? a.answer(n.id!) : n.sel ? a.pick(n.sel) : a.go(n.tab)) })
  const pre = w < 50 ? sp(g(v, 'attn'), S(' ')) : sp(g(v, 'attn'), S(' NEEDS YOU', color('attention'), { b: true }), S(`${SEP}`))
  const room = Math.max(8, w - lw(pre) - lw([bt]) - width(more) - 2)
  const l = [...pre, S(clip(w >= 100 ? n.text : n.short, room) + more)]
  return [[...l, S(' '.repeat(Math.max(1, w - lw(l) - lw([bt])))), bt]]
}

// init/setup in flight (TUI-DESIGN §7): the run checklist under the header, as progress; the question inside it (if any) is its own decision
export function runBody(v: View, w: number): Line[] {
  const d = runOf(v), out: Line[] = [sp(g(v, 'run'), S(clip(` ${d ? d.title.replace(`${SEP}Claude is on it`, '') : `${v.sec.run?.kind} is running`}`, w - 2), undefined, { b: true }))]
  for (const l of d?.lines ?? []) out.push(sp(S(clip(`    ${l}`, w), checkColor(l[0]))))
  return [...out, ...(v.sec.run ? [sp(S(clip(`  ${v.sec.run.kind} is running${SEP}the checks run again when Claude stops`, w), color('muted')))] : [])]   // stopped: the run is over, its dialog says what is left
}
// ---- sections ----
function trow(v: View, t: SnapTask, w: number, a: Acts, o: { sel: string; flash: string[]; facts?: string[]; time?: string; mute?: boolean }): Line {
  const k = glyphOf(t, at(v).tasks), fl = o.flash.includes(t.id), just = !fl && flashOn(v.ui) && v.t === null && t.phaseSince > 0 && v.now - t.phaseSince < 30000
  const s = row({ glyph: glyph(k, ascii(v)), id: t.id, title: t.title, facts: [...(o.facts ?? []), ...(just ? ['just now'] : [])], time: o.time }, w)
  const style: Partial<Seg> = fl ? { c: color('accent'), b: true } : o.mute ? { c: color('muted') } : {}
  return sp(S(s.slice(0, 2)), g(v, k), S(s.slice(3), undefined, { ...style, ...(o.sel === t.id ? { i: true } : {}), k: `n:${t.id}`, p: () => a.pick(t.id) }))
}
function agentRow(v: View, t: SnapTask, w: number, ctxOn: boolean): Line {
  const role = t.owner?.split(' ')[0] ?? '', head = `  ${padR(role, COL.role)} ${padR(t.id, COL.id)}  `
  const right = padL(lapse(v, t), COL.time) + (ctxOn && t.ctx !== undefined ? padL(`ctx ${t.ctx}%`, COL.ctx) : '')
  const step = clip(stepName(t.step), Math.max(1, w - width(head) - width(right) - 1))
  return sp(S(head + step + ' '.repeat(Math.max(1, w - width(head) - width(step) - width(right))) + right))
}
const doneAt = (v: View, t: SnapTask) => v.ring.findLast(e => e.taskId === t.id && e.type === 'task.transitioned' && e.data.to === 'done')?.at ?? t.phaseSince
export const doneOpen = (v: View, n: number) => (n <= 3) !== (v.ui.dn === true)

export function sections(v: View, w: number, a: Acts, flash: string[], ctxOn = w >= 80): Line[] {
  const b = at(v), ts = b.tasks, sel = selId(v, ts), dens = densityOf(v.ui), gap: Line[] = dens === 'compact' ? [] : [blank]
  const asked = new Set(needsOf(v).map(n => n.sel))
  const run = running(ts), ag = run.filter(t => t.owner)
  const wait = ts.filter(t => ['ready', 'wait'].includes(kindOf(t, ts)) && !asked.has(t.id)), fin = ts.filter(t => ['ok', 'idle'].includes(kindOf(t, ts)))
  const rel: Line[] = dens === 'relaxed' ? [blank] : []
  const rows = (xs: SnapTask[], f: (t: SnapTask) => Parameters<typeof trow>[4]) => xs.flatMap(t => [trow(v, t, w, a, { sel, flash, ...f(t) }), ...rel])
  const blocks: Line[][] = []
  const crit = (t: SnapTask) => kindOf(t, ts) === 'crit'
  const live = ts.filter(t => kindOf(t, ts) === 'run' || crit(t))
  if (w >= 40 && ag.length) blocks.push([title('Agents'), ...ag.map(t => agentRow(v, t, w, ctxOn))])
  if (live.length) blocks.push([title('Running'), ...rows(live, t => ({ facts: crit(t) ? ['FAILED'] : t.owner ? [] : [stepName(t.step)] }))])   // an agent's row above already names the step
  if (w >= 40 && wait.length) blocks.push([title('Waiting'), ...rows(wait, t => ({ facts: [why(t, ts)], mute: kindOf(t, ts) === 'wait' }))])
  if (w >= 40 && fin.length) {
    const open = doneOpen(v, fin.length)
    const sk = fin.filter(t => t.state !== 'done').length
    blocks.push([title('Done', `  ${fin.length - sk}${sk ? `${SEP}${sk} skipped` : ''}`), ...(open ? rows(fin.slice().sort((x, y) => doneAt(v, y) - doneAt(v, x)), t => ({ facts: [t.state === 'done' ? (t.kind === 'spike' ? 'reported' : `merged`) : 'skipped'], time: relTime((v.t ?? v.now) - doneAt(v, t)), mute: true })) : [])])
  }
  return blocks.flatMap((x, i) => (i ? [...gap, ...x] : x))
}

// ---- inspector ----
export function inspector(v: View, w: number, one: boolean): Line[] {
  const ts = at(v).tasks, t = ts.find(x => x.id === selId(v, ts)); if (!t) return []
  const head = sp(S(`${t.id}  `, undefined, { b: true }), S(clip(`${t.title}${SEP}${t.type}`, Math.max(8, w - width(t.id) - 2)), undefined, { b: true }))
  if (one) return [head]
  const sts = steps(t), cur = t.state === 'done' ? sts.length : sts.indexOf(t.step), pipe: Seg[][] = sts.map((s, i) => {
    const mark = i < cur ? g(v, 'done') : i === cur ? g(v, 'run') : undefined
    return [S(stepName(s), i > cur || cur < 0 ? color('muted') : undefined), ...(mark ? [S(' '), mark] : [])]
  })
  const lines: Line[] = [[]]
  for (const p of pipe) { const l = lines[lines.length - 1]; if (l.length && lw(l) + 2 + lw(p) > w - 2) lines.push([]); const x = lines[lines.length - 1]; if (x.length) x.push(S('  ')); x.push(...p) }
  const ups = t.deps.map(d => d.id), downs = ts.filter(x => x.deps.some(d => d.id === t.id)).map(x => x.id)
  const rel = [ups.length ? `after ${ups.join(' ')}` : '', downs.length ? `unblocks ${downs.join(' ')}` : '', t.owner && t.state !== 'done' ? t.owner.split(' ')[0] : ''].filter(Boolean).join(`${SEP}`)
  return [head, ...lines.map(l => sp(S('  '), ...l)), sp(S(clip(`  ${rel || 'no dependencies'}`, w), color('muted')))]
}

export function timelineLine(v: View, w: number): Line {
  const ts = at(v).tasks, n = running(ts).filter(t => t.owner).length, off = v.b.sync.find(s => s.state === 'offline')
  const t = ['Timeline', elapsed(v.now - t0(v)), n ? plural(n, 'agent') : '', off ? `sync offline ${elapsed(v.now - off.at)}` : ''].filter(Boolean)
  return sp(S(clip(`${t[0]}  ${t.slice(1).join(`${SEP}`)}`, w - 11), undefined, { b: false }), S('  3: open', color('muted')))
}

export function board(v: View, w: number, a: Acts): Line[] {
  const ts = at(v).tasks, flashed = ts.filter(t => t.phaseSince > 0 && v.now - t.phaseSince < 1500).map(t => t.id)
  const flash = readCfg(v.ui).flash && v.t === null && flashed.length <= 3 ? flashed : []
  if (w < 40) return [...sections(v, w, a, flash), sp(S('widen the pane for more', color('muted')))]
  if (w >= NARROW_INSPECTOR) {
    const lw0 = w - INSPECTOR_W - 3, L = sections(v, lw0, a, flash, true), R = inspector(v, INSPECTOR_W, false)
    const body = Array.from({ length: Math.max(L.length, R.length) }, (_, i) => { const l = L[i] ?? [], pad = Math.max(0, lw0 - lw(l)); return [...l, S(' '.repeat(pad)), S(` ${cursor(ascii(v))} `, color('rule')), ...(R[i] ?? [])] })
    return [...body, blank, timelineLine(v, w)]
  }
  return [...sections(v, w, a, flash), blank, ...inspector(v, w, w < 60), blank, timelineLine(v, w)]
}

// the frame's Renderer for the Board tab: body + footer keys (`↑↓` is the engine's focus ring over the task rows; `c` only when Done has rows)
export const boardView: Renderer = (v, w, _rows, a) => {
  const ts = at(v).tasks, fin = ts.filter(t => ['ok', 'idle'].includes(kindOf(t, ts))).length
  const hint = ts.length > 1 && w >= 60 ? [S(`${ARROWS.slice(0, 2)}: select`, color('muted'))] : []
  const c = fin > 3 ? keyLine([['c', w < 60 ? 'done' : doneOpen(v, fin) ? 'collapse done' : 'expand done', () => a.step('done', 0)]]) : []
  if (v.sec.run) return { lines: runBody(v, w), keys: [] }
  if (!ts.length) return { lines: noPlanBody(w), keys: [] }
  return { lines: board(v, w, a), keys: [...hint, ...(hint.length && c.length ? [S('  ')] : []), ...c] }
}
