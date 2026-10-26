// UI v2 · 5 Milestone (TUI-DESIGN 4.7): the roadmap of epics with the Graph tab's DAG (the core epic at the root, `─→` to the epics it unblocks), each epic's glyph +
// one fact (tasks done/total while it runs, else its state or why it waits), the milestone branch at >= 100, then the plan approvals: the roadmap's (you) and each epic's (automatic).
import type { MEpic, SnapTask } from '../../types'
import { at } from '../model'
import { clip } from '../layout'
import { type GlyphK, SEP } from '../tokens'
import { dag } from './graph'
import { activityRows } from './activity'
import { type Renderer, joinSections, muted, title, ucfg, win } from './types'

const K: Record<MEpic['state'], GlyphK> = { draft: 'wait', waiting: 'wait', ready: 'ready', planning: 'run', running: 'run', landed: 'done', stopped: 'fail' }
export const milestone: Renderer = (v, w, rows, a) => {
  const p = v.b.plan, es = p?.epics ?? [], ts = at(v).tasks, c = ucfg(v)
  if (!es.length) return { lines: [[muted(`  no epics yet${SEP}Claude drafts the roadmap`)]], keys: [] }
  const of = (t: SnapTask) => es.find(e => e.id === t.id)!
  const fact = (t: SnapTask): string[] => {
    const e = of(t), mine = ts.filter(x => x.epic === e.id), open = e.deps.filter(d => es.find(x => x.id === d)?.state !== 'landed')
    const f = e.state === 'running' ? `${mine.filter(x => x.state === 'done').length}/${mine.length}` : e.state === 'stopped' ? `stopped: ${clip(e.why ?? '', 32)}`
      : e.state === 'waiting' ? (open.length ? `after ${open.join(' ')}` : 'waits for a free slot') : e.state === 'draft' && e.size ? `about ${e.size} tasks` : e.state
    return [f, ...(e.core ? ['core'] : [])]
  }
  const nodes = es.map(e => ({ id: e.id, title: e.title, deps: e.deps.map(id => ({ id, type: 'blocks' })) }) as unknown as SnapTask)
  const road = dag(v, nodes, w, '', t => K[of(t).state], fact, t => (of(t).state === 'landed' && a.revert ? { k: `rv:${t.id}`, p: () => a.revert!(t.id) } : {}))   // a landed epic's row opens its revert card
  const ok = activityRows(v, w, undefined, e => String(e.type) === 'plan.approved' || (e.type === 'drive.decided' && e.data.kind === 'plan'))
  const head = w >= 100 && p?.epicBranch ? [[muted(`  ${p.epicBranch}`)]] : []
  const all = joinSections([[...head, ...road], ok.length ? [title('Plan approvals'), ...ok] : []], c.density)
  return { lines: win(all, 0, rows), keys: [] }
}
