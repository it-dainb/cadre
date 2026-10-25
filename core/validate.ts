// Draft + report field validation (DESIGN 3.1, 6.3). Refuses only malformed PRESENT fields, with an example-bearing error;
// completeness (scenarios, changelog decision, contract, package) is checked at approve. Pure: no Host, no store.
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { kindOf } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'
import { matches } from './specview'

export const FIELDS = ['kind', 'amend', 'type', 'scope', 'breaking', 'package', 'scenarios', 'changelog', 'interface', 'lane', 'reason', 'repro', 'mission', 'paths', 'core', 'notes', 'epic', 'size', 'planned', 'critique', 'assumed'] as const
export const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
const SCENARIO = /^S\d+: Given .+ When .+ Then .+$/
const STATUS = ['new', 'changed', 'unchanged']
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const show = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s }
const bad = (path: string, want: string, got: unknown) => `${path}: expected ${want}, got ${show(got)}`

// first malformed present task field (the plan tools, a planner's task metadata), else null. null values clear a field and are fine.
export function validateFields(m: Record<string, unknown>, reg: TypeRegistry): string | null {
  for (const k of Object.keys(m)) if (!(FIELDS as readonly string[]).includes(k)) return `metadata.${k}: unknown field (allowed: ${FIELDS.join(', ')})`
  const f = (k: string) => (m[k] === null ? undefined : m[k])
  if (f('kind') !== undefined && f('kind') !== 'plan' && f('kind') !== 'mission') return bad('metadata.kind', '"plan" or "mission"', m.kind)
  if (f('amend') !== undefined && typeof m.amend !== 'boolean') return bad('metadata.amend', 'true', m.amend)
  if (f('lane') !== undefined && !['ask', 'lite', 'full', 'milestone'].includes(m.lane as string)) return bad('metadata.lane', '"ask", "lite", "full" or "milestone"', m.lane)
  if ((f('lane') !== undefined || f('reason') !== undefined) && m.kind !== 'plan') return 'lane, reason: set them on the plan call'
  if (f('reason') !== undefined && !str(m.reason)) return bad('metadata.reason', 'one line, e.g. "one small fix in src/a.ts"', m.reason)
  if (f('mission') !== undefined && (m.kind !== 'plan' || typeof m.mission !== 'string' || !m.mission.trim() || m.mission.length > 1000)) return bad('metadata.mission', 'on the plan call, one string "Goal: …\\nConstraints: …\\nNon-goals: …"', m.mission)   // ADR 0014: approved with the plan
  if (f('paths') !== undefined && (m.kind !== undefined || !Array.isArray(m.paths) || !m.paths.length || m.paths.length > 20 || m.paths.some((p: unknown) => !str(p) || (p as string).length > 200))) return bad('metadata.paths', 'on a task, the files or folders it will change, e.g. ["src/auth/login.ts", "test/auth/**"]', m.paths)
  if (f('core') !== undefined && (m.kind !== undefined || typeof m.core !== 'boolean')) return bad('metadata.core', 'true on the one task with the code other tasks share', m.core)
  if (f('assumed') !== undefined && (m.kind !== 'plan' || !Array.isArray(m.assumed) || !m.assumed.length || m.assumed.length > 5 || !m.assumed.every(x => str(x) && (x as string).length <= 200))) return bad('metadata.assumed', 'on the plan call, a list of 1-5 lines "<point>: what you assumed"', m.assumed)   // yolo clarify (ADR 0020): shown in the approval dialog
  if (f('notes') !== undefined && (m.kind !== 'plan' || !(str(m.notes) ? m.notes.length <= 1500 : noteList(m.notes) && noteShape(m.notes)))) return bad('metadata.notes', 'on the plan call, what an explorer found, keyed by the paths it concerns: [{"paths":["src/auth/"],"text":"…"}] (no paths = every task; at most 3000 characters in all)', m.notes)
  if (f('epic') !== undefined && (m.kind !== undefined || !str(m.epic))) return bad('metadata.epic', 'on a task, the id of the epic it belongs to, e.g. "m-2"', m.epic)   // milestone lane (ADR 0015)
  if (f('size') !== undefined && (m.kind !== undefined || !Number.isInteger(m.size) || (m.size as number) < 1 || (m.size as number) > 7)) return bad('metadata.size', 'on an epic, how many tasks it needs, 1 to 7', m.size)
  if (f('critique') !== undefined && (m.kind !== undefined || !str(m.critique) || (m.critique as string).length > 1500)) return bad('metadata.critique', 'on the milestone, what the critic found and what you changed (at most 1500 characters)', m.critique)
  if (f('repro') !== undefined && typeof m.repro !== 'boolean') return bad('metadata.repro', 'true or false', m.repro)
  if (f('type') !== undefined && !(str(m.type) && m.type in reg)) return bad('metadata.type', `one of ${Object.keys(reg).join('|')}`, m.type)
  if (f('scope') !== undefined && !str(m.scope)) return bad('metadata.scope', '"auth"', m.scope)
  if (f('breaking') !== undefined && typeof m.breaking !== 'boolean') return bad('metadata.breaking', 'true or false', m.breaking)
  if (f('package') !== undefined && !str(m.package)) return bad('metadata.package', 'a package root, e.g. "." or "packages/api"', m.package)
  const sc = f('scenarios')
  if (sc !== undefined) {
    if (!Array.isArray(sc)) return bad('metadata.scenarios', 'an array of "S1: Given <state> When <action> Then <outcome>"', sc)
    for (const [i, s] of sc.entries()) if (typeof s !== 'string' || !SCENARIO.test(s)) return bad(`metadata.scenarios[${i}]`, `"S${i + 1}: Given <state> When <action> Then <outcome>"`, s)
  }
  const c = f('changelog') as any
  if (c !== undefined) {
    const ok = c && typeof c === 'object' && (c.none === true ? str(c.reason) : CATEGORIES.includes(c.category) && str(c.entry))
    if (!ok) return bad('metadata.changelog', `{"category":"Added","entry":"Login with email"} or {"none":true,"reason":"internal"}; category in ${CATEGORIES.join('|')}`, c)
  }
  const i = f('interface') as any
  if (i !== undefined) {
    if (!i || typeof i !== 'object') return bad('metadata.interface', '{"symbols":[{"name":"login","kind":"function","params":["email: string"],"returns":"Session","status":"new"}]} or {"none":true,"reason":"…"}', i)
    if (i.none === true) { if (!str(i.reason)) return bad('metadata.interface.reason', 'a reason', i.reason) }
    else {
      if (!Array.isArray(i.symbols) || !i.symbols.length) return bad('metadata.interface.symbols', 'a non-empty array', i.symbols)
      for (const [n, s] of i.symbols.entries()) {
        const p = `metadata.interface.symbols[${n}]`
        if (!str(s?.name) || !str(s?.kind) || !str(s?.returns)) return bad(p, '{"name","kind","params","returns","status"}', s)
        if (!Array.isArray(s.params) || s.params.some((x: unknown) => typeof x !== 'string')) return bad(`${p}.params`, 'an array of strings', s.params)
        if (!STATUS.includes(s.status)) return bad(`${p}.status`, 'new|changed|unchanged', s.status)
      }
    }
  }
  return null
}

