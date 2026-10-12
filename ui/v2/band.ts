// UI v2 Band v2 (TUI-DESIGN §3): line 1 "now" (or the problem), line 2 "needs you" or the drive cell. Nothing when there is no plan and nothing needs you. `1` answers, `2` stops/resumes the drive.
import { type Acts, type Line, type Seg, type View, S } from '../model'
import { color, SEP } from '../tokens'
import { clip } from '../layout'
import { driveOf, g, lr, needsOf, problem, prog, running, stepName, lapse } from './facts'

const muted = (t: string): Seg => S(t, color('muted'))
export function band2(v: View, w: number, a: Acts): Line[] {
  const p = v.b.plan, needs = needsOf(v), dr = driveOf(v), bad = problem(v), ts = v.b.tasks
  if (!p && !needs.length) return []
  const landed = p && (p.state === 'done-on-dev' || p.state === 'released'), run = running(ts), top = run[0]
  const wide = w >= 100, tight = w < 50
  const dkey = dr ? S(dr.key, undefined, { k: 'drv', hk: '2', p: () => a.drive?.(dr.key) }) : undefined
  const bothCell: Seg[] = dr && needs.length ? [muted(tight ? '' : `${dr.kind === 'run' ? dr.mode : dr.text}${SEP}`), dkey!] : []
  // line 1
  let l1: Line = []
  if (p) {
    const head = `${p.id}${wide ? ` ${p.slug}` : ''}`, pr = prog(ts)
    const right: Line = bothCell.length ? [muted(wide ? `${head}${SEP}${pr}${SEP}` : ''), ...bothCell] : [muted(tight ? '' : wide ? `${head}${SEP}${pr}` : pr)]
    if (bad) l1 = lr(w, [g(v, 'fail'), S(' '), S(bad, color('danger'))], right.filter(s => s.t || s.hk))
    else if (landed) l1 = lr(w, [g(v, 'done'), S(` ${p.id} landed on dev`)], right.filter(s => s.t || s.hk))
    else if (top) {
      const more = run.length > 1 ? `${SEP}+${run.length - 1} running` : `${SEP}${stepName(top.step)}${SEP}${lapse(v, top)}`
      const left: Line = tight ? [g(v, 'run'), S(` ${top.id}${SEP}${prog(ts)}`)] : [g(v, 'run'), S(` ${top.id} `), S(top.title, undefined, { b: false }), muted(more)]
      l1 = lr(w, left, tight ? bothCell.filter(s => s.hk) : right.filter(s => s.t || s.hk))
    } else l1 = lr(w, [g(v, 'wait'), muted(` ${p.id} ${prog(ts)}`)], bothCell.filter(s => s.hk || s.t))
  }
  // line 2
  let l2: Line | undefined
  if (needs.length) {
    const n = needs[0], more = needs.length > 1 ? `${SEP}+${needs.length - 1} more` : '', title = clip(wide ? n.text : n.short, Math.max(8, w - 24))
    const key = S(n.d ? 'answer' : 'open', undefined, { k: 'att', hk: '1', p: () => (n.d ? a.answer(n.id!) : n.sel ? a.pick(n.sel) : a.go(n.tab)) })
    l2 = lr(w, tight ? [g(v, 'attn'), S(` ${title}${more}`)] : [g(v, 'attn'), S(' NEEDS YOU', color('attention'), { b: true }), S(`${SEP}${title}${more}`)], [key])
  } else if (dr && dkey) {
    const t = tight ? dr.text.replace(new RegExp(`${SEP}turn \\d+/\\d+`), '') : w < 100 ? dr.text.replace('turn ', '') : dr.text
    l2 = lr(w, dr.kind === 'run' ? [muted(t)] : [g(v, dr.kind === 'stopped' ? 'fail' : 'wait'), muted(` ${t}`)], [dkey])
  }
  return [...(l1.length ? [l1] : []), ...(l2 ? [l2] : [])]
}
