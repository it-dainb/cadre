// Pane shell (UI-DESIGN 5.5, 6.2): tabs (Epic, Plan), wide/stacked switch, collapse rules, replay header, footer keys. Returns lines around the timeline Raster.
import { type Acts, type Line, type View, L, S, T, ago, at, attention, col, gl, tg, kindOf, padL, t0 } from './model'
import { detail, dag, list, log, railLine } from './epic'
import { sheet } from './sheet'
import { card } from './card'
import { type Tl, timeline } from './timeline'

export type P = { before: Line[]; tl?: Tl; after: Line[] }
const KEYS: Record<string, [string, number]> = { n: ['node', 1], p: ['node', -1], h: ['time', -1], l: ['time', 1], b: ['attn', -1], f: ['attn', 1], e: ['live', 0], t: ['tl', 0], g: ['go', 0] }
// the engine draws `key: label` for a plain Button (UI-14): wide / narrow labels
const FOOT: [string, string, string][] = [['n', 'next', 'node'], ['p', 'prev', 'prev'], ['h', 'back', 'back'], ['l', 'fwd', 'fwd'], ['b', 'prev !', '!<'], ['f', 'next !', '!>'], ['e', 'live', 'live'], ['t', 'timeline', 'hide'], ['g', 'go to id', 'id']]
const footer = (wide: boolean, a: Acts): Line => FOOT.flatMap(([k, long, short], i) => [...(i ? [S(wide ? '  ' : ' ')] : []), S(wide ? long : short, undefined, { k, hk: k, p: () => a.step(KEYS[k][0], KEYS[k][1]) })])

export function sel(v: View): string {
  const ts = at(v).tasks
  return (v.ui.sel as string | undefined) ?? [...ts].filter(t => t.state === 'active' || t.state === 'review').sort((a, b) => b.phaseSince - a.phaseSince)[0]?.id ?? ts[0]?.id ?? ''
}
export function pane(v: View, w: number, rows: number, a: Acts, canRaster = true): P {
  const b = at(v), items = attention(v), tab = v.ui.tab === 'card' && v.t === null && items.some(i => i.d) ? 'card' : v.ui.tab === 'card' ? 'epic' : (v.ui.tab as string) ?? 'epic', c = v.c, p = b.plan, ts = b.tasks, wide = w >= 116
  const n = (k: ReturnType<typeof kindOf>) => ts.filter(t => kindOf(t, ts) === k).length
  const mode: Line = v.t === null ? [S(`[LIVE] ${ago(v.now - t0(v))}`, 'suggestion')] : [S(`[REPLAY t-${ago(v.now - v.t).slice(0, -1)}m]`, 'warning', { b: true, i: true }), S(wide ? '' : ` at ${ago(v.t - t0(v))} · e: live`)]
  const tabs: Line = [S(`Epic${items.some(i => i.tab === 'epic') ? gl(c, 'attn') : ''}`, undefined, { k: 'tab1', hk: '1', p: () => a.go('epic') }), S('  '), S(`Plan${items.some(i => i.tab === 'plan') ? gl(c, 'attn') : ''}`, undefined, { k: 'tab7', hk: '7', p: () => a.go('plan') }), S('  '), S('Doctor', undefined, { k: 'tab8', hk: '8', p: () => a.go('doctor') })]
  const sum = `${p ? `${p.id} · ` : ''}${wide && p ? `${p.epicBranch} · ` : ''}${ts.filter(t => t.state === 'done').length}/${ts.length} done · ${gl(c, 'run')}${n('run')} ${gl(c, 'wait')}${n('wait')} ${gl(c, 'idle')}${n('idle')}`
  const head: Line[] = wide ? [[...tabs, S(`  ·  ${sum} · `), ...mode]] : [[...tabs, S('    '), ...mode], L(`${sum}${v.t === null ? '' : '  (actions off)'}`)]
  const rule = L(T(c, '─'.repeat(w)))
  if (tab === 'doctor') {
    const sp = v.ui['setup.plan'] as { acts?: string[][]; done?: string[][]; human?: string[]; out?: string[] } | undefined, mark: Record<string, string> = { run: '… ', ok: '✓ ', fail: '✗ ' }
    const plan: Line[] = !sp ? [] : [rule, L('Setup plan'), ...[...(sp.done ?? []), ...(sp.acts ?? [])].map(([t, st], i) => L(`  ${i + 1}. ${mark[st] ?? ''}${t}`)), ...(sp.out ?? []).map(x => L(`      ${x}`)), ...(sp.human?.length ? [L('you run once:'), ...sp.human.map(x => L(`  ${x}`))] : [])]
    return { before: [...head.slice(0, 1), rule, ...((v.ui['doctor.rows'] as [string, string, string?][] | undefined) ?? [['', 'no report yet · run /cadre doctor']]).flatMap(([k, t, f]) => [k ? [S(tg(k as any), col(k as any), { b: k === 'crit' }), S(` ${t}`)] : L(t), ...(f ? [L(`      fix: ${f}`)] : [])]), ...plan], after: [] }
  }
  if (tab === 'card') return { before: [...head.slice(0, 1), rule, ...card(v, w, a)], after: [] }
  if (tab === 'plan') return { before: [...head.slice(0, 1), rule, ...sheet(v, w, a)], after: [] }
  const s = sel(v), fl = c.flash && v.t === null ? ts.filter(t => t.phaseSince > 0 && v.now - t.phaseSince < 1500).map(t => t.id) : [], flash = fl.length > 3 ? [] : fl
  const nLog = rows < 22 ? 2 : 6, showTl = canRaster && v.ui.tl !== false && rows >= 34
  const tl = timeline(v, w)
  const tlHead = L(canRaster ? tl.head : 'timeline: terminal only (Svg later)')
  const gid = v.ui.go ? [[S('go to id: '), S('', undefined, { k: 'g', inp: (x: string) => { const id = x.trim(); if (ts.some(t => t.id === id)) a.pick(id); else a.step('go', 0) } })]] : []
  const foot = [rule, ...gid, footer(wide, a)]
  const tail = canRaster ? [showTl ? tlHead : [...tlHead, S(' ')]] : [tlHead]
  if (wide) {
    const left = dag(v, s, flash, a), rw = w - 85, right = [...detail(v, s, rw, false), L(T(c, '─'.repeat(rw))), L('LOG  latest first'), ...log(v, nLog, rw)]
    const body = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [S(' '), ...padL(left[i] ?? [], 80), S(T(c, ' │ ')), ...(right[i] ?? [])])
    return { before: [...head, rule, ...body, rule, ...tail], tl: showTl ? tl : undefined, after: foot }
  }
  const out = [...head, rule, ...list(v, w, a), railLine(v), rule, ...detail(v, s, w, true), rule, L('LOG'), ...log(v, nLog, w), rule, ...tail]
  return { before: out, tl: showTl ? tl : undefined, after: foot }
}
