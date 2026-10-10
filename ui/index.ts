// UI entry points wired by hooks/register.ts (UI-DESIGN 5, 7): render hooks (band, pane, result card), press handlers, prefill (5.2), openPane, resume banner, cursor tick.
// The UI reads the human view, the ring and the secret only; render is pure; writes happen in handlers (and a press's own work runs in after(1), UI-14).
import type { Host } from '../types'
import { band as bandOf } from './band'
import { pane, sel } from './pane'
import { sheet, sheetOf, sheetSig } from './sheet'
import { card } from './card'
import { blit, cells, timeline } from './timeline'
import { ack, levelOf, onEvent as notifyEvent } from './notify'
import { decisions, defaultTab } from './card'
export { defaultTab }
import { strictOf } from '../config/index'
import { type Acts, S, at, cols, draw, gl, kindOf, read, t0, tg, txt, col, REDO } from './model'

export { ack, syncStatus } from './notify'
let lastW = 0   // width of the last pane draw: a cache for cursor-only blits (a resize is a redraw), not state
const later = (h: Host, fn: () => Promise<unknown>) => h.ops?.after(1, () => fn().catch(e => h.toast(`cadre: ${e}`)))

// 5.2: a button only loads the command into an EMPTY composer; the human presses Enter (composer origin).
export async function prefill(h: Host, cmd: string): Promise<void> {
  const o = h.ops!
  if ((await o.peek()).trim()) return o.toast('cadre: composer not empty: clear it, then press again')
  if (!(await o.fill(cmd)).isFilled) o.toast(`cadre: type ${cmd}`)
}

// Open the pane on a tab (called by /cadre open|approve and by presses). Where nothing draws, the content goes to $.ui.log instead (C3).
const OPEN = { id: 'cadre', title: 'cadre', columns: 120 }
// The open call is the first thing a command or press does: only there does the engine count it as asked (any width); inside after() it is "unasked" (>= 144 columns, live capture ADR 0008)
export async function openPane(h: Host, tab: string, o: { focus?: boolean; quiet?: boolean; pre?: ReturnType<NonNullable<Host['ops']>['open']> } = {}): Promise<void> {
  const opened = o.pre ?? h.ops!.open({ ...OPEN, ...(o.focus === false ? {} : { focus: true as const }) })   // `focus: false` is refused by the engine: leave it out
  const v = await read(h)
  await h.ui.update(u => ({ ...u, tab, ...(tab === 'plan' || tab === 'card' ? { seen: { code: v.sec.approval?.code8 ?? '', sig: sheetSig(v) } } : {}) }))
  const r = await opened
  if (!r.isPlaced && !o.quiet) {
    h.toast(`cadre: pane not shown${r.reason ? ` · ${r.reason.slice(0, 30)}` : ''} · /cadre status`)
    if (tab === 'plan') h.log(txt(sheet(v, 100, NOOP)).join('\n'))
    if (tab === 'card' && decisions(v)[0]) h.log(`${decisions(v)[0].text} · type ${decisions(v)[0].cmd ?? '/cadre status'}`)
  }
  if (!o.quiet) await ack(h)
}
const NOOP: Acts = { go() {}, pick() {}, fill() {}, press() {}, step() {} }
// a decision appears: show its card, focused only while the composer is empty (the engine also refuses focus over a dialog, and an unasked open needs the columns, UI-02). Once per decision.
export async function onEvent(h: Host, e: Parameters<typeof notifyEvent>[1]): Promise<void> {
  await notifyEvent(h, e)
  if (!h.ops || levelOf(e) < 2 && e.type !== 'release.proposed') return
  const d = decisions(await read(h))[0], ui = await h.ui.read()
  if (!d || ui.ck === d.key) return
  await h.ui.update(u => ({ ...u, ck: d.key }))
  await openPane(h, 'card', { quiet: true, focus: !(await h.ops.peek()).trim() })
}

