// UI entry points wired by hooks/register.ts (UI-DESIGN 5, 7): render hooks (band, pane, result card), press handlers, the decision dialog (ADR 0012), openPane, resume banner, cursor tick.
// The UI reads the human view, the ring and the secret only; render is pure; writes happen in handlers (and a press's own work runs in after(1), UI-14).
import type { Decision, Host } from '../types'
import { band as bandOf } from './band'
import { pane, sel } from './pane'
import { sheet, sheetOf, sheetSig } from './sheet'
import { blit, cells, timeline } from './timeline'
import { ack, levelOf, onEvent as notifyEvent } from './notify'
import { decisions } from './needs'
import { queueBrief } from '../core/lanes'
import { strictOf } from '../config/index'
import { configPress, refreshSettings } from '../config/route'
import { type Acts, S, at, cols, cut, draw, gl, kindOf, read, t0, tg, txt, col, REDO } from './model'

export { ack, syncStatus } from './notify'
let lastW = 0   // width of the last pane draw: a cache for cursor-only blits (a resize is a redraw), not state
const later = (h: Host, fn: () => Promise<unknown>) => h.ops?.after(1, () => fn().catch(e => h.toast(`cadre: ${e}`)))

// Open the pane on a tab (called by /cadre open|approve and by presses). Where nothing draws, the content goes to $.ui.log instead (C3).
const OPEN = { id: 'cadre', title: 'cadre', columns: 120 }
// The open call is the first thing a command or press does: only there does the engine count it as asked (any width); inside after() it is "unasked" (>= 144 columns, live capture ADR 0008)
export async function openPane(h: Host, tab: string, o: { focus?: boolean; quiet?: boolean; pre?: ReturnType<NonNullable<Host['ops']>['open']> } = {}): Promise<void> {
  if (tab === 'settings') await refreshSettings(h)
  const opened = o.pre ?? h.ops!.open({ ...OPEN, ...(o.focus === false ? {} : { focus: true as const }) })   // `focus: false` is refused by the engine: leave it out
  const v = await read(h)
  await h.ui.update(u => ({ ...u, tab, ...(tab === 'plan' ? { seen: { hash: (v.b.decisions ?? []).find(d => d.id === `plan:${v.b.plan?.id}`)?.hash ?? '', sig: sheetSig(v) } } : {}) }))
  const r = await opened
  if (!r.isPlaced) {
    if (!o.quiet) { h.toast(`cadre: pane not shown${r.reason ? ` · ${r.reason.slice(0, 30)}` : ''}`); if (tab === 'plan') h.log(txt(sheet(v, 100, NOOP)).join('\n')) }
    if (decisions(v).length) later(h, () => answerDialog(h))   // no pane (VS Code panel, Remote Control) and no band key: the dialog of the oldest decision
  }
  if (!o.quiet) await ack(h)
}
const NOOP: Acts = { go() {}, pick() {}, answer() {}, step() {} }
export async function onEvent(h: Host, e: Parameters<typeof notifyEvent>[1]): Promise<void> { await notifyEvent(h, e); await autoAsk(h) }

// A decision pops its dialog by itself at most ONCE, when it first appears, and only over an empty composer with no dialog of ours up (a `quiet` one never does).
// After that only `1` (band or pane) opens it: a dismissal (Esc) never comes back on its own.
export async function autoAsk(h: Host): Promise<void> {
  if (!h.ask || !h.ops) return
  const shown = ((await h.ui.read()).shown as string[] | undefined) ?? [], fresh = decisions(await read(h)).filter(d => !d.quiet && !shown.includes(d.id))
  if (!fresh.length) return
  await h.ui.update(u => ({ ...u, shown: [...shown, ...fresh.map(d => d.id)].slice(-100) }))
  if (!asking && !(await h.ops.peek()).trim()) later(h, () => answerDialog(h, fresh[0].id))
}

// The ONE way a decision is answered (ADR 0012): the native AskUserQuestion dialog. Fields first, one ask each (keep the value or type a new one); then the
// decision's runnable options (at most 4; "Not now" added when fewer than 2; the engine adds "Type something"). Typed text there is a change request to main
// (Decision.change). The answer goes to core/dispatch.answer, which re-checks the hash; a refusal that moved the decision (stale, an invalid value) re-asks it.
// Dismissed or -p ($.ui.ask rejects): nothing is decided. Auto-answers by other mods are an accepted risk (ADR 0012).
export const NOT_NOW = 'Not now'
const body = (d: Decision) => [d.title, ...(d.error ? [`! ${d.error}`] : []), ...d.lines].slice(0, 7).join('\n')   // the title + at most 6 lines
let asking = false
export async function answerDialog(h: Host, id?: string): Promise<void> {
  if (!h.ask || !h.answer || asking) return
  asking = true
  try {
    for (let n = 0, last = ''; n < 3; n++) {
      const ds = decisions(await read(h)), d = id ? ds.find(x => x.id === id) : ds[0]
      if (!d || d.hash === last) return
      const vals: Record<string, string> = {}
      for (const f of d.fields ?? []) {
        const keep = f.value ? `Keep ${f.value}` : 'Leave it empty', x = (await h.ask(`${f.label}?`, [keep, 'Cancel'])).trim()
        if (x === 'Cancel') return
        vals[f.key] = x === keep ? f.value ?? '' : x
      }
      const os = d.options.filter(o => o.run).slice(0, 4), x = (await h.ask(body(d), [...os.map(o => o.label), ...(os.length < 2 ? [NOT_NOW] : [])])).trim(), o = os.find(y => y.label === x)
      if (!o) {
        if (x && x !== NOT_NOW && !d.fields?.length) { await queueBrief(h, `${d.change ?? `About "${d.title}": `}${x}`); h.log(`sent to Claude · ${cut(x, 60)}`) }
        return
      }
      const r = await h.answer(d.id, o.key, d.hash, vals); h.log(r.text)   // the engine prefixes the plugin name
      if (!r.text.startsWith('refused')) return
      id = d.id; last = d.hash
    }
  } catch { /* dismissed, or -p: nothing is decided */ } finally { asking = false }
}

export function acts(h: Host): Acts {
  return {
    go: tab => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, () => openPane(h, tab, { pre })) },
    pick: id => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, async () => { await h.ui.update(u => ({ ...u, sel: id, go: false })); await openPane(h, 'epic', { pre }) }) },
    run: cmd => later(h, async () => { const r = await configPress(h, cmd); h.toast(`cadre: ${r.text.split('\n')[0].slice(0, 53)}`); h.ops?.invalidate(); await autoAsk(h) }),   // a Settings toggle (a press, not a decision); edit asks its decision
    answer: id => later(h, async () => { await ack(h); await answerDialog(h, id) }),   // `1`: the decision's dialog, again
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
