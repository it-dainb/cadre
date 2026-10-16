// Notification policy (UI-DESIGN 4): level from kind + severity + needsHuman (never stored), dedupe by key, <=1 toast / 8 s with merging, OS notify <=1/item and <=3 / 15 min,
// escalation after ui.escalateAfterMs unless acked, status line = top attention item only. State lives in the cadre.ui atom; side effects run after the CAS settles.
import type { CadreEvent, Host, Snapshot } from '../types'
import { CFG, attention, read } from './model'
import { clip } from './layout'
import { needsOf } from './v2/facts'
import { holds, yoloOn } from '../core/decide'

export type Level = 0 | 1 | 2 | 3   // silent . · band o · toast * · notify !
// yolo: main answers blocked questions and the flags drive does not hold on, so those never reach the human (no toast, no "press 1")
export const quietUnderYolo = (e: CadreEvent): boolean => (e.type === 'flag.raised' && !holds(String(e.data.flag))) || (e.type === 'task.transitioned' && String(e.data.to ?? e.data.state) === 'blocked')
export function levelOf(e: CadreEvent, yolo = false): Level {
  const d = e.data, st = String(d.state ?? d.to ?? '')
  if (yolo && quietUnderYolo(e)) return 0
  switch (e.type) {
    case 'approval.pending': case 'flag.raised': return 3
    case 'task.transitioned': return st === 'blocked' ? 3 : st === 'done' || d.from === 'review' && st === 'active' ? 1 : e.severity === 'crit' ? 2 : 0
    case 'check.ran': return 1
    case 'sync.state_changed': return st === 'ok' && !d.conflicts ? 1 : 2
    case 'drive.status': return st === 'paused' || st === 'finished' || st === 'stopped' ? 3 : 0
    case 'agent.unbound': return d.reason === 'stale' ? 1 : 0
    case 'plan.landed': return d.on ? 2 : 0   // an epic of a milestone landed on the milestone branch (the milestone's own landing is drive's toast)
    case 'init.stage': return st === 'proposed' ? 2 : 1   // done / Claude working: in the log, no toast
    case 'cost.updated': return d.threshold ? 2 : 0
    default: return e.needsHuman ? 3 : e.severity === 'crit' ? 2 : 0
  }
}
// matrix text (no secrets, D7) + dedupe key; undefined = no toast
export function textOf(e: CadreEvent): { text: string; key: string } | undefined {
  const d = e.data, id = e.taskId ?? String(d.taskId ?? ''), st = String(d.state ?? d.to ?? '')
  switch (e.type) {
    case 'approval.pending': return { text: `Plan ${d.planId} ready for approval · press 1`, key: `approve:${d.planId}:${d.rev ?? ''}` }
    case 'task.transitioned': return st === 'blocked' ? { text: `${id} blocked: needs an answer`, key: `q:${id}:${d.hash ?? ''}` } : undefined
    case 'flag.raised': return { text: `${id} flagged ${d.flag} · press 1`, key: `flag:${id}:${d.flag}` }
    case 'sync.state_changed': return st === 'ok' ? { text: `${d.target} reconnected${d.conflicts ? ` · ${d.conflicts} conflict` : ''}`, key: `off:${d.target}` } : { text: `${d.target} ${st} · retrying`, key: `off:${d.target}` }
    case 'drive.status': if (st === 'stopped') return { text: clip(`drive stopped${d.reason ? ` · ${d.reason}` : ''} · 0: resume`, 60), key: `drive:stopped:${e.at}` }   // one toast per stop
      return st === 'paused' || st === 'finished' ? { text: st === 'paused' ? `Drive paused${d.reason ? `: ${d.reason}` : ''}` : 'Landed on dev ✓', key: `drive:${st}` } : undefined
    case 'plan.landed': return d.on ? { text: `Epic ${d.planId} landed on ${d.on} ✓`, key: `landed:${d.planId}` } : undefined
    case 'cost.updated': return d.threshold ? { text: `Drive at ${d.threshold}% of token budget`, key: `cost:${d.threshold}` } : undefined
    case 'init.stage': return st === 'proposed' ? { text: 'Init diff ready · /cadre open init', key: `init:${d.stage}` } : undefined
    default: return undefined
  }
}
const CLOSE: Partial<Record<CadreEvent['type'], (e: CadreEvent) => string[]>> = { 'flag.resolved': e => String(e.data.flag).split(',').map(f => `flag:${e.taskId}:${f}`), 'sync.state_changed': e => (e.data.state === 'ok' ? [`off:${e.data.target}`] : []) }   // a keep resolves every flag at once: "a,b"

