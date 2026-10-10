// Plan tab = approval sheet (UI-DESIGN 5.3, 6.6). Reads `sheet` from the human view, code8 from cadre.secret (its footer only), pages one task at a time.
import { canon, fnv1a64 } from '../core/board'
import { type Acts, type Line, type View, L, S, T, cut, tg, col, gl, padL } from './model'

export type Sym = { sig: string; status: 'new' | 'changed' | 'unchanged'; before?: string }
export type SheetTask = { id: string; title: string; type: string; scope?: string; package?: string; tdd: string; changelog?: string; breaking?: boolean; scenarios: string[]; contract: Sym[] }
export const sheetOf = (v: View): SheetTask[] => ((v.b as { sheet?: SheetTask[] }).sheet ?? [])
const syms = (v: View, s: Sym['status']) => sheetOf(v).reduce((n, t) => n + t.contract.filter(x => x.status === s).length, 0)
export const stats = (v: View) => { const n = sheetOf(v).reduce((a, t) => a + t.scenarios.length, 0); return n ? ` · ${n} scenarios · ${syms(v, 'new')} new / ${syms(v, 'changed')} changed symbols` : '' }
export const sheetSig = (v: View) => Object.fromEntries(sheetOf(v).map(t => [t.id, fnv1a64(canon(t))]))   // what "amended while open" compares against
const wrap = (s: string, n: number, ind = '   '): string[] => {
  const out: string[] = []; let cur = ''
  for (const w of s.split(' ')) { if (cur && cur.length + 1 + w.length > n) { out.push(cur); cur = ind + w } else cur = cur ? `${cur} ${w}` : w }
  return [...out, cur]
}
const hdr = (t: SheetTask, i: number, n: number) => `${t.id} · ${t.type}${t.scope ? `(${t.scope})` : ''} ${t.title}${t.package ? ` · ${t.package}` : ''} · tdd ${t.tdd}`
const symLines = (x: Sym, n: number, wide: boolean): Line[] => {
  const [head, ret] = x.sig.split(' -> '), mark = wide ? { new: 'NEW', changed: 'CHANGED', unchanged: 'same' }[x.status] : { new: 'NEW', changed: 'CHG', unchanged: 'same' }[x.status]
  const diff = x.status === 'changed' && x.before ? [L(`- ${x.before}`, 'error'), L(`+ ${x.sig}`, 'success')] : []
  return wide ? [L(cut(x.sig, n - 9).padEnd(n - 8) + mark), ...diff] : [L(`${mark} ${x.status === 'changed' ? head.split('(')[0] : head}`), ...(ret && x.status !== 'changed' ? [L(`${' '.repeat(mark.length + 1)}-> ${ret}`)] : []), ...diff]
}

export function sheet(v: View, w: number, a: Acts): Line[] {
  const p = v.b.plan, ts = sheetOf(v), c = v.c, ap = v.sec.approval, wide = w >= 100
  if (!p) return [L('no plan yet: nothing to approve', 'inactive')]
  const i = Math.min(Math.max(0, Number(v.ui.si ?? 0)), Math.max(0, ts.length - 1)), t = ts[i]
  const seen = v.ui.seen as { code: string; sig: Record<string, string> } | undefined, sig = sheetSig(v)
  const changed = ap && seen && seen.code !== ap.code8 ? Object.keys(sig).filter(k => sig[k] !== seen.sig[k]) : []
  const cmd = ap && ap.planId === p.id ? `${p.id}@${ap.code8}` : ''
  const fillBtn = (k: string, label: string, cmdText: string): Line[number] => ({ t: label, k, hk: k, p: () => a.fill(cmdText) })
  const sc = ts.reduce((n, x) => n + x.scenarios.length, 0)
  const out: Line[] = []
  if (changed.length) out.push([{ t: `${tg('warn')} ${gl(c, 'warn')} plan changed since you opened it`, c: col('warn') }], L(`${' '.repeat(7)}(${changed.map(k => `${k} scenarios`).join(', ')}) · re-read · code changed`))
  if (wide) {
    const types = [...new Set(ts.map(x => x.type))].map(y => `${y}×${ts.filter(x => x.type === y).length}`).join(' ')
    const pk = [...new Set(ts.map(x => x.package).filter(Boolean))].join(', ')
    out.push(L(`PLAN ${p.id} ${p.slug} · ${v.b.tasks.length} tasks · ${sc} scenarios${pk ? ` · packages ${pk}` : ''} · commit types ${types}`),
      L(`contract: ${syms(v, 'new')} NEW · ${syms(v, 'changed')} CHANGED · ${syms(v, 'unchanged')} same · breaking: ${ts.some(x => x.breaking) ? 'yes' : 'none'}`), L(T(c, '─'.repeat(w))))
    if (t) {
      const half = Math.floor(w / 2), left: Line[] = [L('SCENARIOS'), ...t.scenarios.flatMap(s => wrap(s, half - 4).map(x => L(x)))], right: Line[] = [L('CONTRACT'), ...t.contract.flatMap(x => symLines(x, w - half - 3, true))]
      out.push(L(`${hdr(t, i, ts.length)}${t.changelog ? ` · changelog ${t.changelog}` : ''}  task ${i + 1}/${ts.length}`))
      for (let r = 0; r < Math.max(left.length, right.length); r++) out.push([...padL(left[r] ?? [], half - 2), S(T(c, '│ ')), ...(right[r] ?? [])])
    }
  } else {
    out.push(L(`${p.id} · ${v.b.tasks.length} tasks · NEW ${syms(v, 'new')} · CHANGED ${syms(v, 'changed')} · task ${i + 1}/${ts.length}`))
    if (t) out.push(L(cut(hdr(t, i, ts.length).replace('tdd required', 'tdd req'), w)), ...(t.changelog ? [L(`changelog: ${t.changelog}`)] : []), ...t.scenarios.flatMap(s => wrap(s, w - 2).map(x => L(x))), ...t.contract.flatMap(x => symLines(x, w, false)))
  }
  out.push(L(T(c, '─'.repeat(w))))
  const dis = v.t !== null || !cmd
  out.push([{ t: `${tg('attn')} `, c: col('attn'), b: true }, ...(dis ? [S('(read-only)')] : [fillBtn('a', wide ? `a: load approve command (${cmd})` : 'a: approve cmd', `/cadre approve ${cmd}`), S(' · '), fillBtn('x', wide ? 'x: load reject command' : 'x: reject', `/cadre reject ${p.id} `)]),
    S(' · '), S('n/p: task', undefined, { k: 'n', hk: 'n', p: () => a.step('sheet', 1) }), S(' ', undefined, { k: 'p', hk: 'p', p: () => a.step('sheet', -1) })])
  return out
}