export function acts(h: Host): Acts {
  return {
    go: tab => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, () => openPane(h, tab, { pre })) },
    pick: id => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, async () => { await h.ui.update(u => ({ ...u, sel: id, go: false })); await openPane(h, 'epic', { pre }) }) },
    fill: cmd => later(h, async () => { await prefill(h, cmd); await ack(h) }),
    // a press: the typed command as the human's origin (ADR 0008). A refusal means the card went stale (code burned, drawn anew): say so and redraw it.
    press: cmd => later(h, async () => {
      const r = await h.press!(cmd); await ack(h)
      const bad = /^(refused|cadre:)|burned|changed since|nothing pending|wrong code/.test(r.text)
      h.toast(bad ? `cadre: it changed or was refused; review again · ${r.text.split('\n')[0].slice(0, 60)}` : `cadre: ${r.text.split('\n')[0].slice(0, 80)}`); h.ops?.invalidate()
    }),
    step: (what, d) => later(h, async () => {
      const v = await read(h), ids = cols(at(v).tasks).flat().map(t => t.id), cur = v.t ?? v.now
      const unit = 60000 * timeline(v, lastW || 116).mpc, evs = v.ring.filter(e => levelOf(e) >= 2).map(e => e.at)
      const go = (t: number | null) => ({ t: t === null || t > v.now - unit / 2 ? null : Math.max(t0(v), t) })
      const p: Record<string, unknown> = what === 'sheet' ? { si: Math.max(0, Math.min(sheetOf(v).length - 1, Number(v.ui.si ?? 0) + d)) }
        : what === 'node' ? { sel: ids[(ids.indexOf(sel(v)) + d + ids.length) % ids.length] }
        : what === 'time' ? go(cur + d * unit) : what === 'attn' ? go(d > 0 ? evs.find(x => x > cur) ?? null : [...evs].reverse().find(x => x < cur) ?? null)
        : what === 'go' ? { go: !v.ui.go } : what === 'live' ? { t: null, sel: undefined } : { tl: v.ui.tl === false }
      await h.ui.update(u => ({ ...u, ...p })); await ack(h)
    }),
  }
}

export async function renderBand(h: Host, e: any, next: (e: any) => any) {
  if (e.props.hasSurvey || e.props.view?.agentId) return next(e)   // never another task's content in an agent view
  const lines = bandOf(await read(h), e.props.bodyColumns, acts(h))
  if (!lines.length) return next(e)
  const E = h.ops!.els(e)
  return E.Box({ flexDirection: 'column', children: [draw(E, lines), await next(e)] })
}
export async function renderPane(h: Host, e: any) {
  const v = await read(h), w = e.props.bodyColumns, E = h.ops!.els(e)
  lastW = w
  const p = pane(v, w, e.props.scroll.bodyRows, acts(h), e.surface === 'terminal')
  return E.Box({ flexDirection: 'column', children: [draw(E, p.before), ...(p.tl ? [E.Raster({ key: 'tl', columns: p.tl.cols, rows: p.tl.rows.length, cells: cells(p.tl, v.c) })] : []), ...(p.after.length ? [draw(E, p.after)] : [])] })
}
// result-card row: core records tool_use_id -> task (mapCard); the task's `card` text is drawn (line 1 = summary, line 2 = next). While running or unmapped: the engine's row.
export const mapCard = (h: Host, toolUseId: string, taskId: string) => h.ui.update(u => ({ ...u, cards: { ...(u.cards as object | undefined), [toolUseId]: taskId } }))
export async function renderCard(h: Host, e: any, next: (e: any) => any) {
  const v = await read(h), id = (v.ui.cards as Record<string, string> | undefined)?.[e.props.tool_use_id], t = id ? v.b.tasks.find(x => x.id === id) : undefined
  if (e.props.isRunning || !t?.card) return next(e)
  const [row, nx] = t.card.split('\n'), k = /✗|refus|fail/i.test(row) ? 'crit' : 'ok'
  return draw(h.ops!.els(e), [[S(v.c.glyphs === 'ascii' ? '* ' : '⏺ '), S(tg(k), col(k)), S(` ${row}`)], ...(nx ? [[S(`  ${nx}`)]] : [])])
}
// transcript log line + band cell after /clear rehydrate (6.7); the band cell clears on the first ack
export async function resumeBanner(h: Host, o: { decisions?: number; next?: string; stale?: number } = {}): Promise<void> {
  const v = await read(h), ts = v.b.tasks, c = v.c, n = ts.filter(t => kindOf(t, ts) === 'run').length, q = v.b.resumesQueued
  h.log(`${c.glyphs === 'ascii' ? '*' : '●'} cadre: ${tg('ok')} resumed · mission "${v.b.mission}" · epic ${v.b.plan?.id} · ${n} running (re-adopted)${o.stale ? ` · ${tg('idle')} ${o.stale} stale → rebind` : ''}${q ? ` · ${REDO(c)} ${q}` : ''}`)
  const on = v.b.drive.on, dw = on ? `${tg('run')} drive ${gl(c, 'run')} continuing` : `${tg('wait')} drive off`   // the rehydrated board's drive (it survives /clear, DESIGN 9)
  const w = `↺ cadre resumed from beads · ${o.decisions ?? 0} decisions${o.next ? ` · next: ${o.next}` : ''} · ${dw}${on ? '' : ' until /cadre drive on'}`
  await h.ui.update(u => ({ ...u, res: { w, n: `↺ resumed ${v.b.plan?.id} · ${gl(c, 'run')}${n} · ${dw}`, at: v.now } }))
}
// the render hook cannot read env/config, so the tick keeps the resolved strictness (M10) in the ui atom for it
export async function tickUi(h: Host): Promise<void> {
  const sx = await strictOf(h).catch(() => undefined); if (sx) await h.ui.update(u => (u.sx === sx ? u : { ...u, sx }))
  if (lastW) await blit(h, await read(h), lastW).catch(() => {})   // live cursor advance (30 s clock)
}
