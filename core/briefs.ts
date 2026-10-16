// Model-visible text built by the mod (DESIGN 4.2-4.6, 8.2): role briefs (static header first), per-agent deltas, main's diff-gated context line,
// reminder suppression, resume card, id matcher. Caps from 1.4: header 1.5 KB, spec 4 KB, context 3 KB, notes 500, delta 1 KB, line 1 KB, card 3 KB.
import { modelText } from './say'
import type { Hook, Host, Role } from '../types'
import { scoped } from '../commands/init'
import { idleOf, modelView, viewHash } from './board'
import { contextLine } from './render'

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Known-id matcher (4.6): maximal runs of [A-Za-z0-9_.-] (store ids: c-12-1, older ones my_project-403.1), trailing '.'/'-' stripped, optional TASK- removed, exact lookup. `c-a1.10` never matches `c-a1.1`.
export function idsIn(text: string, known: Iterable<string>): string[] {
  const set = new Set(known), out: string[] = []
  for (const m of text.matchAll(/[\w.-]+/g)) {
    const run = m[0].replace(/[.-]+$/, ''), id = set.has(run) ? run : run.replace(/^TASK-/, '')
    if (set.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

// ---- role briefs ----
const HEAD: Record<Role, string> = {
  tester: 'Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:"tester"}.',
  worker: 'Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:"worker"}.',
  reviewer: 'Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:"reviewer"}.',
  explorer: 'Explorer brief. Read-only. Answer with citations. Finish with report{role:"explorer"}.',
}
export interface BriefIn {
  id: string; title: string; type: string; description?: string; scenarios?: string; contract?: string; notes?: string
  paths?: string[]; testPaths?: string[]; locked?: string[]; redCard?: string; greenCard?: string; deps?: { id: string; title: string; out?: string }[]
  findings?: string[]; decisions?: string[]; handoff?: string; others?: string[]; protectedPaths?: string[]; shared?: string; mission?: string; core?: string; slice?: string; uncovered?: string[]   // uncovered: set when the coverage rule is on (review.coverage.enforce); the scenario ids no locked test name carries
  runAsk?: boolean; sourceCommit?: string; diffStat?: string; diff?: string; audit?: string; report?: string; changelog?: string; flags?: string[]; question?: string; focus?: string
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

// Cache layout (ADR 0022): [plan block][task block]. The plan block holds only plan-level data (mission, protected paths, the landed core's interface,
// the notes without paths), so it is byte-identical for every agent of the plan; ids, paths, notes slices and anything volatile go in the task block.
export const planBlock = (b: Pick<BriefIn, 'mission' | 'protectedPaths' | 'core' | 'shared'>): string => {
  const body = join([sec('Mission', b.mission), sec('Protected paths (never change them)', b.protectedPaths), sec('Shared core interface (landed; build on it, do not change it)', renderContract(b.core)), sec('Shared notes', cap(b.shared ?? '', 1000))])
  return body ? `# PLAN\nContext shared by every task of this plan; your own task follows.\n\n${body}` : ''
}
export function brief(role: Role, b: BriefIn): string {
  const spec = (s: string[]) => cap(join(s), 4096), ctx = (s: string[]) => cap(join(s), 3072)
  const notes = sec('Notes', cap(b.notes ?? '', 500)), head = HEAD[role], plan = planBlock(b), mine = sec('Notes on your files', cap(b.slice ?? '', 1000))
  const contract = sec('Contract', renderContract(b.contract)), files = (why: string) => (b.paths?.length ? `\nFiles: ${b.paths.join(', ')}${why}` : '')   // the task's declared paths, in the task block
  if (role === 'explorer') return join([plan, head, `# ${b.question !== undefined ? 'QUESTION' : `TASK-${b.id}`}\n${b.question ?? b.title}`, sec('Scope', 'read-only; no edits, no shell'), mine, notes])
  if (role === 'tester')
    return join([plan, head, `# SPEC TASK-${b.id}${files(' (the code this task changes)')}`, spec([sec('Scenarios', b.scenarios), contract]), sec('Test paths', b.testPaths), b.runAsk ? sec('How your tests run', RUN_ASK) : '', mine, sec('Folder', 'tests only; read FILES.md first: it lists what you can see (you cannot list directories)'), notes])
  if (role === 'reviewer')
    return join([plan, head, `# REVIEW TASK-${b.id}${files(' (a change outside these files is a finding, not a fail on its own)')}`, sec('Source commit', b.sourceCommit), sec('Diff', [b.diffStat ?? '', cap(b.diff ?? '', 3072)]),
      spec([sec('Scenarios', b.scenarios), contract, sec('Spec tests', b.locked)]),
      sec('Scenario coverage', b.uncovered && [COVER, ...(b.uncovered.length ? [`No spec test is named after: ${b.uncovered.join(', ')}. That alone means verdict changes.`] : [])]),
      ctx([sec('Red/green cards', [b.redCard ?? '', b.greenCard ?? '']), sec('Tester audit', b.audit), sec('Worker report', b.report), sec('Check', b.focus), sec('Changelog entry (context, written at merge) and commit header', b.changelog), sec('Flags', b.flags)]), mine, notes])
  return join([plan, head, `# TASK-${b.id} ${b.title} (${b.type})${files(' (make your changes there)')}`, spec([sec('Description', b.description), sec('Scenarios', b.scenarios), contract]),
    ctx([sec('Locked spec tests', [...(b.locked ?? []), b.redCard ?? '']), sec('Direct dependencies', (b.deps ?? []).map(d => `- ${d.id} ${d.title}${d.out ? `: ${d.out}` : ''}`)),
      sec('Findings / checks', [...(b.findings ?? []), b.greenCard ?? '']), sec('Decisions', b.decisions), sec('Handoff', b.handoff),
      sec('Paths of other active tasks', (b.others ?? []).slice(0, 10))]), mine, notes])
}
// the tester proposes its test command, cadre runs it (ADR 0023): task language only
export const RUN_ASK = 'In your report, give run: the command that runs only your test files, as an argument list with no shell, e.g. {"command":["node","--test","test/login.test.js"]}; add cwd (a folder relative to this one) only if the runner must start there. If the runner can write a JUnit XML report, make it write to $CADRE_JUNIT and set junit to "$CADRE_JUNIT" (pytest --junitxml=$CADRE_JUNIT; node --test --test-reporter=junit --test-reporter-destination=$CADRE_JUNIT; jest with jest-junit). You do not run it: it is run for you, and every test you list must fail with an assertion now, not with an import or setup error.'
// the reviewer's coverage rule (ADR 0022), task language: enforced by close (a pass with a missing or weak scenario is refused)
export const COVER = 'Every scenario needs a spec test named after its id that really checks it. In coverage, give each scenario its test and ok:true only when that test truly checks the behavior; a scenario with no test, or a weak one (ok:false), means verdict changes with a major finding for it.'
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

// one-time resume card (8.2), <= 3 KB. Rendered from computed data by whoever rehydrates, queued with queueCard.
export interface CardIn { mission: string | null; epic: { id: string; title: string; intent?: string } | null; decisions: string[]; questions: string[]; inflight: { id: string; step: string; owner?: string; checkpoint?: string }[]; drive: string; next: string }
export const renderCard = (c: CardIn): string => cap(join(['Resume card', sec('Mission', c.mission ?? 'none'), sec('Epic', c.epic ? `${c.epic.id} ${c.epic.title}${c.epic.intent ? `\n${c.epic.intent}` : ''}` : 'none'),
  sec('Last decisions', c.decisions.slice(-5)), sec('Open questions', c.questions), sec('In flight', c.inflight.map(t => `- ${t.id} ${t.step}${t.owner ? ` owner ${t.owner}` : ''}${t.checkpoint ? ` checkpoint ${t.checkpoint}` : ''}`)), `drive: ${c.drive}`, `next: ${c.next}`]), 3072)
export const queueCard = (h: Host, card: string) => h.secret.update(s => ({ ...s, ctx: { key: s.ctx?.key ?? '', card } }))

// prompt.submit, main only (S35), while a plan exists; only when the view hash changed (7). The card goes first, once, and counts as sent.
export const context: Hook = async (h, e, next) => {
  if (e.agentId) return next(e)
  const [s, sc] = [await h.board.read(), await h.secret.read()], card = sc.ctx?.card, key = viewHash(s)
  let dg: string[] = []; await h.ui.update(u => { dg = (u.digest as string[]) ?? []; return dg.length ? { ...u, digest: undefined } : u })   // what landed by itself since main's last turn (core/spawner), once
  const line = !!s.plan && sc.ctx?.key !== key
  if (!card && !line && !dg.length) return next(e)
  if (card || line) await h.secret.update(x => ({ ...x, ctx: { key } }))
  return next({ ...e, context: [...(e.context ?? []), ...(card ? [modelText('context', card)] : []), ...(dg.length ? [modelText('context', `Landed since your last turn: ${dg.join('; ')}`)] : []), ...(s.plan && (line || card) ? [modelText('context', contextLine(modelView(s), await idleOf(h, s)))] : [])] })
}
// prompt.attachment: native todo/task reminders are noise next to the board line (BT-23, PC-11)
export const attachment: Hook = (h, e, next) => (e.type === 'todo_reminder' || e.type === 'task_reminder' ? { text: null } : next(e))