// an approval or a blocked task settles on the board (core/decide.settle, a release, a cancel), with no event of its own: its key closes once the
// board no longer owes it, checked before every use of `open` (an event, the merged flush, the escalation); an event's CLOSE keys go with it
const owed = (b: Snapshot, k: string) => { const [kind, id] = k.split(':'); return kind === 'approve' ? (b.decisions ?? []).some(d => d.id === `plan:${id}`) : kind === 'q' ? b.tasks.some(t => t.id === id && t.state === 'blocked') : true }
const snap = async (h: Host): Promise<[string[], Snapshot]> => [Object.keys(((await h.ui.read()).open as object | undefined) ?? {}), await h.board.read()]   // open keys first: one opened after the board read (an approval landing before the write) is kept
async function prune(h: Host, drop: string[] = [], pre?: [string[], Snapshot]): Promise<Record<string, number>> { const [seen, b] = pre ?? await snap(h); let o: Record<string, number> = {}; await h.ui.update(u => { const all = (u.open as Record<string, number> | undefined) ?? {}; o = Object.fromEntries(Object.entries(all).filter(([k]) => !drop.includes(k) && (!seen.includes(k) || owed(b, k)))); return Object.keys(o).length === Object.keys(all).length ? u : { ...u, open: o } }); return o }   // nothing dropped: no write
export const ack = (h: Host) => h.now().then(n => h.ui.update(u => ({ ...u, ack: n })))   // composer submit, any /cadre, a cadre press, pane focus

// a merged toast fires up to 8 s after its items: one settled meanwhile (closed in `open`) is dropped, never offered ("flagged loop · press 1" after Keep)
async function toast(h: Host, text: string, key: string, now: number): Promise<void> {
  let direct = false, first = false, wait = 0
  await h.ui.update(u => { const q = (u.q as [string, string][] | undefined) ?? [], dt = now - ((u.lt as number | undefined) ?? -1e9)
    direct = dt >= 8000 && !q.length; first = !direct && !q.length; wait = Math.max(0, 8000 - dt); return direct ? { ...u, lt: now } : { ...u, q: [...q, [text, key]] } })
  if (direct) h.ops?.toast(text, { timeoutMs: 6000 })
  else if (first) h.ops?.after(wait, async () => {   // coalesce what arrived inside the window
    let q: string[] = []; const o = await prune(h)
    await h.ui.update(u => { q = ((u.q as [string, string][]) ?? []).filter(([, k]) => k in o).map(([t]) => t); return { ...u, q: [], lt: now + wait } })
    if (q.length) h.ops?.toast(q.length === 1 ? q[0] : `${q.length} updates: ${q.join(' · ')}`, { timeoutMs: 6000 })
  })
}
async function notify(h: Host, key: string, text: string, now: number): Promise<void> {
  const cfg = { ...CFG, ...((await h.ui.read()).cfg as object) }
  if (cfg.notify === 'off' || !h.ops || await h.ops.focused()) return
  let ok = false
  await h.ui.update(u => {
    const nt = ((u.nt as number[] | undefined) ?? []).filter(x => now - x < 900_000), sent = (u.nf as Record<string, number> | undefined) ?? {}
    ok = !(key in sent) && nt.length < 3
    return ok ? { ...u, nt: [...nt, now], nf: { ...sent, [key]: now } } : u
  })
  if (ok && !(await h.ops.notify(text, { title: 'cadre' })).isSent) h.ops.toast(text, { timeoutMs: 6000 })
}
// status line: what the human owes (ui/v2/facts.needsOf, the band's own test), else a problem state; cleared when none (never the command, so never a code)
// "press 1" only where 1 opens a dialog: a run's progress card is no need (live 0.11.0: "init · 2/8 done · Claude is on it · press 1" opened nothing)
export async function syncStatus(h: Host): Promise<void> { const v = await read(h), top = needsOf(v)[0] ?? attention(v).find(i => !i.d); h.ops?.status(top ? `${top.text}${top.d ? ' · press 1' : ''}` : undefined) }

// subscribed to core/events: one call per emitted event
export async function onEvent(h: Host, e: CadreEvent): Promise<void> {
  const k = CLOSE[e.type]?.(e), pre = await snap(h), lv = levelOf(e, yoloOn(pre[1].drive)), t = textOf(e)
  await prune(h, k, pre)
  if (lv >= 2 && t) {
    let fresh = false
    await h.ui.update(u => { const o = (u.open as Record<string, number> | undefined) ?? {}; fresh = !(t.key in o); return fresh ? { ...u, open: { ...o, [t.key]: e.at } } : u })
    if (fresh) {
      await toast(h, t.text, t.key, e.at)
      if (lv === 3) {
        if (e.type === 'drive.status') await notify(h, t.key, t.text, e.at)   // drive paused/finished: immediately
        else h.ops?.after(((await h.ui.read()).cfg as { escalateAfterMs?: number } | undefined)?.escalateAfterMs ?? CFG.escalateAfterMs, async () => {
          const u = await h.ui.read()
          if (t.key in (await prune(h)) && ((u.ack as number | undefined) ?? 0) < e.at) await notify(h, t.key, t.text, await h.now())
        })
      }
    }
  }
  await syncStatus(h)
}
