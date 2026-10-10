// Notification policy (UI-DESIGN 4): level from kind + severity + needsHuman (never stored), dedupe by key, <=1 toast / 8 s with merging, OS notify <=1/item and <=3 / 15 min,
// escalation after ui.escalateAfterMs unless acked, status line = top attention item only. State lives in the cadre.ui atom; side effects run after the CAS settles.
import type { CadreEvent, Host } from '../types'
import { CFG, attention, read } from './model'

export type Level = 0 | 1 | 2 | 3   // silent . · band o · toast * · notify !
export function levelOf(e: CadreEvent): Level {
  const d = e.data, st = String(d.state ?? d.to ?? '')
  switch (e.type) {
    case 'approval.pending': case 'flag.raised': return 3
    case 'task.transitioned': return st === 'blocked' ? 3 : st === 'done' || d.from === 'review' && st === 'active' ? 1 : e.severity === 'crit' ? 2 : 0
    case 'check.ran': return 1
    case 'sync.state_changed': return st === 'ok' && !d.conflicts ? 1 : 2
    case 'drive.status': return st === 'paused' || st === 'finished' ? 3 : 0
    case 'agent.unbound': return d.reason === 'stale' ? 1 : 0
    case 'init.stage': return st === 'proposed' ? 2 : 0
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
    case 'drive.status': return st === 'paused' || st === 'finished' ? { text: st === 'paused' ? `Drive paused${d.reason ? `: ${d.reason}` : ''}` : 'Epic landed on dev ✓', key: `drive:${st}` } : undefined
    case 'cost.updated': return d.threshold ? { text: `Drive at ${d.threshold}% of token budget`, key: `cost:${d.threshold}` } : undefined
    case 'init.stage': return st === 'proposed' ? { text: 'Init diff ready · /cadre open init', key: `init:${d.stage}` } : undefined
    default: return undefined
  }
}
const CLOSE: Partial<Record<CadreEvent['type'], (e: CadreEvent) => string>> = { 'flag.resolved': e => `flag:${e.taskId}:${e.data.flag}`, 'sync.state_changed': e => (e.data.state === 'ok' ? `off:${e.data.target}` : '') }

export const ack = (h: Host) => h.now().then(n => h.ui.update(u => ({ ...u, ack: n })))   // composer submit, any /cadre, a cadre press, pane focus

async function toast(h: Host, text: string, now: number): Promise<void> {
  let direct = false, first = false, wait = 0
  await h.ui.update(u => {
    const q = (u.q as string[] | undefined) ?? [], dt = now - ((u.lt as number | undefined) ?? -1e9)
    direct = dt >= 8000 && !q.length; first = !direct && !q.length; wait = Math.max(0, 8000 - dt)
    return direct ? { ...u, lt: now } : { ...u, q: [...q, text] }
  })
  if (direct) h.ops?.toast(text, { timeoutMs: 6000 })
  else if (first) h.ops?.after(wait, async () => {   // coalesce what arrived inside the window
    let q: string[] = []
    await h.ui.update(u => { q = (u.q as string[]) ?? []; return { ...u, q: [], lt: now + wait } })
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
// status line: the top attention item, cleared when none (never the command, so never a code)
export async function syncStatus(h: Host): Promise<void> { const top = attention(await read(h))[0]; h.ops?.status(top ? `${top.text} · press 1` : undefined) }

// subscribed to core/events: one call per emitted event
export async function onEvent(h: Host, e: CadreEvent): Promise<void> {
  const k = CLOSE[e.type]?.(e), lv = levelOf(e), t = textOf(e)
  if (k) await h.ui.update(u => { const { [k]: _x, ...rest } = (u.open as Record<string, number> | undefined) ?? {}; return { ...u, open: rest } })
  if (lv >= 2 && t) {
    let fresh = false
    await h.ui.update(u => { const o = (u.open as Record<string, number> | undefined) ?? {}; fresh = !(t.key in o); return fresh ? { ...u, open: { ...o, [t.key]: e.at } } : u })
    if (fresh) {
      await toast(h, t.text, e.at)
      if (lv === 3) {
        if (e.type === 'drive.status') await notify(h, t.key, t.text, e.at)   // drive paused/finished: immediately
        else h.ops?.after(((await h.ui.read()).cfg as { escalateAfterMs?: number } | undefined)?.escalateAfterMs ?? CFG.escalateAfterMs, async () => {
          const u = await h.ui.read()
          if (t.key in ((u.open as object) ?? {}) && ((u.ack as number | undefined) ?? 0) < e.at) await notify(h, t.key, t.text, await h.now())
        })
      }
    }
  }
  await syncStatus(h)
}
