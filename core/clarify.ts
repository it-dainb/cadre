// Clarify before a goal's plan (ADR 0020). Main calls explore ONCE (its first explore of a goal run is the clarify explorer: commands/agentrun.seen), then
// records how clear the goal is on four points with ask {clarity}. The answer, computed here from the settings, says what comes next: draft,
// ask at most N informed questions in one round, or (yolo) decide and list the assumptions on the plan. `/cadre deep` loops one question per round instead.
// The settings are enforced at main's tool calls (clarifyCall), not only in the guide's words.
import { modelData, modelText } from './say'
import type { Host, Secret } from '../types'
import type { Config } from '../config/index'
import { cfgOf } from './dispatch'

export const DIMS = ['outcome', 'scope', 'acceptance', 'constraints'] as const
type P = Config['planning']
type G = NonNullable<Secret['goalRun']>
type C = Record<string, number>

export const scoreLine = (c: C) => DIMS.map(d => `${d} ${(c[d] ?? 0).toFixed(1)}`).join(' · ')
export const weak = (c: C, threshold: number) => DIMS.filter(d => (c[d] ?? 0) < threshold).sort((a, b) => c[a] - c[b])   // weakest first
const ASSUMED = 'assumed on the plan, one line per point ("<point>: what you assumed")'

// what main does after a clarity record (pure). assume: the points a yolo plan must list as assumed.
export function nextStep(c: C, p: P, g: Pick<G, 'mode' | 'deep' | 'asked'>): { text: string; assume?: string[] } {
  const w = weak(c, p.clarify.threshold), line = `clarity: ${scoreLine(c)}`
  if (!w.length) return { text: `${line} · clear. Draft the plan now.` }
  if (g.mode === 'yolo' && !g.deep) return { text: `${line} · unclear: ${w.join(', ')}. Do not ask the user: decide each point from what the explorer found, then draft the plan now with ${ASSUMED}.`, assume: w }
  if (g.deep && (g.asked ?? 0) >= p.deep.maxRounds) return { text: `${line} · the question rounds are used up. Draft the plan now; put what is still unclear in ${ASSUMED}.` }
  if (g.deep) return { text: `${line} · weakest: ${w[0]}. Show the user these scores in one line, then ask ONE question about ${w[0]} (AskUserQuestion, one question, options informed by what the explorer found). After the answer, record the clarity again. If the user says enough, draft the plan.` }
  if (g.asked) return { text: `${line} · you asked already. Draft the plan now; put what is still unclear in ${ASSUMED}.` }
  return { text: `${line} · unclear: ${w.join(', ')}. Ask the user at most ${p.clarify.maxQuestions} questions in ONE AskUserQuestion call, about ${w.slice(0, p.clarify.maxQuestions).join(', ')}. Make each one informed: name what the explorer found (files, names, existing choices) and offer them as options. Then draft the plan with the answers.` }
}

// main's AskUserQuestion during a goal run (pure): null = it may ask
export function askRefusal(n: number, p: P, g: G): string | null {
  if (!g.deep && !p.clarify.enabled) return null   // no clarify step: as before
  if (g.mode === 'yolo' && !g.deep) return `do not ask the user here: decide it yourself from what the explorer found and put it in ${ASSUMED}.`
  if (!g.clarity) return 'record the clarity first: ask {"clarity": {"outcome": 0-1, "scope": 0-1, "acceptance": 0-1, "constraints": 0-1}}; its answer says whether to ask.'
  const w = weak(g.clarity, p.clarify.threshold)
  if (!w.length) return 'the goal is clear enough: draft the plan now.'
  if (g.deep) return (g.asked ?? 0) >= p.deep.maxRounds ? 'the question rounds are used up: draft the plan now.' : n > 1 ? `one question per round: ask only about ${w[0]}.` : (g.asked ?? 0) >= (g.rounds ?? 0) ? 'record the clarity again first (ask clarity): the next question goes to the weakest point.' : null
  return g.asked ? 'you asked already: draft the plan now with the answers you have.' : n > p.clarify.maxQuestions ? `at most ${p.clarify.maxQuestions} questions: keep the ones about ${w.slice(0, p.clarify.maxQuestions).join(', ')}.` : null
}

