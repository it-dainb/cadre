// UI v2 Band v2 (TUI-DESIGN §3): line 1 "now" (or the problem), line 2 "needs you" or the drive cell. Nothing when there is no plan and nothing needs you. `1` answers, `0` stops/resumes the drive.
// The band is only the transcript column wide when the pane is docked (24 cells at 120): every tier below keeps the keys and the "+N more" count, and gives the words up first.
import { type Acts, type Line, type Seg, type View, S } from '../model'
import { asciiText, color, SEP } from '../tokens'
import { clip, width } from '../layout'
import { driveOf, g, lr, lw, needsOf, problem, prog, running, runOf, stepName, stopK, lapse, ascii } from './facts'

const muted = (t: string): Seg => S(t, color('muted'))
export function band2(v: View, w: number, a: Acts): Line[] {
  const out = lines(v, w, a)
  return ascii(v) ? out.map(l => l.map(s => ({ ...s, t: asciiText(s.t) }))) : out
}
function lines(v: View, w: number, a: Acts): Line[] {
  const p = v.b.plan, needs = needsOf(v), dr = driveOf(v), bad = problem(v), ts = v.b.tasks, job = runOf(v)
  if (!p && !needs.length && !job) return []
  const landed = p && (p.state === 'done-on-dev' || p.state === 'released'), run = running(ts), top = run[0]
  const wide = w >= 100, tight = w < 50
  const dkey = dr ? S(dr.key, undefined, { k: 'drv', hk: '0', p: () => a.drive?.(dr.key) }) : undefined
  const bothCell: Seg[] = dr && needs.length ? [muted(w < 40 ? '' : `${dr.kind === 'run' ? dr.mode : dr.text}${SEP}`), dkey!] : []
  // line 1
  let l1: Line = []
  if (p) {
    const head = `${p.id}${wide ? ` ${p.slug}` : ''}`, pr = prog(ts)
    const right: Line = bothCell.length ? [muted(wide ? `${head}${SEP}${pr}${SEP}` : ''), ...bothCell] : [muted(tight ? '' : wide ? `${head}${SEP}${pr}` : pr)]
    if (bad) l1 = lr(w, [g(v, 'fail'), S(' '), S(bad, color('danger'))], right.filter(s => s.t || s.hk))
    else if (landed) l1 = lr(w, [g(v, 'done'), S(` ${p.id} landed on dev`)], right.filter(s => s.t || s.hk))
    else if (top) {
      const more = run.length > 1 ? `${SEP}+${run.length - 1} running` : `${SEP}${stepName(top.step)}${lapse(v, top) && `${SEP}${lapse(v, top)}`}`
      const left: Line = tight ? [g(v, 'run'), S(` ${top.id}${SEP}${prog(ts)}`)] : [g(v, 'run'), S(` ${top.id} `), S(top.title, undefined, { b: false }), muted(more)]
      l1 = lr(w, left, tight ? bothCell.filter(s => s.hk) : right.filter(s => s.t || s.hk))
    } else l1 = lr(w, [g(v, 'wait'), muted(` ${p.id} ${prog(ts)}`)], bothCell.filter(s => s.hk || s.t))
  } else if (job) l1 = [g(v, 'run'), S(clip(` ${job.id.slice(4)} is running${tight ? '' : `${SEP}Claude is on it`}`, w - 2))]   // init/setup: progress, no key
  // line 2
  let l2: Line | undefined
  if (needs.length) {
    const n = needs[0], more = needs.length > 1 ? `${SEP}+${needs.length - 1} more` : ''
    const key = S(n.d ? 'answer' : 'open', undefined, { k: 'att', hk: '1', p: () => (n.d ? a.answer(n.id!) : n.sel ? a.pick(n.sel) : a.go(n.tab)) })
    const tag: Seg[] = [g(v, 'attn')], label = S(' NEEDS YOU', color('attention'), { b: true })
    // room for the title once the key, the mark and the "+N more" count (never cut) are placed
    const room = (pre: number) => w - lw([key]) - 2 - 1 - pre - width(more)
    const wordy = !tight && room(width(label.t) + width(SEP)) >= 14
    const r = room(wordy ? width(label.t) + width(SEP) : 1), text = wide ? n.text : n.short
    const title = r >= 8 ? clip(text, r) : ''
    l2 = lr(w, [...tag, ...(wordy ? [label, S(`${SEP}${title}${more}`)] : [S(title ? ` ${title}${more}` : needs.length > 1 ? ` +${needs.length - 1} more` : '')])], [key])
  } else if (dr && dkey) {
    const t = w < 30 ? dr.mode : tight ? dr.text.replace(new RegExp(`${SEP}turn \\d+/\\d+`), '') : w < 100 ? dr.text.replace('turn ', '') : dr.text
    l2 = lr(w, dr.kind === 'run' ? [muted(t)] : [g(v, dr.kind === 'stopped' ? stopK(dr.reason) : 'wait'), muted(` ${w < 30 ? dr.kind : t}`)], [dkey])
  }
  return [...(l1.length ? [l1] : []), ...(l2 ? [l2] : [])]
}
