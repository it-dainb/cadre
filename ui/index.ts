// UI entry points wired by hooks/register.ts (UI-DESIGN 5, 7): render hooks (band, pane, result card), press handlers, the decision dialog (ADR 0012), openPane, resume banner, cursor tick.
// The UI reads the human view, the ring and the secret only; render is pure; writes happen in handlers (and a press's own work runs in after(1), UI-14).
import type { Decision, Host } from '../types'
import { band as bandOf } from './band'
import { pane } from './pane'
import { prog, selId } from './v2/facts'
import { ack, onEvent as notifyEvent, syncStatus } from './notify'
import { queueBrief } from '../core/lanes'
import { ROUTES, dispatch } from '../core/dispatch'
import { color, glyph, glyphRole, readCfg } from './tokens'
import { strictOf } from '../config/index'
import { configPress, refreshLessons, refreshSettings } from '../config/route'
import { fieldLabel, labels, pick, title } from './tr'
import { type Acts, S, at, cols, cut, decisions, draw, kindOf, read, t0 } from './model'

export { ack, syncStatus } from './notify'
let lastW = 0   // width of the last pane draw: sizes a timeline step (a resize is a redraw), not state
const later = (h: Host, fn: () => Promise<unknown>) => h.ops?.after(1, () => fn().catch(e => h.toast(`${e}`)))

// Open the pane on a tab (called by /cadre open|approve and by presses). Where nothing draws, the content goes to $.ui.log instead (C3).
const OPEN = { id: 'cadre', title: 'cadre', columns: 120 }
// The open call is the first thing a command or press does: only there does the engine count it as asked (any width); inside after() it is "unasked" (>= 144 columns, live capture ADR 0008)
// /theme can change after session start: the Raster palette follows it (read on every pane open / tab press and on the tick)
async function syncTheme(h: Host): Promise<void> {
  const th = await h.theme?.().catch(() => undefined)
  if (th && readCfg(await h.ui.read()).theme !== th) await h.ui.update(u => ({ ...u, cfg: { ...(u.cfg as object | undefined), theme: th } }))
}
export async function openPane(h: Host, tab: string, o: { focus?: boolean; quiet?: boolean; pre?: ReturnType<NonNullable<Host['ops']>['open']> } = {}): Promise<void> {
  if (tab === 'settings') await refreshSettings(h)
  if (tab === 'lessons') await refreshLessons(h)
  await syncTheme(h)
  const opened = o.pre ?? h.ops!.open({ ...OPEN, ...(o.focus === false ? {} : { focus: true as const }) })   // `focus: false` is refused by the engine: leave it out
  const v = await read(h)
  await h.ui.update(u => ({ ...u, tab }))
  const r = await Promise.resolve(opened).catch((x: Error) => ({ isPlaced: false, reason: String(x?.message ?? x) }))   // a refused open used to vanish in the callers' catch: say why
  await h.ui.update(u => ({ ...u, paneErr: r.isPlaced ? undefined : { at: v.now, reason: (r.reason ?? 'not placed').slice(0, 120) } }))   // Doctor shows the last failure
  if (!r.isPlaced) {
    if (!o.quiet) { h.toast(`pane not shown${r.reason ? ` · ${r.reason.slice(0, 40)}` : ''}`) }
    if (decisions(v).length) later(h, () => answerDialog(h))   // no pane (VS Code panel, Remote Control) and no band key: the dialog of the oldest decision
  }
  if (!o.quiet) await ack(h)
}
export async function onEvent(h: Host, e: Parameters<typeof notifyEvent>[1]): Promise<void> {
  await notifyEvent(h, e); await autoAsk(h)
  if (readCfg(await h.ui.read()).flash) h.ops?.after(1600, () => h.ops?.invalidate())   // the 1.5 s row flash ends by a redraw (BRAND §9)
}

// A decision pops its dialog by itself at most ONCE, the first time it can, and only over an empty composer with no dialog of ours up (a `quiet` one never does).
// After that only `1` (band or pane) opens it: a dismissal (Esc) never comes back on its own.
export async function autoAsk(h: Host): Promise<void> {
  if (!h.ask || !h.ops) return
  const shown = ((await h.ui.read()).shown as string[] | undefined) ?? [], fresh = decisions(await read(h)).filter(d => !d.quiet && !shown.includes(d.id))
  if (!fresh.length) return
  if (asking || (await h.ops.peek()).trim()) return   // typing or a dialog up: not shown yet, so the next tick (5 s) pops it once the composer is empty; meanwhile `1` still works
  await h.ui.update(u => ({ ...u, shown: [...shown, ...fresh.map(d => d.id)].slice(-100) }))
  later(h, () => answerDialog(h, fresh[0].id))
}

// The ONE way a decision is answered (ADR 0012): the native AskUserQuestion dialog. Fields first, one ask each (keep the value or type a new one); then the
// decision's runnable options (at most 4; "Not now" added when fewer than 2; the engine adds "Type something"). Typed text there is a change request to main
// (Decision.change). The answer goes to core/dispatch.answer, which re-checks the hash; a refusal that moved the decision (stale, an invalid value) re-asks it.
// Dismissed or -p ($.ui.ask rejects): nothing is decided. Auto-answers by other mods are an accepted risk (ADR 0012).
export const NOT_NOW = 'Not now'
const body = (d: Decision) => [title(d), ...(d.error ? [`! ${d.error}`] : []), ...d.lines].slice(0, 7).join('\n')   // the title + at most 6 lines
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
        const keep = f.value ? `Keep ${f.value}` : 'Leave it empty', x = (await h.ask(`${fieldLabel(d, f)}?`, [keep, 'Cancel'])).trim()
        if (x === 'Cancel') return
        vals[f.key] = x === keep ? f.value ?? '' : x
      }
      const os = d.options.filter(o => o.run).slice(0, 4), x = (await h.ask(body(d), [...labels(d, os), ...(os.length < 2 ? [NOT_NOW] : [])])).trim(), o = pick(d, os, x)
      if (!o) {
        if (x && x !== NOT_NOW && !d.fields?.length) { await queueBrief(h, `${d.change ?? `About "${d.title}": `}${x}`); h.log(`sent to Claude · ${cut(x, 60)}`) }
        return
      }
      const r = await h.answer(d.id, o.key, d.hash, vals); h.log(r.text); await syncStatus(h); h.ops?.invalidate()   // a status computed while the command ran may hold the card it just settled (board and ui are read apart): recompute once it returned (the engine prefixes the plugin name)
      if (!r.text.startsWith('refused')) return
      id = d.id; last = d.hash
    }
  } catch { /* dismissed, or -p: nothing is decided */ } finally { asking = false }
}