// the goal guide for this goal: its clarify step when clarify is on, replaced by guides/deep.md for `/cadre deep`; the numbers from the settings
export function guideOf(g: string, p: P, deep: string | null = null): string {
  const t = deep !== null || !p.clarify.enabled ? g.replace(/## Before step 2: clarify\n[\s\S]*?(?=## )/, deep ? `${deep.trim()}\n\n` : '') : g
  return t.replaceAll('{maxQuestions}', String(p.clarify.maxQuestions)).replaceAll('{maxRounds}', String(p.deep.maxRounds))
}

// one judgement per question call: tool.check and tool.call both see it (in either order, live), the first one judges and counts it
async function askGate(h: Host, q: unknown, tu: string | undefined, p: P, g: G): Promise<string | null> {
  if (tu && g.askTu === tu) return null
  const why = askRefusal(Array.isArray(q) ? q.length : 1, p, g); if (why) return why
  await setRun(h, x => ({ ...x, asked: (x.asked ?? 0) + 1, ...(tu ? { askTu: tu } : {}) })); return null
}
const byPlugin = (o?: { plugin?: string }) => !!o?.plugin && o.plugin !== 'engine'   // next.origin: 'engine' = the model's own call
const deny = (t: string) => ({ deny: modelText('deny', t) }), refused = (t: string) => ({ result: modelText('tool-result', `error: ${t}`) })
const setRun = (h: Host, f: (g: G) => G) => h.secret.update(s => (s.goalRun ? { ...s, goalRun: f(s.goalRun) } : s))
// tool.call slot 5 (hooks/register, active repo, before the guards): main's questions to the user during a goal run
export async function clarifyCall(h: Host, e: any, origin?: { plugin?: string }): Promise<unknown | undefined> {
  if (e.agentId || byPlugin(origin) || e.tool !== 'AskUserQuestion') return undefined   // only main's own calls; a plugin's (cadre's dialogs) pass
  const g = (await h.secret.read()).goalRun; if (!g?.on) return undefined
  const why = await askGate(h, e.questions, e.tool_use_id, (await cfgOf(h)).planning, g); return why ? deny(why) : undefined
}
// main's plan and clarity record (core/plantools): a yolo plan lists its assumptions; the clarity record answers what comes next. undefined = go on
export async function clarifyTool(h: Host, kind: 'plan' | 'clarity', m: Record<string, any>): Promise<unknown | undefined> {
  const g = (await h.secret.read()).goalRun
  if (!g?.on) return kind === 'clarity' ? refused('a clarity record belongs to planning a goal the user typed; there is none now') : undefined
  if (kind === 'plan') return g.assume?.length && !m.assumed ? refused(`list what you assumed for ${g.assume.join(', ')}: ${ASSUMED}`) : undefined
  const p = (await cfgOf(h)).planning
  if (!(g.deep || p.clarify.enabled)) return refused('no clarity record is needed here: draft the plan')
  if (!g.explored) return refused('call explore first with what in the project the goal touches; record the clarity after its answer.')
  const c: C = {}; for (const d of DIMS) { const v = m[d]; if (typeof v !== 'number' || !(v >= 0 && v <= 1)) return refused(`clarity.${d}: a number from 0 (unknown) to 1 (clear)`); c[d] = v }
  const r = nextStep(c, p, g)
  await setRun(h, x => ({ ...x, clarity: c, rounds: (x.rounds ?? 0) + 1, ...(r.assume ? { assume: r.assume } : {}) }))
  h.toast(`clarity · ${scoreLine(c)}`)
  return { result: modelData('tool-result', { clarity: c }), context: [modelText('context', r.text)] }
}
// tool.check (hooks/register slot 4): the question dialog opens at the permission step, before tool.call, so a refused question is refused here first (live: the user answered, then main was refused)
export async function clarifyCheck(h: Host, e: any, origin?: { plugin?: string }): Promise<unknown | undefined> {
  if (e.agentId || byPlugin(origin) || e.tool !== 'AskUserQuestion') return undefined   // origin.plugin: cadre's own decision dialog (live: the plan approval was refused)
  const g = (await h.secret.read()).goalRun; if (!g?.on) return undefined
  const why = await askGate(h, e.input?.questions, e.tool_use_id, (await cfgOf(h)).planning, g)
  return why ? { decision: 'deny', reason: modelText('deny', why) } : undefined
}
// the status line while a deep talk runs (commands/cadre.status)
export const deepLine = (g: G | undefined, p: P): string | null => (g?.on && g.deep ? `talking it through · round ${Math.min((g.asked ?? 0) + 1, p.deep.maxRounds)}/${p.deep.maxRounds}${g.clarity ? ` · ${scoreLine(g.clarity)}` : ''} · answer Claude's question` : null)
