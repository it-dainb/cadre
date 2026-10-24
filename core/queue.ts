// The one slot count (0.16 slice 2). A slot belongs to the TASK (concurrency.default counts tasks); a requester that waits on a helper lends it (slice 3), so a
// helper adds no task. concurrency.models / .providers count RUNNING runs by run.model, a waiting run never. Order: model key, else provider key, else the task count.
// FIFO per key with skip-ahead across keys; a want with `head` (a helper, a resume, a next step) goes before every new claim. FIFO order is per process (ADR 0028).
import type { Host } from '../types'
import type { Config } from '../config/defaults'
import type { Run } from './lifecycle'

export interface Want { id: string; role: string; model?: string; unit?: string; head?: boolean }   // role 'claim' = a new task
const held = new Map<string, Want>()   // picks the spawner has taken and not yet started: they count like running ones
const k = (id: string, role: string) => `${id}:${role}`
export const has = (id: string, role: string) => held.has(k(id, role))
export const hold = (w: Want) => void held.set(k(w.id, w.role), w)
export const drop = (id: string, role: string) => void held.delete(k(id, role))

// the model gate (static): an alias (optional [1m]), claude-… (optional [1m] or @YYYYMMDD), a Bedrock id, or a models.allow entry. The cells: roles.*, byRisk and units' routing.
const MODEL_OK = /^(?:(?:haiku|sonnet|opus|fable)(?:\[1m\])?|claude-[\w.-]+(?:\[1m\]|@\d{8})?|[a-z]{2}\.anthropic\.claude-[\w.-]+(?::\d+)?)$/
export function modelIssues(c: Config): string[] {
  const cells: [string, unknown][] = []
  for (const [r, v] of Object.entries(c.roles) as [string, any][]) {
    if (v?.model !== undefined) cells.push([`roles.${r}.model`, v.model])
    for (const [k, x] of Object.entries(v?.byRisk ?? {}) as [string, any][]) cells.push([`roles.${r}.byRisk.${k}.model`, x.model], [`roles.${r}.byRisk.${k}.escalate.model`, x.escalate?.model])
  }
  for (const u of [...(c.units ?? []), ...(c.packages ?? [])] as any[]) for (const [r, x] of Object.entries(u?.routing ?? {}) as [string, any][]) cells.push([`units ${u.root}: routing.${r}.model`, x?.model])
  return cells.filter(([, m]) => typeof m === 'string' && !MODEL_OK.test(m) && !c.models.allow.includes(m)).map(([k, m]) => unknownModel(k, String(m)))
}
const unknownModel = (cell: string, m: string) => `${cell}: unknown model "${m}" (an alias, a claude-… id or a models.allow entry)`
// a well-formed name the engine refuses at the spawn: the same line as the load gate, and the drive stops at once (core/spawner)
export class ModelRefused extends Error {}
export const modelRefusal = (e: unknown, cell: string, m: string) => (/model/i.test(String(e)) && /not found|invalid|unknown|not exist|not available|issue with the selected|no access/i.test(String(e)) ? new ModelRefused(unknownModel(cell, m)) : e)

export const providerOf = (env: Record<string, string | undefined>) => (env.CLAUDE_CODE_USE_BEDROCK ? 'bedrock' : env.CLAUDE_CODE_USE_VERTEX ? 'vertex' : 'anthropic')
const aliasOf = (m: string) => m.replace(/\[1m\]$|@\d{8}$/, '')
// the limit a run of `model` is held to: its model key, else its provider key, else the task count (by 'default', which counts tasks only)
export function limitOf(c: Config['concurrency'], model: string, provider: string): { by: 'model' | 'provider' | 'default'; n: number } {
  const m = c.models[model] ?? c.models[aliasOf(model)], p = c.providers[provider]
  return m !== undefined ? { by: 'model', n: m } : p !== undefined ? { by: 'provider', n: p } : { by: 'default', n: c.default }
}
// a unit's own cap never exceeds the global one (0 = no global cap)
export const unitCap = (c: Config['concurrency'], u: { concurrency?: number }) => (u.concurrency && c.default > 0 ? Math.min(u.concurrency, c.default) : u.concurrency || 0)
export const clamped = (cfg: Config) => ((cfg.units ?? []) as { root: string; concurrency?: number }[]).filter(u => u.concurrency && cfg.concurrency.default > 0 && u.concurrency > cfg.concurrency.default).map(u => `unit ${u.root}: concurrency ${u.concurrency} is held to ${cfg.concurrency.default} (concurrency.default)`)

const live = new Set(['running', 'refused', 'silent'])
// the tasks in a slot: the active ones (grant adds the claims still starting)
export const tasksFull = (cfg: Config, s: { tasks: { state: string }[] }) => cfg.concurrency.default > 0 && s.tasks.filter(t => t.state === 'active').length >= cfg.concurrency.default
// who runs now, by model: the bound runs whose state is running (a waiting run holds no model slot)
export async function running(h: Host): Promise<(string | undefined)[]> {
  const runs = ((await h.ui.read()).runs ?? {}) as Record<string, Run>, bound = await h.bind.read()
  return Object.entries(runs).filter(([a, r]) => bound[a] && live.has(r.state?.state ?? '')).map(([, r]) => r.model)
}
// the wants that start now, in order. `units`: the unit of each active or wanted task (per-unit caps); `now`: models of the runs in progress
export function grant(cfg: Config, provider: string, s: { tasks: { id: string; state: string }[] }, now: (string | undefined)[], wants: Want[], units: Record<string, string> = {}): Want[] {
  const c = cfg.concurrency, byModel: Record<string, number> = {}, byUnit: Record<string, number> = {}
  let all = 0, tasks = s.tasks.filter(t => t.state === 'active').length + [...held.values()].filter(w => w.role === 'claim').length
  const add = (m?: string, u?: string) => { all++; if (m) byModel[aliasOf(m)] = (byModel[aliasOf(m)] ?? 0) + 1; if (u) byUnit[u] = (byUnit[u] ?? 0) + 1 }
  for (const m of now) add(m); for (const w of held.values()) add(w.model)
  for (const t of s.tasks) if (t.state === 'active' && units[t.id]) byUnit[units[t.id]] = (byUnit[units[t.id]] ?? 0) + 1
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
