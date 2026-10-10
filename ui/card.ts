// Decision card (ADR 0008): the pane's view while a human decision is pending. A framed box: what is asked, a short description, the buttons.
// A press runs the typed command bound to the code drawn with it (core re-checks it); the rest of the pane is drawn dim below (no overlay exists in the API).
import { type Acts, type Item, type Line, type View, L, S, T, attention, cols, cut, gl, padL, tg, col, B } from './model'
import { sheet, sheetOf, stats, wrap } from './sheet'

// a landed epic's release (the band keeps its status cell; the card opens on release.proposed)
export const decisions = (v: View): Item[] => [...attention(v).filter(i => i.btn), ...(v.ui.rel && v.b.plan?.state === 'done-on-dev' ? [{ key: `rel:${v.ui.rel}`, tag: 'attn' as const, text: `release ${v.ui.rel}?`, tab: 'epic', cmd: '/cadre release', btn: [B('r', 'Release', `release ${String(v.ui.rel).replace(/^v/, '')}`)] }] : [])]
const dim = (ls: Line[]): Line[] => ls.map(l => l.map(s => ({ t: s.t, c: s.c, d: true })))   // no keys: only the card's buttons answer
const WHY: Record<string, string> = {
  spec_change: 'the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.',
  git: 'a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move.',
}
function describe(v: View, d: Item): string[] {
  const [k, id] = d.key.split(':'), t = v.b.tasks.find(x => x.id === id)
  if (k === 'approve' && !d.sel) return [`${v.b.tasks.length} tasks${stats(v)}`, ...sheetOf(v).slice(0, 5).map(x => `  ${x.id} ${x.type} ${x.title} · ${x.scenarios.length} scenarios`), ...(sheetOf(v).length > 5 ? [`  +${sheetOf(v).length - 5} more (7: Plan)`] : [])]
  if (k === 'approve') return [t?.title ?? id, 'a human gate: the work after it waits for you']
  if (k === 'init' && id === '90') { const sp = v.ui['setup.plan'] as { acts?: string[][]; human?: string[] } | undefined; return [...(sp?.acts ?? []).map(([a], i) => `  ${i + 1}. ${a}`), ...(sp?.human?.length ? ['you run once:', ...sp.human.map(x => `  ${x}`)] : [])] }
  if (k === 'init') { const p = v.ui['init.pending'] as { name?: string; lines?: string[] } | undefined; return [`stage ${id}${p?.name ? ` ${p.name}` : ''}: proposed changes`, ...(p?.lines ?? []).map(x => `  ${x}`)] }
  if (k === 'flag') { const f = d.key.split(':').slice(2).join(':'); return [`${id} ${t?.title ?? ''}`, WHY[f.startsWith('git:') ? 'git' : f] ?? `flag ${f}: Keep accepts the state, Cancel task ends it`] }
  return ['dev merges into main with an annotated tag']
}
export const defaultTab = (v: View) => (decisions(v).length ? 'card' : 'epic')
export function card(v: View, w: number, a: Acts): Line[] {
  const [d, ...more] = decisions(v), c = v.c, n = Math.max(20, Math.min(w, 110) - 4), fr = (l: Line): Line => [S(T(c, '║ ')), ...padL(l, n), S(T(c, ' ║'))]
  const bar = (l: string, m: string, r: string) => L(T(c, `${l}${m.repeat(n + 2)}${r}`))
  const head = `${tg('attn')} ${gl(c, 'attn')} ${d.text}${more.length ? `  (+${more.length} more)` : ''}`
  const btns: Line = d.btn!.flatMap((b, i) => [...(i ? [S('   ')] : []), S(b.label, 'suggestion', { k: b.hk, hk: b.hk, p: () => (b.fill ? a.fill(b.fill) : a.press(b.cmd!)), b: true })])
  const body: Line[] = [[S(cut(head, n), col('attn'), { b: true })], L(''), ...describe(v, d).flatMap(x => wrap(x, n, '  ').map(y => L(y))), L(''), btns]
  const under = d.tab === 'plan' ? sheet(v, w, a) : [...cols(v.b.tasks).flat().map(t => L(`${t.id} ${t.title}`))]
  return [bar('╔', '═', '╗'), ...body.map(fr), bar('╚', '═', '╝'), ...dim(under)]
}
