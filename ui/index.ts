// UI entry points wired by hooks/register.ts (UI-DESIGN 5, 7): render hooks (band, pane, result card), press handlers, prefill (5.2), openPane, resume banner, cursor tick.
// The UI reads the human view, the ring and the secret only; render is pure; writes happen in handlers (and a press's own work runs in after(1), UI-14).
import type { Host } from '../types'
import { band as bandOf } from './band'
import { pane, sel } from './pane'
import { sheet, sheetOf, sheetSig } from './sheet'
import { blit, cells, timeline } from './timeline'
import { ack, levelOf } from './notify'
import { type Acts, S, at, cols, draw, gl, kindOf, read, t0, tg, txt, col, REDO } from './model'

export { onEvent, ack, syncStatus } from './notify'
let lastW = 0   // width of the last pane draw: a cache for cursor-only blits (a resize is a redraw), not state
const later = (h: Host, fn: () => Promise<unknown>) => h.ops?.after(1, () => fn().catch(e => h.toast(`cadre: ${e}`)))

// 5.2: a button only loads the command into an EMPTY composer; the human presses Enter (composer origin).
export async function prefill(h: Host, cmd: string): Promise<void> {
  const o = h.ops!
  if ((await o.peek()).trim()) return o.toast('cadre: composer not empty: clear it, then press again')
  if (!(await o.fill(cmd)).isFilled) o.toast(`cadre: type ${cmd}`)
}

// Open the pane on a tab (called by /cadre open|approve and by presses). Where nothing draws, the content goes to $.ui.log instead (C3).
export async function openPane(h: Host, tab: string): Promise<void> {
  const v = await read(h)
  await h.ui.update(u => ({ ...u, tab, ...(tab === 'plan' ? { seen: { code: v.sec.approval?.code8 ?? '', sig: sheetSig(v) } } : {}) }))
  const r = await h.ops!.open({ id: 'cadre', title: 'cadre', focus: true, columns: 120 })
  if (!r.isPlaced) { h.toast(`cadre: pane not shown${r.reason ? ` (${r.reason})` : ''}; /cadre status`); if (tab === 'plan') h.log(txt(sheet(v, 100, NOOP)).join('\n')) }
  await ack(h)
}
const NOOP: Acts = { go() {}, pick() {}, fill() {}, step() {} }

export function acts(h: Host): Acts {
  return {
    go: tab => later(h, () => openPane(h, tab)),
    pick: id => later(h, async () => { await h.ui.update(u => ({ ...u, sel: id })); await openPane(h, 'epic') }),
    fill: cmd => later(h, async () => { await prefill(h, cmd); await ack(h) }),
    step: (what, d) => later(h, async () => {
      const v = await read(h), ids = cols(at(v).tasks).flat().map(t => t.id), cur = v.t ?? v.now
      const unit = 60000 * timeline(v, lastW || 116).mpc, evs = v.ring.filter(e => levelOf(e) >= 2).map(e => e.at)
      const go = (t: number | null) => ({ t: t === null || t > v.now - unit / 2 ? null : Math.max(t0(v), t) })
      const p: Record<string, unknown> = what === 'sheet' ? { si: Math.max(0, Math.min(sheetOf(v).length - 1, Number(v.ui.si ?? 0) + d)) }
        : what === 'node' ? { sel: ids[(ids.indexOf(sel(v)) + d + ids.length) % ids.length] }
        : what === 'time' ? go(cur + d * unit) : what === 'attn' ? go(d > 0 ? evs.find(x => x > cur) ?? null : [...evs].reverse().find(x => x < cur) ?? null)
        : what === 'live' ? { t: null, sel: undefined } : { tl: v.ui.tl === false }
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
  const w = `↺ cadre resumed from beads · ${o.decisions ?? 0} decisions${o.next ? ` · next: ${o.next}` : ''} · ${tg('wait')} drive off until /cadre drive on`
  await h.ui.update(u => ({ ...u, res: { w, n: `↺ resumed ${v.b.plan?.id} · ${gl(c, 'run')}${n} · ${tg('wait')} drive off`, at: v.now } }))
}
export async function tickUi(h: Host): Promise<void> { if (lastW) await blit(h, await read(h), lastW).catch(() => {}) }   // live cursor advance (30 s clock)
