// Draft + report field validation (DESIGN 3.1, 6.3). Refuses only malformed PRESENT fields, with an example-bearing error;
// completeness (scenarios, changelog decision, contract, package) is checked at approve. Pure: no Host, no store.
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { kindOf } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'
import { matches } from './specview'

export const FIELDS = ['kind', 'amend', 'type', 'scope', 'breaking', 'package', 'scenarios', 'changelog', 'interface', 'lane', 'reason', 'repro', 'mission', 'paths', 'core', 'notes', 'epic', 'size', 'planned', 'critique'] as const
export const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
const SCENARIO = /^S\d+: Given .+ When .+ Then .+$/
const STATUS = ['new', 'changed', 'unchanged']
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const show = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s }
const bad = (path: string, want: string, got: unknown) => `${path}: expected ${want}, got ${show(got)}`

// first malformed present field of a TaskCreate/TaskUpdate `metadata`, else null. null values clear a field and are fine.
export function validateFields(m: Record<string, unknown>, reg: TypeRegistry): string | null {
  for (const k of Object.keys(m)) if (!(FIELDS as readonly string[]).includes(k)) return `metadata.${k}: unknown field (allowed: ${FIELDS.join(', ')})`
  const f = (k: string) => (m[k] === null ? undefined : m[k])
  if (f('kind') !== undefined && f('kind') !== 'plan' && f('kind') !== 'mission') return bad('metadata.kind', '"plan" or "mission"', m.kind)
  if (f('amend') !== undefined && typeof m.amend !== 'boolean') return bad('metadata.amend', 'true', m.amend)
  if (f('lane') !== undefined && !['ask', 'lite', 'full', 'milestone'].includes(m.lane as string)) return bad('metadata.lane', '"ask", "lite", "full" or "milestone"', m.lane)
  if ((f('lane') !== undefined || f('reason') !== undefined) && m.kind !== 'plan') return 'metadata.lane, metadata.reason: set them on the plan\'s TaskCreate, with "kind":"plan"'
  if (f('reason') !== undefined && !str(m.reason)) return bad('metadata.reason', 'one line, e.g. "one small fix in src/a.ts"', m.reason)
  if (f('mission') !== undefined && (m.kind !== 'plan' || typeof m.mission !== 'string' || !m.mission.trim() || m.mission.length > 1000)) return bad('metadata.mission', 'on the plan\'s TaskCreate, one string "Goal: …\\nConstraints: …\\nNon-goals: …"', m.mission)   // ADR 0014: approved with the plan
  if (f('paths') !== undefined && (m.kind !== undefined || !Array.isArray(m.paths) || !m.paths.length || m.paths.length > 20 || m.paths.some((p: unknown) => !str(p) || (p as string).length > 200))) return bad('metadata.paths', 'on a task, the files or folders it will change, e.g. ["src/auth/login.ts", "test/auth/**"]', m.paths)
  if (f('core') !== undefined && (m.kind !== undefined || typeof m.core !== 'boolean')) return bad('metadata.core', 'true on the one task with the code other tasks share', m.core)
  if (f('notes') !== undefined && (m.kind !== 'plan' || !str(m.notes) || (m.notes as string).length > 1500)) return bad('metadata.notes', 'on the plan\'s TaskCreate, what an explorer found that several tasks need (at most 1500 characters)', m.notes)
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
  if (!t.meta['cadre.package']) out.push('package')
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
  return n > RETRIES ? `${err} (retry cap ${RETRIES} reached for ${key}: ask the human, or start a new draft)` : `${err} (attempt ${n}/${RETRIES})`
}
export const clearRetries = (h: Host, key: string) => h.ui.update(u => { const { [key]: _x, ...r } = (u.retries as Record<string, number>) ?? {}; return { ...u, retries: r } })
export async function capped(h: Host, key: string): Promise<boolean> { return (((await h.ui.read()).retries as Record<string, number>) ?? {})[key] >= RETRIES + 1 }

// Report envelope (DESIGN 6.2): entry point for wave 3 (`tools/index`); semantic checks (6.3: files exist at sourceCommit...) are theirs to add.
// Returns an example-bearing error or null.
const ROLE_KEYS: Record<string, string[]> = { worker: ['outcome', 'summary'], tester: ['outcome', 'summary', 'tests'], reviewer: ['verdict', 'summary', 'findings', 'coverage', 'contractStatus'], explorer: [] }
export function validateReport(r: any): string | null {
  if (!r || typeof r !== 'object') return bad('report', '{"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"}', r)
  if (r.schemaVersion !== 1) return bad('schemaVersion', '1', r.schemaVersion)
  if (!(r.role in ROLE_KEYS)) return bad('role', 'worker|tester|reviewer|explorer', r.role)
  const miss = ROLE_KEYS[r.role].find(k => r[k] === undefined); if (miss) return `${miss}: required for role ${r.role}`
  if (r.role === 'explorer' && !str(r.answer)) return 'answer: required for role explorer'
  if (r.role === 'worker' && !['done', 'blocked', 'spec_change'].includes(r.outcome)) return bad('outcome', 'done|blocked|spec_change', r.outcome)
  if (r.role === 'reviewer' && !['pass', 'changes'].includes(r.verdict)) return bad('verdict', 'pass|changes', r.verdict)
  if (typeof r.summary === 'string' && r.summary.length > 1500) return `summary: at most 1500 chars, got ${r.summary.length}`
  return null
}