// What a draft still lacks, from its stored form (acceptance = scenarios, design = contract, meta changelog/package). Spikes need nothing.
export function missingOf(t: Task, reg: TypeRegistry): string[] {
  if (t.type === 'epic') return [...(t.description.trim() ? [] : ['goal']), ...(t.meta['cadre.size'] ? [] : ['size']), ...(t.meta['cadre.core'] === 'true' && Number(t.meta['cadre.size']) > 2 ? ['a core epic has at most 2 tasks'] : [])]   // a roadmap epic (ADR 0015)
  const spec = reg[t.type]; if (!spec || kindOf(spec) === 'spike') return []
  const out: string[] = []
  if (t.meta['cadre.lane']?.startsWith('lite')) return [...(t.description.trim() ? [] : ['description']), ...(t.meta['cadre.changelog'] ? [] : ['changelog'])]   // lite (ADR 0011): title, description, changelog decision
  if (!t.acceptance?.trim()) out.push('scenarios')
  if (!t.meta['cadre.changelog']) out.push('changelog')
  if (spec.contract === 'required' && !t.design) out.push('interface')
  if (!t.meta['cadre.package'] && !pathsOf(t).length) out.push('package')   // its declared paths name its unit (H7)
  return out
}
// every draft's gaps as "id: a, b"; a plan with no tasks lacks "tasks". Empty = approvable. With two or more code tasks each declares its paths, and two tasks
// that would change the same path must be ordered by a blocks dependency (or the shared code moves into one core task): parallel edits of one file conflict (ADR 0014 G)
export function missingList(drafts: Task[], reg: TypeRegistry): string[] {
  if (!drafts.length) return ['tasks']
  const ep = drafts[0].type === 'epic', code = drafts.filter(t => t.type === 'epic' || (reg[t.type] && kindOf(reg[t.type]) !== 'spike')), many = code.length >= 2
  const out = drafts.flatMap(t => { const m = [...missingOf(t, reg), ...(many && code.includes(t) && !pathsOf(t).length ? ['paths'] : [])]; return m.length ? [`${t.id}: ${m.join(', ')}`] : [] })
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
// review coverage (ADR 0022): the scenario ids (S1, S2…) of the acceptance that no locked spec test name carries ("test_s3_login" carries S3, "S30" does not)
export const scenarioIds = (acceptance?: string): string[] => (acceptance ?? '').split('\n').map(l => /^S\d+/.exec(l.trim())?.[0]).filter(Boolean) as string[]
// names null: the task has no locked spec tests (no tester step), nothing to check
export const specTestsOf = (t: Pick<Task, 'meta'>): string[] | null => { try { const v = JSON.parse(t.meta['cadre.specTests'] ?? 'null'); return Array.isArray(v) ? v.map(String) : null } catch { return null } }
export const untested = (acceptance: string | undefined, names: string[] | null): string[] => !names ? [] : scenarioIds(acceptance).filter(id => !names.some(n => new RegExp(`(?<![A-Za-z0-9])${id}(?![0-9])`, 'i').test(n)))
// what blocks a pass: untested scenarios, and coverage entries the reviewer did not mark ok:true (missing or weak). Off: nothing.
export function coverageGaps(enforce: boolean, acceptance: string | undefined, names: string[] | null, coverage: unknown): string[] {
  if (!enforce) return []
  const key = (s: unknown) => /^S\d+/.exec(String(s))?.[0] ?? String(s), cov = Array.isArray(coverage) ? coverage : []
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
// the tester's test command (ADR 0023): an argv run without a shell, inside the offline sandbox like any check. Only a test runner: a shell or a file/git/network
// tool as argv[0] is refused (the jail discards writes and has no network, but with jail off it runs on the host; the tests themselves are code the checks run anyway)
const NOT_RUNNER = /^(sh|bash|zsh|dash|ksh|fish|env|sudo|su|doas|rm|mv|cp|dd|ln|chmod|chown|git|curl|wget|ssh|scp|nc|kill|xargs)$/
export function runShape(run: any): string | null {
  const eg = 'e.g. {"command":["node","--test","test/login.test.js"]}'
  if (!run || typeof run !== 'object' || !Array.isArray(run.command) || !run.command.length || run.command.length > 64 || !run.command.every((a: unknown) => typeof a === 'string' && a && a.length < 1000)) return `run.command: expected the argument list that runs only your tests, no shell, ${eg}`
  if (NOT_RUNNER.test(String(run.command[0]).split('/').pop()!)) return `run.command: "${run.command[0]}" is not a test runner; give the runner itself, ${eg}`
  if (run.cwd !== undefined && (typeof run.cwd !== 'string' || run.cwd.startsWith('/') || run.cwd.split('/').includes('..'))) return 'run.cwd: expected a folder relative to your test folder, e.g. "web"'
  if (run.junit !== undefined && typeof run.junit !== 'string') return 'run.junit: expected "$CADRE_JUNIT" (the path your runner writes its JUnit XML report to)'
  return null
}
// Per-role/outcome report contracts (strict, checkInput): an unknown field, a wrong type or an over-cap value is refused before anything is stored; caps reject, never truncate
const RS = (n: number) => ({ type: 'string', maxLength: n }), RA = (n: number, items: Sch = { type: 'object' }) => ({ type: 'array', maxItems: n, items })
const REQ = { type: 'object', required: ['helper', 'ask', 'why'], properties: { helper: RS(40), ask: RS(2000), why: RS(500), paths: RA(20, RS(200)), argv: RA(64, RS(500)) } }   // an outcome "request": the helper to ask, what, and why (setup: argv, the install command)
const V1 = { schemaVersion: {}, role: {} }
export const REPORTS: Record<string, Sch> = {
  worker: { type: 'object', required: ['outcome', 'summary'], properties: { ...V1, outcome: { type: 'string', enum: ['done', 'blocked', 'spec_change', 'request'] }, summary: RS(800), reason: RS(400), request: REQ, risks: RA(5, RS(120)), questions: RA(5, RS(120)), followups: RA(5) } },
  tester: { type: 'object', required: ['outcome', 'summary'], properties: { ...V1, outcome: { type: 'string', enum: ['done', 'request'] }, summary: RS(800), tests: RA(50), run: { type: 'object' }, request: REQ } },
  reviewer: { type: 'object', required: ['verdict', 'summary', 'findings', 'coverage', 'contractStatus'], properties: { ...V1, verdict: { type: 'string', enum: ['pass', 'changes'] }, summary: RS(1500), findings: RA(50), coverage: RA(50), contractStatus: RA(100) } },
  explorer: { type: 'object', required: ['answer'], properties: { ...V1, answer: RS(2000), citations: RA(30) } },
  planner: { type: 'object', properties: { ...V1, outcome: { type: 'string', enum: ['request'] }, summary: RS(1500), tasks: RA(20), request: REQ } },
}
const WHY: Record<string, string> = { blocked: 'reason', spec_change: 'reason' }   // the field an outcome cannot go without
export function validateReport(r: any): string | null {
  if (!r || typeof r !== 'object') return bad('report', '{"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"}', r)
  if (r.schemaVersion !== 1) return bad('schemaVersion', '1', r.schemaVersion)
  if (!(r.role in REPORTS)) return bad('role', 'worker|tester|reviewer|explorer|planner', r.role)
  const e = checkInput(REPORTS[r.role], r); if (e) return e.replace('call again', 'report again')
  const k = WHY[r.outcome]; if (k && !str(r[k])) return `${k}: required with outcome ${r.outcome}; say what is in the way, then report again`
  if (r.request && r.outcome !== 'request') return 'request: only with outcome request; drop it or change the outcome, then report again'
  if (r.outcome === 'request' && !r.request) return 'request: required with outcome request, e.g. {"helper":"explore","ask":"where is X handled?","why":"I must change it"}; add it and report again'
  if (r.role === 'tester' && r.outcome !== 'request' && r.tests === undefined) return 'tests: required; add it and report again'
  if (r.role === 'planner' && r.outcome !== 'request' && r.tasks === undefined) return 'tasks: required; add it and report again'
  if (r.role === 'explorer' && !str(r.answer)) return 'answer: required for role explorer'
  if (r.role === 'tester' && r.run !== undefined) { const x = runShape(r.run); if (x) return x }
  return null
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
    for (const k of Object.keys(o)) if (!(k in s.properties)) return `${dot}${k}: unknown field (allowed: ${Object.keys(s.properties).join(', ')}); remove it and call again`
    for (const k of s.required ?? []) if (o[k] === undefined) return `${dot}${k}: required; add it and call again`
    for (const [k, p] of Object.entries(s.properties)) if (o[k] !== undefined) { const e = checkInput(p, o[k], `${dot}${k}`); if (e) return e }
  }
  return null
}
// a plan's open questions (main's ask tool): each blocks its approval until main records the user's answer
export interface Question { id: string; q: string; answer?: string }
export const questionsOf = (t?: Pick<Task, 'meta'>): Question[] => { try { const v = JSON.parse(t?.meta['cadre.questions'] || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export const openQuestions = (t?: Pick<Task, 'meta'>): string[] => questionsOf(t).filter(q => q.answer === undefined).map(q => `open question ${q.id} (ask the user, then answer it with ask)`)
