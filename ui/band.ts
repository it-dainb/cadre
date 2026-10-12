// Band above the prompt (UI-DESIGN 6.1): status line + mini-DAG strip, the `! NEEDS YOU` row (ui/needs), key `1` = answer in the dialog. Idle with no plan: nothing drawn (a pending init decision still draws).
import { type Acts, type Line, type TagK, type View, L, S, T, attention, col, cols, gl, kindOf, REDO, tg } from './model'
import { needLine } from './needs'

// one glyph (+ id) per task in depth order, `│` between depths; over-long strips fold the done end into `+n✓`
export function strip(v: View, ids: boolean, room: number): string {
  const ts = v.b.tasks, cs = cols(ts), done = cs.flat().filter(t => t.state === 'done').map(t => t.id)
  const mk = (k: number) => (k ? `+${k}${gl(v.c, 'ok')}${ids ? ' ' : ''}` : '') + cs.map(c => c.filter(t => !done.slice(0, k).includes(t.id)).map(t => gl(v.c, kindOf(t, ts)) + (ids ? t.id : '')).join(ids ? ' ' : '')).filter(Boolean).join(ids ? ' │ ' : '│')
  let k = 0
  while (mk(k).length > room && k < done.length) k++
  return T(v.c, mk(k))
}
const counts = (v: View) => {
  const ts = v.b.tasks, n = (k: TagK) => ts.filter(t => kindOf(t, ts) === k).length, c = v.c
  return { done: n('ok'), all: ts.length, run: `${gl(c, 'run')}${n('run')}`, wait: `${gl(c, 'wait')}${n('wait')}`, idle: `${gl(c, 'idle')}${n('idle')}` }
}
const tag = (k: TagK, rest: string, bold = false): Line => [{ t: tg(k), c: col(k), b: bold }, S(` ${rest}`)]

// L1: [TAG] cadre · plan · strictness · contained · drive · ctx · cache · sync (variants per wireframe: working, landed, attention-demoted, narrow)
function status(v: View, w: number, mode: 'full' | 'attn' = 'full'): Line {
  const b = v.b, p = b.plan!, c = v.c, k = counts(v), landed = p.state === 'done-on-dev' || p.state === 'released'
  const tk: TagK = landed ? 'ok' : !b.drive.paused && b.tasks.some(t => kindOf(t, b.tasks) === 'run') ? 'run' : 'wait'
  const ctx = v.ui.ctx !== undefined ? `ctx ${v.ui.ctx}%` : '', cache = b.cost.cachePct !== undefined ? `cache ${b.cost.cachePct}%` : ''
  const drive = landed ? '' : b.drive.paused ? `drive ${gl(c, 'wait')} ${b.drive.paused}` : b.drive.on ? `drive ${gl(c, 'run')} ${b.drive.turns}/${c.maxTurns}` : ''
  if (w < 100) return tag(tk, [p.id, `${strip(v, false, w)} ${k.done}/${k.all}`, mode === 'attn' ? `· drive ${gl(c, 'wait')}` : `${k.run} ${k.wait}`, ctx.replace(' ', '')].filter(Boolean).join(' ').replace(/ ·? ?$/, ''))
  const sync = b.sync.map(s => `${s.target} ${gl(c, s.state === 'ok' ? 'ok' : s.state === 'auth' ? 'crit' : 'warn')}`)
  const mid = landed ? [`${p.state} ${gl(c, 'ok')}`, `${strip(v, false, 40)} ${k.all} tasks`]
    : mode === 'attn' ? [] : [v.sx, b.containment.state === 'contained' ? `contained ${gl(c, 'ok')}` : b.containment.state === 'degraded' ? `degraded ${gl(c, 'warn')}` : '']
  const rel = landed && v.ui.rel ? [`${tg('warn')} release? ${v.ui.rel}`] : []
  return tag(tk, ['cadre', mode === 'attn' ? p.id : `${p.id} ${p.slug}`, ...mid, drive, ctx, cache, ...(mode === 'attn' || landed ? [] : sync), ...rel].filter(Boolean).join(' · '))
}
function row2(v: View, w: number): Line {
  const c = counts(v)
  return L(`  ${strip(v, true, w - 40)}   ${c.done}/${c.all} done · ${c.run} ${c.wait} ${c.idle}${v.b.resumesQueued ? `   ${REDO(v.c)}${v.b.resumesQueued}` : ''}`)
}

export function band(v: View, w: number, a: Acts): Line[] {
  const p = v.b.plan, items = p ? attention(v) : attention(v).filter(i => i.d?.kind === 'init')
  if (!p && !items.length) return []   // no plan: only a pending init decision draws (init runs before any plan), without the plan status rows
  const top = items[0], wide = w >= 100, res = v.ui.res as { w: string; n: string; at: number } | undefined
  if (!top && res && ((v.ui.ack as number | undefined) ?? 0) < res.at) return [tag('ok', wide ? res.w : res.n)]
  if (!top) return wide && p!.state !== 'done-on-dev' && p!.state !== 'released' ? [status(v, w), row2(v, w)] : [status(v, w)]
  const r1 = needLine(v, w, a, items)   // `1` opens the dialog (ADR 0012)
  if (w < 50) return r1
  return [...r1, ...(p ? [wide ? row2(v, w) : status(v, w)] : [])]
}
