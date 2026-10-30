// The one slot count (0.16 slice 2). A slot belongs to the TASK (concurrency.default counts tasks); a requester that waits on a helper lends it (slice 3), so a
// helper adds no task. concurrency.models / .providers count RUNNING runs by run.model, a waiting run never. Order: model key, else provider key, else the task count.
// FIFO per key with skip-ahead across keys; a want with `head` (a helper, a resume, a next step) goes before every new claim. FIFO order is per process (ADR 0028).
import type { Host } from '../types'
import type { Config } from '../config/defaults'
import type { Run } from './lifecycle'
import { WORD, roleSpecs } from './roles'

export interface Want { id: string; role: string; model?: string; unit?: string; head?: boolean }   // role 'claim' = a new task
const held = new Map<string, Want>()   // picks the spawner has taken and not yet started: they count like running ones
const k = (id: string, role: string) => `${id}:${role}`
export const has = (id: string, role: string) => held.has(k(id, role))
export const hold = (w: Want) => void held.set(k(w.id, w.role), w)
export const drop = (id: string, role: string) => void held.delete(k(id, role))

// the model gate (static): an alias (optional [1m]), claude-… (optional [1m] or @YYYYMMDD), a Bedrock id, or a models.allow entry. The cells: roles.*, byRisk and units' routing.
const digits = (s = '') => s !== '' && [...s].every(c => c >= '0' && c <= '9')
const wordy = (s: string) => s !== '' && [...s].every(c => WORD.includes(c) || c === '.' || c === '-')
const aliasOf = (m: string) => (m.endsWith('[1m]') ? m.slice(0, -4) : m[m.length - 9] === '@' && digits(m.slice(-8)) ? m.slice(0, -9) : m)
const modelOk = (m: string): boolean => {
  if (['haiku', 'sonnet', 'opus', 'fable'].includes(m.endsWith('[1m]') ? m.slice(0, -4) : m) || (aliasOf(m).startsWith('claude-') && wordy(aliasOf(m).slice(7)))) return true
  const [id = '', n, ...rest] = m.split(':')
  return !rest.length && (n === undefined || digits(n)) && [...id.slice(0, 2)].every(c => c >= 'a' && c <= 'z') && id.slice(2, 20) === '.anthropic.claude-' && wordy(id.slice(20))   // a Bedrock id
}
export function modelIssues(c: Config): string[] {
  const cells: [string, unknown][] = []
  for (const [r, v] of Object.entries(c.roles) as [string, any][]) {
    if (v?.model !== undefined) cells.push([`roles.${r}.model`, v.model])
    for (const [k, x] of Object.entries(v?.byRisk ?? {}) as [string, any][]) cells.push([`roles.${r}.byRisk.${k}.model`, x.model], [`roles.${r}.byRisk.${k}.escalate.model`, x.escalate?.model])
  }
  cells.push(['lessons.model', c.lessons?.model])
  for (const [n, s] of Object.entries(roleSpecs())) cells.push([`profile roles.${n}.model`, s.model])   // a role of the profile names its own model: gated like any other
  for (const u of c.units ?? [] as any[]) for (const [r, x] of Object.entries(u?.routing ?? {}) as [string, any][]) cells.push([`units ${u.root}: routing.${r}.model`, x?.model])
  return cells.filter(([, m]) => typeof m === 'string' && !modelOk(m) && !c.models.allow.includes(m)).map(([k, m]) => unknownModel(k, String(m)))
}
const unknownModel = (cell: string, m: string) => `${cell}: unknown model "${m}" (an alias, a claude-… id or a models.allow entry)`
// a well-formed name the engine refuses at the spawn: the same line as the load gate, and the drive stops at once (core/spawner)
export class ModelRefused extends Error {}
export const modelRefusal = (e: unknown, cell: string, m: string) => (/issue with the selected model|\bmodel\b.{0,80}\b(?:not exist|invalid|unknown|not found|have access)\b/i.test(String(e)) ? new ModelRefused(unknownModel(cell, m)) : e)   // engine-text-exception: agent.spawn rejects with a message only. The engine's wording; a transient "overloaded" or "not available" is retryable, so it is not here

