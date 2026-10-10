// Model-visible text built by the mod (DESIGN 4.2-4.6, 8.2): role briefs (static header first), per-agent deltas, main's diff-gated context line,
// reminder suppression, resume card, id matcher. Caps from 1.4: header 1.5 KB, spec 4 KB, context 3 KB, notes 500, delta 1 KB, line 1 KB, card 3 KB.
import type { Hook, Host, Role, Snapshot } from '../types'
import { explorerOut, scoped } from '../commands/init'
import { modelView, viewHash } from './board'
import { contextLine } from './render'

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Known-id matcher (4.6): maximal runs of [A-Za-z0-9.-], trailing '.'/'-' stripped, optional TASK- removed, exact lookup. `bd-a1.10` never matches `bd-a1.1`.
export function idsIn(text: string, known: Iterable<string>): string[] {
  const set = new Set(known), out: string[] = []
  for (const m of text.matchAll(/[A-Za-z0-9.-]+/g)) {
    const run = m[0].replace(/[.-]+$/, ''), id = set.has(run) ? run : run.replace(/^TASK-/, '')
    if (set.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

// ---- role briefs ----
const HEAD: Record<Role, string> = {
  tester: 'Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:"tester"}.',
  worker: 'Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Finish with report{role:"worker"}.',
  reviewer: 'Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. Finish with report{role:"reviewer"}.',
  explorer: 'Explorer brief. Read-only. Answer with citations. Finish with report{role:"explorer"}.',
}
export interface BriefIn {
  id: string; title: string; type: string; description?: string; scenarios?: string; contract?: string; notes?: string
  testPaths?: string[]; locked?: string[]; redCard?: string; greenCard?: string; deps?: { id: string; title: string; out?: string }[]
  findings?: string[]; decisions?: string[]; handoff?: string; others?: string[]; protectedPaths?: string[]
  sourceCommit?: string; diffStat?: string; diff?: string; audit?: string; report?: string; changelog?: string; flags?: string[]; question?: string
}
// contract JSON ({symbols:[{name,kind,params,returns,errors?,doc?,status}]} | {none,reason}) -> compact lines
export function renderContract(design?: string): string {
  if (!design) return ''
  try {
    const c = JSON.parse(design)
    if (c.none) return `none: ${c.reason ?? ''}`
    return (c.symbols ?? []).map((s: any) => `- [${s.status}] ${s.kind} ${s.name}(${[].concat(s.params ?? '').join(', ')}) -> ${s.returns ?? ''}${s.errors ? ` throws ${[].concat(s.errors).join(', ')}` : ''}${s.doc ? ` // ${s.doc}` : ''}`).join('\n')
  } catch { return cap(design, 1000) }
}
const sec = (title: string, body?: string | string[]) => { const b = Array.isArray(body) ? body.join('\n') : body; return b?.trim() ? `## ${title}\n${b.trim()}` : '' }
const join = (xs: string[]) => xs.filter(Boolean).join('\n\n')

export function brief(role: Role, b: BriefIn): string {
  const spec = (s: string[]) => cap(join(s), 4096), ctx = (s: string[]) => cap(join(s), 3072)
  const notes = sec('Notes', cap(b.notes ?? '', 500)), head = HEAD[role]
  const contract = sec('Contract', renderContract(b.contract))
  if (role === 'explorer') return join([head, `# ${b.question !== undefined ? 'QUESTION' : `TASK-${b.id}`}\n${b.question ?? b.title}`, sec('Scope', 'read-only; no edits, no shell'), notes])
  if (role === 'tester')
    return join([head, `# SPEC TASK-${b.id}`, spec([sec('Scenarios', b.scenarios), contract]), sec('Test paths', b.testPaths), sec('Folder', 'tests only; read FILES.md first: it lists what you can see (you cannot list directories)'), notes])
  if (role === 'reviewer')
    return join([head, `# REVIEW TASK-${b.id}`, sec('Source commit', b.sourceCommit), sec('Diff', [b.diffStat ?? '', cap(b.diff ?? '', 3072)]),
      spec([sec('Scenarios', b.scenarios), contract, sec('Spec tests', b.locked)]),
      ctx([sec('Red/green cards', [b.redCard ?? '', b.greenCard ?? '']), sec('Tester audit', b.audit), sec('Worker report', b.report), sec('Changelog and commit header', b.changelog), sec('Flags', b.flags)]), notes])
  return join([head, `# TASK-${b.id} ${b.title} (${b.type})`, spec([sec('Description', b.description), sec('Scenarios', b.scenarios), contract]),
    ctx([sec('Locked spec tests', [...(b.locked ?? []), b.redCard ?? '']), sec('Direct dependencies', (b.deps ?? []).map(d => `- ${d.id} ${d.title}${d.out ? `: ${d.out}` : ''}`)),
      sec('Findings / checks', [...(b.findings ?? []), b.greenCard ?? '']), sec('Decisions', b.decisions), sec('Handoff', b.handoff),
      sec('Paths of other active tasks', (b.others ?? []).slice(0, 10)), sec('Protected paths', b.protectedPaths)]), notes])
}
// discovery brief (10.2): the marker-less spawn while init stage 4 is pending
export const DISCOVERY = `${HEAD.explorer}
# DISCOVERY
Read CI config, task runners, manifests, README/CONTRIBUTING and test dirs (CI wins over prose). Per package report setup argv, checks {name: argv}, tdd {paths, report?, stubs?, skeleton?}, viewInclude, and fetches[] = checks whose CI step fetches at test time. Answer report{discovery:{packages:[…]}, citations}; every argv cites its source file.`

// ---- deltas (4.3): <= 1 KB per bound agentId, drained by the tool.call wrap into context, or by a queued resume ----
const dk = (h: Host, agentId: string) => scoped(h, `deltas:${agentId}`)
export async function pushDelta(h: Host, agentId: string, text: string): Promise<void> { const q = ((await h.store.get(await dk(h, agentId))) as string[] | undefined) ?? []; await h.store.set(await dk(h, agentId), [...q, text]) }
export async function drainDelta(h: Host, agentId: string): Promise<string | null> {
  const q = ((await h.store.get(await dk(h, agentId))) as string[] | undefined) ?? []
  if (!q.length) return null
  const out: string[] = []; let n = 0
  for (const t of q) { if (out.length && n + t.length + 1 > 1024) break; out.push(t); n += t.length + 1 }
  const rest = q.slice(out.length); await (rest.length ? h.store.set(await dk(h, agentId), rest) : h.store.del(await dk(h, agentId)))
  return cap(out.join('\n'), 1024)
}

// ---- main's context line (4.5): render.contextLine; here only the init-request next: and the diff gate ----
function lineOf(s: Snapshot, init: boolean): string {
  const p = init ? s.init.find(i => i.state === 'pending' && (i.stage === 3 || i.stage === 4)) : undefined, full = contextLine(modelView(s))
  if (!p) return full
  const nx = p.stage === 4 ? 'spawn the discovery explorer' : 'ask the human for the mission (goal, constraints, non-goals) and draft TaskCreate{kind:"mission"}', base = full.split('\nnext:')[0]
  return `${base ? `${base}\n` : ''}next: ${nx}`
}

// one-time resume card (8.2), <= 3 KB. Rendered from computed data by whoever rehydrates, queued with queueCard.
export interface CardIn { mission: string | null; epic: { id: string; title: string; intent?: string } | null; decisions: string[]; questions: string[]; inflight: { id: string; step: string; owner?: string; checkpoint?: string }[]; drive: string; next: string }
export const renderCard = (c: CardIn): string => cap(join(['Resume card', sec('Mission', c.mission ?? 'none'), sec('Epic', c.epic ? `${c.epic.id} ${c.epic.title}${c.epic.intent ? `\n${c.epic.intent}` : ''}` : 'none'),
  sec('Last decisions', c.decisions.slice(-5)), sec('Open questions', c.questions), sec('In flight', c.inflight.map(t => `- ${t.id} ${t.step}${t.owner ? ` owner ${t.owner}` : ''}${t.checkpoint ? ` checkpoint ${t.checkpoint}` : ''}`)), `drive: ${c.drive}`, `next: ${c.next}`]), 3072)
export const queueCard = (h: Host, card: string) => h.secret.update(s => ({ ...s, ctx: { key: s.ctx?.key ?? '', card } }))

// prompt.submit, main only (S35), while a plan exists or an init request is pending; only when the view hash changed (7). The card goes first, once, and counts as sent.
export const context: Hook = async (h, e, next) => {
  if (e.agentId) return next(e)
  const [s, sc] = [await h.board.read(), await h.secret.read()], card = sc.ctx?.card, init = s.init.some(i => i.state === 'pending') && !(await explorerOut(h)), key = viewHash(s)   // the explorer runs or reported: no second "spawn" 
  if (!card && !s.plan && !init) return next(e)
  if (!card && !init && sc.ctx?.key === key) return next(e)
  await h.secret.update(x => ({ ...x, ctx: { key } }))
  return next({ ...e, context: [...(e.context ?? []), ...(card ? [card] : []), ...(s.plan || init ? [lineOf(s, init)] : [])] })
}
// prompt.attachment: native todo/task reminders are noise next to the board line (BT-23, PC-11)
export const attachment: Hook = (h, e, next) => (e.type === 'todo_reminder' || e.type === 'task_reminder' ? { text: null } : next(e))
