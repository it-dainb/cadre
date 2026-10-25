// One output contract for every agent (ADR 0010): a marker-less explorer ("ask") has no task, so it is tracked here, keyed by its agentId, from admission on.
// Its answer comes only through report (validated); a stop without one is nudged limits.nudges times through the queued resume, then auto-reported from its last text (flag
// auto-reported). Main never gets the agent's prose: the Agent result (foreground) and the task-notification (background) become the ask card.
import { modelText } from './say'
import type { Host } from '../types'
import { step } from './lifecycle'
import { cfgOf } from './dispatch'

export interface Ask { id: string; role?: string; task?: string; q: string; tu?: string; k: number; answer?: string; cites?: number; auto?: boolean; told?: boolean }
const all = async (h: Host) => ((await h.ui.read()).asks ?? {}) as Record<string, Ask>
const put = (h: Host, a: string, f: (x: Ask) => Ask) => h.ui.update(u => { const m = (u.asks ?? {}) as Record<string, Ask>; return m[a] ? { ...u, asks: { ...m, [a]: f(m[a]) } } : u })
export const askOf = async (h: Host, agentId?: string) => (agentId ? (await all(h))[agentId] : undefined)
export const askByTool = async (h: Host, tu?: string) => Object.entries(await all(h)).find(([, x]) => tu && x.tu === tu)
export const askById = async (h: Host, id: string) => Object.values(await all(h)).find(x => x.id === id)
const one = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

// admission: the spawn started (next answered its agentId)
export async function asked(h: Host, agentId: string, e: { prompt?: string; tool_use_id?: string }, told?: false, role?: string, task?: string): Promise<void> {   // role: a custom role's name (core/admission.custom): its tools and write scope are the guard's   // told false: no card shows it, its answer is sent to main (askStopped)
  await h.ui.update(u => ({ ...u, asks: { ...(u.asks as object), [agentId]: { id: `ask-${agentId.slice(-6)}`, ...(role ? { role } : {}), ...(task ? { task } : {}), q: one(String(e.prompt ?? ''), 80), tu: e.tool_use_id, k: 0, ...(told === false ? { told } : {}) } } }))
}
// the card main sees instead of the agent's text: role, status, one line of the answer (<= 200), where the rest is
export const askCard = (a: Ask): string => [`EXPLORER ${a.id} "${a.q}"`, a.answer === undefined ? 'explorer → finishing its answer' : `explorer → answered (${a.cites ?? 0} citations)`,
  `flags: ${a.auto ? 'auto-reported' : 'none'}`, ...(a.answer === undefined ? ['next: wait; the answer arrives on its own. Do not ask again.'] : [`answer: ${one(a.answer, 200)}`, `next: full answer: explore {id:"${a.id}"}`])].join('\n')
export const askTask = (a: Ask) => ({ id: a.id, subject: a.q, description: `${a.auto ? '(auto-reported: the explorer stopped without its report)\n' : ''}${a.answer ?? '(no answer yet)'}`, status: a.answer === undefined ? 'in_progress' : 'completed', blocks: [], blockedBy: [] })

// report{role:"explorer"} from an ask (tools/index, after the envelope check)
export async function askAnswer(h: Host, agentId: string, r: { answer: string; citations?: unknown[] }): Promise<string> {
  await put(h, agentId, x => ({ ...x, answer: String(r.answer).slice(0, 2000), cites: (r.citations ?? []).length, auto: false }))
  return 'answer recorded. Stop.'
}
export const NUDGE = 'You stopped without calling report; a hand-back message is not a report. Call the report tool now, once: {"schemaVersion":1,"role":"explorer","answer":"<your answer>","citations":[{"path":"src/a.ts","line":1}]}'
// the ask's turn.complete (core/close.observe): no answer -> nudge x2 -> auto-report; an ask whose card said "finishing" gets its answer card sent to main once
export async function askStopped(h: Host, e: { agentId: string; answer?: string; reason?: string }): Promise<void> {
  const a = await askOf(h, e.agentId); if (!a) return
  if (a.answer === undefined && e.reason === 'answer' && a.k < (await cfgOf(h)).limits.nudges) { await put(h, e.agentId, x => ({ ...x, k: x.k + 1 })); return void (await step(h, e.agentId, { type: 'resume', taskId: a.id, text: NUDGE })) }
  if (a.answer === undefined) await put(h, e.agentId, x => ({ ...x, answer: one(String(e.answer ?? ''), 2000) || '(no answer)', cites: 0, auto: true }))
  const b = (await askOf(h, e.agentId))!
  if (b.told === false) { await put(h, e.agentId, x => ({ ...x, told: true })); await h.submit?.(modelText('card', `Result of ${b.id}: ${askCard(b).replaceAll('\n', ' · ')}`)).catch(() => {}) }
}
// the card replaced a hand-back: told=true when it carried the answer, false when it said "finishing" (then askStopped sends the answer once)
export const shown = (h: Host, agentId: string, a: Ask) => put(h, agentId, x => ({ ...x, told: a.answer !== undefined }))
