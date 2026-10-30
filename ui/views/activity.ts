// UI v2 · 4 Activity (TUI-DESIGN 4.5): newest first, `<relative time:7> <glyph> <plain sentence>`, human-level events only (no heartbeat, no agent churn).
// The same rows sit under the timeline lanes, up to the cursor (activityRows).
import type { CadreEvent } from '../../types'
import { type Line, type View, S } from '../model'
import { clip, padL, plain, plural, relTime } from '../layout'
import { COL, type GlyphK, INDENT, SEP, color, glyph, glyphRole } from '../tokens'
import { type Renderer, muted, relax, ucfg } from './types'

type Say = { text: string; k?: GlyphK }
// event → one plain sentence (and the glyph that marks it); undefined = not shown
export function say(e: CadreEvent, v: View): Say | undefined {
  const d = e.data, id = e.taskId ?? String(d.taskId ?? ''), ts = v.b.tasks, t = ts.find(x => x.id === id), name = t ? `${id} ${t.title}` : id, to = String(d.to ?? d.state ?? '')
  switch (String(e.type)) {
    case 'task.transitioned':
      if (to === 'done') return { text: t?.kind === 'spike' ? `${name} reported` : `${name} passed review and merged`, k: 'done' }
      if (d.from === 'review' && to === 'active') return { text: `review asked for changes on ${id}` }
      return to === 'blocked' ? { text: `${id} is blocked and needs an answer`, k: 'attn' } : undefined
    case 'agent.bound': return { text: `${id} ${d.role} on ${d.ran ?? d.model}/${d.effort}${SEP}${d.forced ? 'forced by your environment' : d.setting ?? ''}${d.escalated ? ' after a failed round' : ''}` }   // the setting it came from (ADR 0019)
    case 'task.skipped': return { text: `${id} skipped`, k: 'skip' }
    case 'check.ran': if (d.ok) return undefined   // a passing check is not a human-level event
      return { text: `${id} ${d.phase ?? d.name} check ${d.ok ? 'passed' : 'did not pass'}`, ...(d.ok ? {} : { k: 'fail' as GlyphK }) }
    case 'flag.raised': return { text: `${id} needs a decision`, k: 'attn' }
    case 'flag.resolved': return { text: `${id} decision answered` }
    case 'approval.pending': return { text: `plan ${d.planId} is ready for approval`, k: 'attn' }
    case 'sync.state_changed': return to === 'ok' ? { text: `${d.target} is back online` } : { text: `${d.target} went offline`, k: 'fail' }
    case 'plan.approved': return { text: `roadmap ${d.planId} approved by you${SEP}${plural(Number(d.n), 'epic')}`, k: 'done' }
    case 'plan.landed': return { text: `${v.b.plan?.epics?.some(x => x.id === d.planId) ? 'epic' : v.b.plan?.lane === 'milestone' ? 'milestone' : 'plan'} ${d.planId} landed on ${d.on ?? 'dev'}`, k: 'done' }
    case 'plan.released': return { text: `released ${d.version}`, k: 'done' }
    case 'release.proposed': return { text: `release ${d.version} is ready`, k: 'attn' }
    case 'init.stage': return to === 'proposed' ? { text: 'init changes are ready to review', k: 'attn' } : undefined
    case 'drive.status': {
      const why = d.reason ? `: ${d.reason}` : ''
      return to === 'paused' ? { text: `drive paused${why}`, k: 'attn' } : to === 'stopped' ? { text: `drive stopped${why}`, k: 'fail' } : to === 'finished' ? { text: 'drive finished', k: 'done' }
        : to === 'armed' ? { text: 'drive on' } : to === 'resumed' ? { text: 'drive resumed' } : to === 'mode' ? { text: String(d.reason) } : undefined
    }
    case 'drive.decided': return { text: String(d.text) }
    default: return undefined
  }
}

// a milestone's roadmap approval has no event of its own: a row at approvedAt (the epics' automatic approvals are `drive.decided`)
export const ringOf = (v: View): CadreEvent[] => { const p = v.b.plan; return p?.lane === 'milestone' && p.approvedAt ? [...v.ring, { at: p.approvedAt, type: 'plan.approved', data: { planId: p.id, n: p.epics?.length ?? 0 } } as unknown as CadreEvent].sort((x, y) => x.at - y.at) : v.ring }
// newest first, up to `cursor` (default: now or the replay moment); relative to the cursor; `only` narrows the events (the Milestone tab's approvals)
export function activityRows(v: View, w: number, cursor = v.t ?? v.now, only: (e: CadreEvent) => boolean = () => true): Line[] {
  const c = ucfg(v)
  return ringOf(v).filter(e => e.at <= cursor && only(e)).flatMap(e => {
    const s = say(e, v); if (!s) return []
    const head = `${' '.repeat(INDENT)}${padL(relTime(cursor - e.at), COL.actTime)}  `, g = s.k ? glyph(s.k, c.ascii) : ' '
    return [[S(head, color('muted')), S(g, s.k ? color(glyphRole(s.k)) : undefined), S(clip(` ${plain(s.text)}`, Math.max(1, w - head.length - 1)))]]
  }).reverse()
}

export const activity: Renderer = (v, w, rows) => {
  const all = activityRows(v, w), c = ucfg(v), n = Math.max(1, rows - 1)
  if (!all.length) return { lines: [[muted('  nothing has happened yet')]], keys: [] }
  return { lines: [...relax(all.slice(0, all.length > rows ? n : rows), c.density).slice(0, all.length > rows ? n : rows), ...(all.length > rows ? [[muted(`  +${all.length - n} older`)]] : [])], keys: [] }
}
