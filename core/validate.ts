// Draft + report field validation (DESIGN 3.1, 6.3). Refuses only malformed PRESENT fields, with an example-bearing error;
// completeness (scenarios, changelog decision, contract, package) is checked at approve. Pure: no Host, no store.
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { active, kindOf, typeOf } from './pipeline'
import { matches } from './specview'
import { roleSpec, roleSpecs } from './roles'
import { RISKS, type Tier } from './routing'
import type { Field, FieldKind, Outcome, RoleSpec as ProfileRole } from '../types/profile'

// the planner call's own arguments; the task fields the profile declares (`profile.fields`) come on top
export const ARGS = ['kind', 'amend', 'type', 'acceptance', 'contract', 'lane', 'reason', 'risk', 'mission', 'paths', 'core', 'notes', 'epic', 'size', 'planned', 'critique', 'assumed'] as const   // lane picks the pipeline and risk the model: engine concepts, whatever the profile's fields
// the task fields the profile declares, and the three the engine reads whatever the profile says (the unit a task builds in, the commit message)
const CORE: Field[] = [{ name: 'package', store: 'meta', required: false }, { name: 'scope', store: 'meta', required: false }, { name: 'breaking', store: 'meta', required: false, kind: 'bool' }]
const declared = (): Field[] => [...CORE.filter(c => !active().fields.some(f => f.name === c.name)), ...active().fields]
export const FIELDS = (): string[] => [...new Set([...ARGS, ...declared().map(f => f.name)])]
export const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
// a refusal quotes what the agent sent only without a host path in it (a path is the agent's own text; the boundary lint refuses it)
// only an ABSOLUTE path: at the start or after a space, quote, = ( [ ("src/a/b.ts" and "http://x.io/a/b" stay as they are)
const noPath = (x: string) => x.replace(/(^|[\s"'=(\[])(?:file:\/\/)?\/(?:[\w.~@+-]+\/)+[\w.~@+-]*/g, '$1(a path)')
const show = (v: unknown) => { const s = noPath(JSON.stringify(v) ?? String(v)); return s.length > 60 ? `${s.slice(0, 57)}...` : s }
const bad = (path: string, want: string, got: unknown) => `${path}: expected ${want}, got ${show(got)}`

// first malformed present task field (the plan tools, a planner's task metadata), else null. null values clear a field and are fine.
export function validateFields(m: Record<string, unknown>): string | null {
  for (const k of Object.keys(m)) if (!FIELDS().includes(k)) return `metadata.${k}: unknown field (allowed: ${FIELDS().join(', ')})`
  const f = (k: string) => (m[k] === null ? undefined : m[k])
  if (f('kind') !== undefined && f('kind') !== 'plan' && f('kind') !== 'mission') return bad('metadata.kind', '"plan" or "mission"', m.kind)
  if (f('amend') !== undefined && typeof m.amend !== 'boolean') return bad('metadata.amend', 'true', m.amend)
  if (f('lane') !== undefined && !['ask', 'lite', 'full', 'milestone'].includes(m.lane as string)) return bad('metadata.lane', '"ask", "lite", "full" or "milestone"', m.lane)
  if ((f('lane') !== undefined || f('reason') !== undefined) && m.kind !== 'plan') return 'lane, reason: set them on the plan call'
  if (f('reason') !== undefined && !str(m.reason)) return bad('metadata.reason', 'one line, e.g. "one small fix in src/a.ts"', m.reason)
  if (f('mission') !== undefined && (m.kind !== 'plan' || typeof m.mission !== 'string' || !m.mission.trim() || m.mission.length > 1000)) return bad('metadata.mission', 'on the plan call, one string "Goal: …\\nConstraints: …\\nNon-goals: …"', m.mission)   // ADR 0014: approved with the plan
  if (f('paths') !== undefined && (m.kind !== undefined || !Array.isArray(m.paths) || !m.paths.length || m.paths.length > 20 || m.paths.some((p: unknown) => !str(p) || (p as string).length > 200))) return bad('metadata.paths', 'on a task, the files or folders it will change, e.g. ["src/auth/login.ts", "test/auth/**"]', m.paths)
  if (f('risk') !== undefined && (m.kind !== undefined || !RISKS.includes(m.risk as Tier))) return bad('metadata.risk', `on a task, how closely it is reviewed: ${RISKS.join('|')}`, m.risk)   // B9: the planner's call, never scored from the diff
  if (f('core') !== undefined && (m.kind !== undefined || typeof m.core !== 'boolean')) return bad('metadata.core', 'true on the one task with the code other tasks share', m.core)
  if (f('assumed') !== undefined && (m.kind !== 'plan' || !Array.isArray(m.assumed) || !m.assumed.length || m.assumed.length > 5 || !m.assumed.every(x => str(x) && (x as string).length <= 200))) return bad('metadata.assumed', 'on the plan call, a list of 1-5 lines "<point>: what you assumed"', m.assumed)   // yolo clarify (ADR 0020): shown in the approval dialog
  if (f('notes') !== undefined && (m.kind !== 'plan' || !(str(m.notes) ? m.notes.length <= 1500 : noteList(m.notes) && noteShape(m.notes)))) return bad('metadata.notes', 'on the plan call, what an explorer found, keyed by the paths it concerns: [{"paths":["src/auth/"],"text":"…"}] (no paths = every task; at most 3000 characters in all)', m.notes)
  if (f('epic') !== undefined && (m.kind !== undefined || !str(m.epic))) return bad('metadata.epic', 'on a task, the id of the epic it belongs to, e.g. "m-2"', m.epic)   // milestone lane (ADR 0015)
  if (f('size') !== undefined && (m.kind !== undefined || !Number.isInteger(m.size) || (m.size as number) < 1 || (m.size as number) > 7)) return bad('metadata.size', 'on an epic, how many tasks it needs, 1 to 7', m.size)
  if (f('critique') !== undefined && (m.kind !== undefined || !str(m.critique) || (m.critique as string).length > 1500)) return bad('metadata.critique', 'on the milestone, what the critic found and what you changed (at most 1500 characters)', m.critique)
  if (f('type') !== undefined && !(str(m.type) && typeOf(m.type))) return bad('metadata.type', `one of ${Object.keys(active().types).join('|')}`, m.type)
  for (const fd of declared()) {   // the profile's task fields, each by its kind (a value of null clears it and is fine)
    const v = f(fd.name); if (v === undefined || fd.name === 'changelog' || (ARGS as readonly string[]).includes(fd.name)) continue
    const k = fd.kind ?? 'text', ok = k === 'text' ? str(v) : k === 'bool' ? typeof v === 'boolean' : k === 'ids' ? Array.isArray(v) && v.length <= 10 && v.every(x => str(x) && x.length <= 16) : typeof k === 'object' && k.enum.includes(v as string)
    if (!ok || (k === 'ids' && m.kind !== undefined)) return bad(`metadata.${fd.name}`, fd.want ?? (k === 'text' ? 'a non-empty string' : k === 'bool' ? 'true or false' : k === 'ids' ? 'on a task, a list of ids of acceptance items, e.g. ["A2"]' : `one of ${(k as { enum: string[] }).enum.join('|')}`), v)
  }
  const sc = f('acceptance')
  if (sc !== undefined) {
    const eg = '[{"id":"A1","text":"…"}]'
    if (!Array.isArray(sc) || !sc.length) return bad('metadata.acceptance', `a non-empty array ${eg}`, sc)
    for (const [i, a] of sc.entries()) if (!str(a?.id) || a.id.length > 16 || /* ids carry no ':' or line break */ [':', '\n', ' '].some(c => a.id.includes(c)) || !str(a.text) || a.text.includes('\n') || sc.findIndex((x: any) => x?.id === a.id) !== i) return bad(`metadata.acceptance[${i}]`, `{"id":"A1","text":"one line"}, ids unique, with no space or ":"`, a)
  }
  const c = f('changelog') as any
  if (c !== undefined) {
    const ok = c && typeof c === 'object' && (c.none === true ? str(c.reason) : CATEGORIES.includes(c.category) && str(c.entry))
    if (!ok) return bad('metadata.changelog', `{"category":"Added","entry":"Login with email"} or {"none":true,"reason":"internal"}; category in ${CATEGORIES.join('|')}`, c)
  }
  const i = f('contract') as any
  if (i !== undefined) {
    const eg = '{"items":[{"name":"login","returns":"Session"}]} or {"none":true,"reason":"…"}'
    if (!i || typeof i !== 'object') return bad('metadata.contract', eg, i)
    if (i.none === true) { if (!str(i.reason)) return bad('metadata.contract.reason', 'a reason', i.reason) }
    else {
      if (!Array.isArray(i.items) || !i.items.length) return bad('metadata.contract.items', 'a non-empty array', i.items)
      for (const [n, x] of i.items.entries()) if (!str(x?.name) || Object.values(x).some(v => !(typeof v === 'string' || (Array.isArray(v) && v.every(y => typeof y === 'string'))))) return bad(`metadata.contract.items[${n}]`, '{"name":"login", …any other keys: text or a list of text}', x)
    }
  }
  return null
}

// the task fields the profile requires of this task's type (`required`: true = every type, or a list of types) that it has no value for
export const lacks = (t: Pick<Task, 'type' | 'meta'>): string[] => active().fields.filter(f => f.store === 'meta' && (f.required === true || (Array.isArray(f.required) && f.required.includes(t.type))) && !t.meta[`cadre.${f.name}`]).map(f => f.name)
// What a draft still lacks, from its stored form (acceptance = scenarios, design = contract, meta changelog/package). Spikes need nothing.
export function missingOf(t: Task): string[] {
  if (t.type === 'epic') return [...(t.description.trim() ? [] : ['goal']), ...(t.meta['cadre.size'] ? [] : ['size']), ...(t.meta['cadre.core'] === 'true' && Number(t.meta['cadre.size']) > 2 ? ['a core epic has at most 2 tasks'] : [])]   // a roadmap epic (ADR 0015)
  const spec = typeOf(t.type); if (!spec || kindOf(t.type) === 'spike') return []
  const out: string[] = []
  if (t.meta['cadre.lane'] === 'lite') return [...(t.description.trim() ? [] : ['description']), ...lacks(t)]   // lite (ADR 0011): title, description and the fields the profile requires
  if (!t.acceptance?.trim()) out.push('acceptance')
  out.push(...lacks(t))
  if (spec.contract === 'required' && !t.design) out.push('contract')
  if (!t.meta['cadre.package'] && !pathsOf(t).length) out.push('package')   // its declared paths name its unit (H7)
  return out
}
// every draft's gaps as "id: a, b"; a plan with no tasks lacks "tasks". Empty = approvable. With two or more code tasks each declares its paths, and two tasks
// that would change the same path must be ordered by a blocks dependency (or the shared code moves into one core task): parallel edits of one file conflict (ADR 0014 G)
export function missingList(drafts: Task[]): string[] {
  if (!drafts.length) return ['tasks']
  const ep = drafts[0].type === 'epic', code = drafts.filter(t => t.type === 'epic' || (typeOf(t.type) && kindOf(t.type) !== 'spike')), many = code.length >= 2
  const out = drafts.flatMap(t => { const m = [...missingOf(t), ...(many && code.includes(t) && !pathsOf(t).length ? ['paths'] : [])]; return m.length ? [`${t.id}: ${m.join(', ')}`] : [] })
  const after = (a: Task, b: Task, seen = new Set<string>()): boolean => a.deps.some(d => ['blocks', 'waits-for'].includes(d.type) && !seen.has(d.id) && (seen.add(d.id), d.id === b.id || (drafts.some(x => x.id === d.id) && after(drafts.find(x => x.id === d.id)!, b, seen))))
  for (let i = 0; i < code.length; i++) for (const b of code.slice(i + 1)) {
    const a = code[i], p = pathsOf(a).find(x => pathsOf(b).some(y => overlap(x, y)))
    if (p && !after(a, b) && !after(b, a)) out.push(`${a.id}+${b.id} both change ${p}: ${ep ? 'move it into the core epic or add a dependency' : 'move it into one core task or add a blocks dependency'}`)
  }
  return ep && drafts.length < 2 ? [...out, 'epics: a milestone has 2 or more (else change the lane to one plan)'] : out
}
// declared paths (metadata.paths -> cadre.paths) and their overlap: equal, a folder of the other, or a glob that matches it
// metadata.notes (ADR 0022): [{paths?, text}]; the old plain string is one note for every task
export interface Note { paths?: string[]; text: string }
const noteList = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every(n => n && str(n.text) && (n.paths === undefined || (Array.isArray(n.paths) && n.paths.length > 0 && n.paths.every(str)))) && v.reduce((k, n) => k + n.text.length, 0) <= 3000
const noteShape = (v: any[]): boolean => v.length <= 20 && v.every(n => Object.keys(n).every(k => k === 'paths' || k === 'text') && (n.paths === undefined || (n.paths.length <= 20 && n.paths.every((p: string) => p.length <= 200))))   // main's input only: no other keys, capped
export const notesOf = (raw?: string): Note[] => { if (!raw?.trim()) return []; try { const v = JSON.parse(raw); if (noteList(v)) return v } catch { /* plain text */ } return [{ text: raw.trim() }] }
// shared: notes without paths (the plan block, same for every task); slice: the notes whose paths overlap the task's (its task block), all path notes for a task
// that declares none. notes.slice off: every note is shared.
export function sliceNotes(notes: Note[], paths: string[], slice: boolean): { shared: string; slice: string } {
  const txt = (ns: Note[]) => ns.map(n => n.text.trim()).join('\n'), pathed = (n: Note) => slice && !!n.paths?.length
  return { shared: txt(notes.filter(n => !pathed(n))), slice: txt(notes.filter(n => pathed(n) && (!paths.length || n.paths!.some(p => paths.some(q => overlap(p, q)))))) }
}
// the one-line scenario a worker's spec_change proposes: checked when it reports, and again before cadre writes it into the spec
// [id, text] of one line "<id>: <text>" (an acceptance item), else null: the id is non-empty and has no space, the text is not empty
export const specScenario = (s: string): [string, string] | null => { const i = s.indexOf(':'), id = s.slice(0, i).trim(), t = s.slice(i + 1).trim(); return i > 0 && !s.includes('\n') && id && !id.includes(' ') && t ? [id, t] : null }
// the id of one stored acceptance line "<id>: <text>" (ids carry no ':')
export const idOf = (l: string): string => l.slice(0, l.includes(':') ? l.indexOf(':') : undefined).trim()
// the contract's items (`{items:[{name, ...}]}`; `{none}` and a missing one have none)
export const itemsOf = (design?: string): { name: string; [k: string]: unknown }[] => { try { return JSON.parse(design || '{}').items ?? [] } catch { return [] } }
// `holds`: scenario ids whose behaviour already exists (the planner's call, kept in meta cadre.holds). Each must be a scenario of the task
export const holdsOf = (t?: Pick<Task, 'meta'>): string[] => { try { const v = JSON.parse(t?.meta['cadre.holds'] || '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }
export const holdsGap = (holds: unknown, acceptance?: string): string | null => {
  const ids = Array.isArray(holds) ? holds.map(String) : [], have = new Set(scenarioIds(acceptance)), bad = ids.filter(x => !have.has(x))
  return bad.length ? `metadata.holds: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not ${bad.length === 1 ? 'a scenario' : 'scenarios'} of this task (its scenarios: ${[...have].join(', ') || 'none yet'}); fix holds or the scenarios` : null
}
export const scenarioIds = (acceptance?: string): string[] => (acceptance ?? '').split('\n').filter(l => l.includes(':')).map(idOf)
// the tester's declared tests {name, ids}: null = the task has no locked spec tests (no tester step), nothing to check
export const specTestsOf = (t: Pick<Task, 'meta'>): { name: string; ids: string[] }[] | null => { try { const v = JSON.parse(t.meta['cadre.specTests'] ?? 'null'); return Array.isArray(v) ? v.map(x => ({ name: String(x.name), ids: Array.isArray(x.ids) ? x.ids.map(String) : [] })) : null } catch { return null } }
// the scenario ids of the acceptance that no declared test lists in its ids
export const untested = (acceptance: string | undefined, dec: { ids: string[] }[] | null): string[] => !dec ? [] : scenarioIds(acceptance).filter(id => !dec.some(t => t.ids.includes(id)))
// a reviewer's coverage entry names its item as the id, or "<id>: …" (the id of the acceptance it covers), else as it wrote it
export const coverKey = (acceptance?: string) => { const ids = scenarioIds(acceptance); return (s: unknown): string => { const v = String(s).trim(); return ids.find(i => v === i || v.startsWith(`${i}:`) || v.startsWith(`${i} `)) ?? v } }
// what blocks a pass: untested scenarios, and coverage entries the reviewer did not mark ok:true (missing or weak). Off: nothing.
export function coverageGaps(enforce: boolean, acceptance: string | undefined, names: { ids: string[] }[] | null, coverage: unknown): string[] {
  if (!enforce) return []
  const key = coverKey(acceptance), cov = Array.isArray(coverage) ? coverage : []
  const weak = cov.filter((c: any) => c?.ok !== true).map((c: any) => `scenario ${key(c?.scenario)} is not covered by a test that checks it`)
  return [...untested(acceptance, names).map(id => `scenario ${id} has no test`), ...weak]
}
export const pathsOf = (t?: Pick<Task, 'meta'>): string[] => { try { return JSON.parse(t?.meta['cadre.paths'] || '[]') } catch { return [] } }
const dir = (p: string) => p.replace(/\/\*\*?$/, '').replace(/\/$/, '')
export const overlap = (a: string, b: string): boolean => dir(a) === dir(b) || b.startsWith(`${dir(a)}/`) || a.startsWith(`${dir(b)}/`) || matches([a], b) || matches([b], a)
// the byte-stable context line, ≤200 chars
export const missingLine = (list: string[]): string => (list.length ? `missing: ${list.join('; ')}`.slice(0, 200) : '')

// retries ≤3 per draft (DESIGN 3.1, 7): the counter lives in the local `ui` atom. Returns the text to refuse with.
export const RETRIES = 3
export async function refuse(h: Host, key: string, err: string): Promise<string> {
  let n = 0
  await h.ui.update(u => { const r = { ...((u.retries as Record<string, number>) ?? {}) }; n = r[key] = (r[key] ?? 0) + 1; return { ...u, retries: r } })
  return tried(err, n, key)
}
export const tried = (err: string, n: number, key: string) => (n > RETRIES ? `${err} (retry cap ${RETRIES} reached for ${key}: ask the human, or start a new draft)` : `${err} (attempt ${n}/${RETRIES})`)
export const clearRetries = (h: Host, key: string) => h.ui.update(u => { const { [key]: _x, ...r } = (u.retries as Record<string, number>) ?? {}; return { ...u, retries: r } })
export async function capped(h: Host, key: string): Promise<boolean> { return (((await h.ui.read()).retries as Record<string, number>) ?? {})[key] >= RETRIES + 1 }

// Report envelope (DESIGN 6.2): entry point for wave 3 (`tools/index`); semantic checks (6.3: files exist at sourceCommit...) are theirs to add.
// Returns an example-bearing error or null.
// the tester's test command (ADR 0023): an argv run without a shell, inside the offline sandbox like any check (task data run through the test slot, never host code)
export function runShape(run: any): string | null {
  const eg = 'e.g. {"command":["node","--test","--test-reporter=junit","--test-reporter-destination=$CADRE_JUNIT","test/login.test.js"]}'
  if (!run || typeof run !== 'object' || !Array.isArray(run.command) || !run.command.length || run.command.length > 64 || !run.command.every((a: unknown) => typeof a === 'string' && a && a.length < 1000)) return `run.command: expected the argument list that runs only your tests, no shell, ${eg}`
  if (Object.keys(run).some(k => k !== 'command' && k !== 'cwd')) return `run: only command and cwd (${eg}); the check that runs it is not yours to pick`   // argv only, never a check slot
  if (run.cwd !== undefined && (typeof run.cwd !== 'string' || run.cwd.startsWith('/') || run.cwd.split('/').includes('..'))) return 'run.cwd: expected a folder relative to your test folder, e.g. "web"'
  return null
}
// Per-role report contracts (strict, checkInput): an unknown field, a wrong type or an over-cap value is refused before anything is stored; caps reject, never truncate.
// A work role's contract is its RoleSpec.report (profile data, core/roles.roleSpec); planner and specifier are core planning roles with a fixed form.
const RS = (n: number) => ({ type: 'string', maxLength: n }), RA = (n: number, items: Sch = { type: 'object' }) => ({ type: 'array', maxItems: n, items })
const V1 = { schemaVersion: {}, role: {} }
export const DEVIATIONS = ['none', 'wrong_path', 'scenario_conflict', 'missing_dep']   // a specifier's one way to say the approved task is wrong (it never edits a scenario)
const kindSch = (k: FieldKind): Sch => k === 'text' ? { type: 'string' } : k === 'list' ? { type: 'array' } : k === 'bool' ? { type: 'boolean' } : k === 'object' || k === 'command' ? { type: 'object' }
  : 'enum' in k ? { type: 'string', enum: k.enum } : 'text' in k ? RS(k.text) : 'list' in k ? RA(k.list, k.of && kindSch(k.of)) : { type: 'object', required: k.required, properties: fieldsSch(k.object) }
const fieldsSch = (f: Record<string, FieldKind>) => Object.fromEntries(Object.entries(f).map(([n, k]) => [n, kindSch(k)]))
// the carrier of the outcome: `verdict` for a role that judges, else `outcome`; a role with no outcomes (the explorer) has none
const outKey = (s: ProfileRole) => (s.verdict ? 'verdict' : 'outcome')
export const reportSch = (s: ProfileRole): Sch => ({ type: 'object', required: [...(s.report.outcomes.length ? [outKey(s)] : []), ...s.report.required],
  properties: { ...V1, ...(s.report.outcomes.length ? { [outKey(s)]: { type: 'string', enum: s.verdict ? [s.verdict.pass, s.verdict.fail] : s.report.outcomes } } : {}), ...fieldsSch(s.report.fields) } })
const PLANNING: Record<string, Sch> = {
  planner: { type: 'object', properties: { ...V1, summary: RS(1500), tasks: RA(20) } },
  specifier: { type: 'object', required: ['notes', 'deviation'], properties: { ...V1, notes: RS(1500), deviation: { type: 'string', enum: DEVIATIONS } } },
}
export const REPORTS = (): Record<string, Sch> => ({ ...Object.fromEntries(Object.entries(roleSpecs()).map(([n, s]) => [n, reportSch(s)])), ...PLANNING })
// every refusal carries a declared code (never read from its text): `shape` = the report's own form (an over-cap value, an unknown field, a wrong type, a missing envelope field);
// `semantic` = the rest. A shape refusal is counted on the task (Budget.shapeRefusals), not on the run's tries.
export type Code = 'shape' | 'semantic'
export interface Coded { msg: string; code: Code }
export class Refusal extends Error { constructor(msg: string, readonly code: Code) { super(msg) } }
const shape = (msg: string): Coded => ({ msg, code: 'shape' }), sem = (msg: string): Coded => ({ msg, code: 'semantic' })
// one role's report against its spec: the form (reportSch), then the fields its outcome cannot go without, then a test command's shape
export function validateReport(role: string, r: any): Coded | null {
  const s = roleSpec(role), e = checkInput(s ? reportSch(s) : PLANNING[role], r)
  if (e) return shape(e.replace('call again', 'report again'))
  if (!s) return role === 'planner' && r.tasks === undefined ? sem('tasks: required; add it and report again') : null
  for (const k of [...s.report.required, ...(s.report.requiredWith?.[r[outKey(s)] as Outcome] ?? [])]) if (r[k] === undefined || (s.report.ask?.[k] && !str(r[k]))) return sem(`${k}: ${(s.report.ask?.[k] ?? 'required; add it and report again').replace('{outcome}', r[outKey(s)])}`)
  for (const [k, v] of Object.entries(s.report.fields)) if (v === 'command' && r[k] !== undefined) { const x = runShape(r[k]); if (x) return shape(x) }
  return null
}
// the envelope (role, schemaVersion), then the role's own contract
export function reportRefusal(r: any): Coded | null {
  if (!r || typeof r !== 'object') return shape(bad('report', '{"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"}', r))
  if (r.schemaVersion !== 1) return shape(bad('schemaVersion', '1', r.schemaVersion))
  const names = Object.keys(REPORTS()); if (!names.includes(r.role)) return shape(bad('role', names.join('|'), r.role))
  return validateReport(r.role, r)
}

// Main's tool input (tools/index MAIN): the strict schema checked in code before anything is stored. Unknown fields, wrong types and caps are refused, naming
// the field and how to retry; nothing is truncated. The schema subset: type object|string|integer|number|boolean|array, enum, required, maxLength, maxItems, items.
type Sch = { type?: string; enum?: readonly unknown[]; required?: readonly string[]; properties?: Record<string, Sch>; maxLength?: number; maxItems?: number; minimum?: number; items?: Sch }
const isType = (t: string | undefined, v: unknown) => !t || (t === 'array' ? Array.isArray(v) : t === 'integer' ? Number.isInteger(v) : t === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === t)
export function checkInput(s: Sch, v: unknown, path = ''): string | null {
  const at = path || 'input', again = 'fix it and call again'
  if (!isType(s.type, v)) return `${at}: expected ${s.type === 'integer' ? 'a whole number' : `a${/^[aeio]/.test(s.type!) ? 'n' : ''} ${s.type}`}, got ${show(v)}; ${again}`
  if (s.enum && !s.enum.includes(v)) return `${at}: expected one of ${s.enum.map(x => JSON.stringify(x)).join(', ')}, got ${show(v)}; ${again}`
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) return `${at}: at least ${s.minimum}, got ${v}; ${again}`
  if (typeof v === 'string' && s.maxLength && v.length > s.maxLength) return `${at}: at most ${s.maxLength} characters, got ${v.length}; shorten it and call again`
  if (Array.isArray(v)) {
    if (s.maxItems && v.length > s.maxItems) return `${at}: at most ${s.maxItems} items, got ${v.length}; split the work and call again`
    for (const [i, x] of v.entries()) { const e = s.items && checkInput(s.items, x, `${at}[${i}]`); if (e) return e }
  }
  if (s.type === 'object' && s.properties) {
    const o = v as Record<string, unknown>, dot = path ? `${path}.` : ''
    for (const k of Object.keys(o)) if (!(k in s.properties)) return `${dot}${noPath(k).slice(0, 40)}: unknown field (allowed: ${Object.keys(s.properties).join(', ')}); remove it and call again`
    for (const k of s.required ?? []) if (o[k] === undefined) return `${dot}${k}: required; add it and call again`
    for (const [k, p] of Object.entries(s.properties)) if (o[k] !== undefined) { const e = checkInput(p, o[k], `${dot}${k}`); if (e) return e }
  }
  return null
}
// a plan's open questions (main's ask tool): each blocks its approval until main records the user's answer
export interface Question { id: string; q: string; answer?: string }
export const questionsOf = (t?: Pick<Task, 'meta'>): Question[] => { try { const v = JSON.parse(t?.meta['cadre.questions'] || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export const openQuestions = (t?: Pick<Task, 'meta'>): string[] => questionsOf(t).filter(q => q.answer === undefined).map(q => `open question ${q.id} (ask the user, then answer it with ask)`)
