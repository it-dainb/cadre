// L2 containment check at session.start (DESIGN 13.1): effective settings -> contained / degraded / N commands unsandboxed.
import type { Host, Snapshot } from '../types'
import { policyOf } from './guards'

export const assess = (s: Record<string, any>, repo: string | undefined, wtRepo: string | undefined): { state: Snapshot['containment']['state']; unsandboxed: number; why: string[] } => {
  const sb = s.sandbox ?? {}, fsw = sb.filesystem ?? {}, why: string[] = []
  if (sb.enabled !== true) why.push('sandbox not enabled')
  if (sb.failIfUnavailable !== true) why.push('failIfUnavailable off')
  if (sb.allowUnsandboxedCommands !== false) why.push('allowUnsandboxedCommands not false')
  if (!repo || !(fsw.denyWrite ?? []).includes(repo)) why.push('denyWrite lacks the repo')
  if (!wtRepo || !(fsw.allowWrite ?? []).includes(wtRepo)) why.push('allowWrite lacks the worktree root')
  if (sb.network?.allowLocalBinding) why.push('allowLocalBinding on')
  return { state: why.length ? 'degraded' : 'contained', unsandboxed: Array.isArray(sb.excludedCommands) ? sb.excludedCommands.length : 0, why }
}

// session.start: read, assess, commit to the board band, toast when degraded. A read failure leaves it 'unknown' (L3 then audits every call).
export async function contain(h: Host): Promise<void> {
  const pol = await policyOf(h)
  const r = await h.settings().then(s => assess(s, pol.repo, pol.wtRoot), () => ({ state: 'unknown' as const, unsandboxed: 0, why: ['settings unreadable'] }))
  await h.board.update(b => ({ ...b, containment: { state: r.state, unsandboxed: r.unsandboxed } }))
  if (r.state !== 'contained') h.toast(`cadre: containment ${r.state} · /cadre doctor`)
  if (r.unsandboxed) h.toast(`cadre: ${r.unsandboxed} commands unsandboxed · /cadre doctor`)
}
