// Draft + report field validation (DESIGN 3.1, 6.3). Refuses only malformed PRESENT fields, with an example-bearing error;
// completeness (scenarios, changelog decision, contract, package) is checked at approve. Pure: no Host, no store.
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { kindOf } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'

export const FIELDS = ['kind', 'amend', 'type', 'scope', 'breaking', 'package', 'scenarios', 'changelog', 'interface'] as const
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
  const spec = reg[t.type]; if (!spec || kindOf(spec) === 'spike') return []
  const out: string[] = []
  if (!t.acceptance?.trim()) out.push('scenarios')
  if (!t.meta['cadre.changelog']) out.push('changelog')
  if (spec.contract === 'required' && !t.design) out.push('interface')
  if (!t.meta['cadre.package']) out.push('package')
  return out
}
// every draft's gaps as "id: a, b"; a plan with no tasks lacks "tasks". Empty = approvable.
export const missingList = (drafts: Task[], reg: TypeRegistry): string[] =>
  drafts.length ? drafts.flatMap(t => { const m = missingOf(t, reg); return m.length ? [`${t.id}: ${m.join(', ')}`] : [] }) : ['tasks']
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
  if (r.role === 'explorer' && !(str(r.answer) || r.discovery)) return 'answer: required for role explorer (or discovery)'
  if (r.role === 'worker' && !['done', 'blocked', 'spec_change'].includes(r.outcome)) return bad('outcome', 'done|blocked|spec_change', r.outcome)
  if (r.role === 'reviewer' && !['pass', 'changes'].includes(r.verdict)) return bad('verdict', 'pass|changes', r.verdict)
  if (typeof r.summary === 'string' && r.summary.length > 1500) return `summary: at most 1500 chars, got ${r.summary.length}`
  return null
}
