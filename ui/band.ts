// Band above the prompt (UI-DESIGN 6.1): status line + mini-DAG strip, the ⚑ NEEDS YOU row, keys `1` and `d`. Idle with no plan: nothing drawn.
import { type Acts, type Line, type TagK, type View, L, S, T, attention, col, cols, gl, kindOf, padL, REDO, tg } from './model'
import { stats } from './sheet'

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
  const p = v.b.plan, items = attention(v)
  if (!p) return []
  const top = items[0], wide = w >= 100, res = v.ui.res as { w: string; n: string; at: number } | undefined
  if (!top && res && ((v.ui.ack as number | undefined) ?? 0) < res.at) return [tag('ok', wide ? res.w : res.n)]
  if (!top) return wide && p.state !== 'done-on-dev' && p.state !== 'released' ? [status(v, w), row2(v, w)] : [status(v, w)]
  const c = v.c, open = top.tab === 'plan' ? '1: open sheet' : '1: open'
  const body = (top.tag === 'attn' ? '' : `${tg(top.tag)} ${gl(c, top.tag)} `) + (wide ? top.text + (top.tab === 'plan' ? stats(v) : '') : top.short ?? top.text)
  const head = `${tg('attn')} ${gl(c, 'attn')} ${wide ? 'NEEDS YOU · ' : ''}${body}`
  const r1: Line = [{ t: tg('attn'), c: col('attn'), b: true }, S(head.slice(tg('attn').length)), S(' '.repeat(Math.max(1, w - head.length - open.length))), S(open, undefined, { k: 'att', hk: '1', p: () => (top.sel ? a.pick(top.sel) : a.go(top.tab)) })]
  if (w < 50) return [r1]
  const cmd = top.cmd ? (wide ? `  type  ${top.cmd}   (or press 1, then a)` : `  ${top.cmd}`) : ''
  const r2: Line | null = cmd ? padL(L(cmd), w - 12).concat(wide ? [S('d: Epic view', undefined, { k: 'dag', hk: 'd', p: () => a.go('epic') })] : []) : null
  return [r1, ...(r2 ? [r2, status(v, w, 'attn')] : [wide ? row2(v, w) : status(v, w)])]
}