export const providerOf = (env: Record<string, string | undefined>) => (env.CLAUDE_CODE_USE_BEDROCK ? 'bedrock' : env.CLAUDE_CODE_USE_VERTEX ? 'vertex' : 'anthropic')
// the limit a run of `model` is held to: its model key, else its provider key, else the task count (by 'default', which counts tasks only)
export function limitOf(c: Config['concurrency'], model: string, provider: string): { by: 'model' | 'provider' | 'default'; n: number } {
  const m = c.models[model] ?? c.models[aliasOf(model)], p = c.providers[provider]
  return m !== undefined ? { by: 'model', n: m } : p !== undefined ? { by: 'provider', n: p } : { by: 'default', n: c.default }
}
// a unit's own cap never exceeds the global one (0 = no global cap)
export const unitCap = (c: Config['concurrency'], u: { concurrency?: number }) => (u.concurrency && c.default > 0 ? Math.min(u.concurrency, c.default) : u.concurrency || 0)
export const clamped = (cfg: Config) => ((cfg.units ?? []) as { root: string; concurrency?: number }[]).filter(u => u.concurrency && cfg.concurrency.default > 0 && u.concurrency > cfg.concurrency.default).map(u => `unit ${u.root}: concurrency ${u.concurrency} is held to ${cfg.concurrency.default} (concurrency.default)`)

const live = new Set(['running', 'refused', 'silent'])
// the tasks in a slot: the active ones and the ones in review (a task holds its slot until it lands; the worker's report moves it to review, and the next task must not start in that gap). grant adds the claims still starting
export const inSlot = (t: { state: string }) => t.state === 'active' || t.state === 'review'
export const tasksFull = (cfg: Config, s: { tasks: { state: string }[] }) => cfg.concurrency.default > 0 && s.tasks.filter(inSlot).length >= cfg.concurrency.default
// who runs now, by model: the bound runs whose state is running (a waiting run holds no model slot)
export async function running(h: Host): Promise<(string | undefined)[]> {
  const runs = ((await h.ui.read()).runs ?? {}) as Record<string, Run>, bound = await h.bind.read()
  return Object.entries(runs).filter(([a, r]) => bound[a] && live.has(r.state?.state ?? '')).map(([, r]) => r.model)
}
// the wants that start now, in order. `units`: the unit of each active or wanted task (per-unit caps); `now`: models of the runs in progress
export function grant(cfg: Config, provider: string, s: { tasks: { id: string; state: string }[] }, now: (string | undefined)[], wants: Want[], units: Record<string, string> = {}): Want[] {
  const c = cfg.concurrency, byModel: Record<string, number> = {}, byUnit: Record<string, number> = {}
  let all = 0, tasks = s.tasks.filter(inSlot).length + [...held.values()].filter(w => w.role === 'claim').length
  const add = (m?: string, u?: string) => { all++; if (m) byModel[aliasOf(m)] = (byModel[aliasOf(m)] ?? 0) + 1; if (u) byUnit[u] = (byUnit[u] ?? 0) + 1 }
  for (const m of now) add(m); for (const w of held.values()) add(w.model)
  for (const t of s.tasks) if (inSlot(t) && units[t.id]) byUnit[units[t.id]] = (byUnit[units[t.id]] ?? 0) + 1
  const units0 = new Map(((cfg.units ?? []) as { root: string; concurrency?: number }[]).map(u => [u.root, unitCap(c, u)]))
  const out: Want[] = []
  for (const w of [...wants.filter(x => x.head), ...wants.filter(x => !x.head)]) {
    if (w.role === 'claim' && (c.default > 0 && tasks >= c.default || (w.unit && units0.get(w.unit) && (byUnit[w.unit] ?? 0) >= units0.get(w.unit)!))) continue
    const l = w.model ? limitOf(c, w.model, provider) : undefined
    if (l && l.by !== 'default' && l.n > 0 && (l.by === 'model' ? byModel[aliasOf(w.model!)] ?? 0 : all) >= l.n) continue
    out.push(w); add(w.model, w.role === 'claim' ? w.unit : undefined); if (w.role === 'claim') tasks++
  }
  return out
}