export function acts(h: Host): Acts {
  return {
    go: tab => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, () => openPane(h, tab, { pre })) },
    pick: id => { const pre = h.ops!.open({ ...OPEN, focus: true }); later(h, async () => { await h.ui.update(u => ({ ...u, sel: id, go: false })); await openPane(h, 'epic', { pre }) }) },
    run: cmd => later(h, async () => { const r = await configPress(h, cmd); h.toast(`${r.text.split('\n')[0].slice(0, 53)}`); h.ops?.invalidate(); await autoAsk(h) }),   // a Settings toggle (a press, not a decision); edit asks its decision
    drive: what => later(h, async () => { const r = await dispatch(h, { schemaVersion: 1, cmd: 'drive', args: [what], origin: { kind: 'press' } }, ROUTES.drive); h.toast(`${r.text.split('\n')[0].slice(0, 53)}`); h.ops?.invalidate() }),   // band `0`: drive stop | resume | continue, as the human's press
    answer: id => later(h, async () => { await ack(h); await answerDialog(h, id) }),   // `1`: the decision's dialog, again
    step: (what, d) => later(h, async () => {
      const v = await read(h), ts = at(v).tasks, ids = cols(ts).flat().map(t => t.id), cur = v.t ?? v.now
      const unit = 60000 * Math.max(1, Math.ceil(((v.now - t0(v)) / 60000 + 1) / Math.max(10, (lastW || 116) - 14)))   // about one timeline column
      const go = (t: number) => ({ t: t > v.now - unit / 2 ? null : Math.max(t0(v), t) })
      const p: Record<string, unknown> = what === 'done' ? { dn: !v.ui.dn } : what === 'keys' ? { ks: v.ui.ks !== true }
        : what === 'node' ? { sel: ids[(ids.indexOf(selId(v, ts)) + d + ids.length) % ids.length] }
        : what === 'time' ? go(cur + d * unit) : { t: null, sel: undefined }
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
  return E.Box({ flexDirection: 'column', children: [draw(E, p.before), ...(p.raster ? [E.Raster({ key: 'tl', columns: p.raster.cols, rows: p.raster.rows, cells: p.raster.cells })] : []), ...(p.after.length ? [draw(E, p.after)] : [])] })
}
// result-card row: core records tool_use_id -> task (mapCard); the task's `card` text is drawn (line 1 = summary, line 2 = next). While running or unmapped: the engine's row.
export const mapCard = (h: Host, toolUseId: string, taskId: string) => h.ui.update(u => ({ ...u, cards: { ...(u.cards as object | undefined), [toolUseId]: taskId } }))
export async function renderCard(h: Host, e: any, next: (e: any) => any) {
  const v = await read(h), id = (v.ui.cards as Record<string, string> | undefined)?.[e.props.tool_use_id], t = id ? v.b.tasks.find(x => x.id === id) : undefined
  if (e.props.isRunning || !t?.card) return next(e)
  const [row, nx] = t.card.split('\n'), k = /✗|refus|fail/i.test(row) ? 'fail' : 'done', ac = readCfg(v.ui).ascii
  return draw(h.ops!.els(e), [[S(`${ac ? '*' : '⏺'} `), S(glyph(k, ac), color(glyphRole(k))), S(` ${row}`)], ...(nx ? [[S(`  ${nx}`)]] : [])])
}
// transcript line after /clear rehydrate (6.7); the band says the rest (drive: `2: resume`)
export async function resumeBanner(h: Host, o: { decisions?: number; next?: string; stale?: number } = {}): Promise<void> {
  const v = await read(h), ts = v.b.tasks, n = ts.filter(t => kindOf(t, ts) === 'run').length, q = v.b.resumesQueued, ac = readCfg(v.ui).ascii
  if (v.ui.cont) return h.log(`${glyph('wait', ac)} unfinished plan ${v.b.plan?.id} (${prog(ts)} done) · nothing runs it now · /cadre continue or 0 picks it up`)   // an earlier session left it (core/session.rehydrate)
  h.log(`${glyph('done', ac)} resumed${v.b.mission ? ` · mission "${v.b.mission}"` : ''}${v.b.plan ? ` · epic ${v.b.plan.id}` : ''} · ${n} running (re-adopted)${o.stale ? ` · ${o.stale} stale → rebind` : ''}${q ? ` · ${q} queued` : ''}${o.next ? ` · next: ${o.next}` : ''}`)
}
// the render hook cannot read env/config, so the tick keeps the resolved strictness (M10) in the ui atom for it
export async function tickUi(h: Host): Promise<void> {
  const sx = await strictOf(h).catch(() => undefined); if (sx) await h.ui.update(u => (u.sx === sx ? u : { ...u, sx }))
  await syncTheme(h)
  h.ops?.invalidate()   // elapsed counters and `just now` age on the 30 s tick
}
