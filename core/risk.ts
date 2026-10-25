// Risk-sized review (ADR 0016): the reviewer's depth and model follow the change's size and the paths it touches. Pure; the numbers come from config review.tiers.
import { matches } from './specview'

export type Tier = 'light' | 'standard' | 'thorough' | 'core'   // a task's risk: picks the model x effort cell of every role (roles.<role>.byRisk.<risk>)
export const RISKS: readonly Tier[] = ['light', 'standard', 'thorough', 'core']
export interface Tiers { light: { files: number; lines: number; paths: number }; thorough: { files: number; lines: number }; risky: string[] }
export interface RiskCfg { tiers: Tiers; deepLabels: string[]; coreTask: string; coreDiff: string }
// `git diff --numstat` -> changed paths and total lines (binary `-` counts 0; a rename shows its new path)
export function parseNumstat(out: string): { paths: string[]; lines: number } {
  const rows = out.split('\n').map(l => l.split('\t')).filter(r => r.length >= 3)
  return { paths: rows.map(r => r[2].replace(/\{[^}]*=> ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')), lines: rows.reduce((n, r) => n + (+r[0] || 0) + (+r[1] || 0), 0) }
}
// The risk of a task (config review.*), first match wins: a task of the core epic (review.coreTask) · a deep label (thorough) ·
// a change touching the landed core's paths (review.coreDiff) · a risky glob (thorough) · then size: at claim (no diff yet) the declared paths
// (at most tiers.light.paths = light), at review the diff (thorough above tiers.thorough.*, light below tiers.light.files and .lines). Pure.
export function riskOf(c: RiskCfg, o: { paths: string[]; lines?: number; labels: string[]; coreTask?: boolean; corePaths?: string[] }): Tier {
  const n = o.paths.length, t = c.tiers
  if (o.coreTask) return c.coreTask as Tier
  if (o.labels.some(l => c.deepLabels.includes(l))) return 'thorough'
  if (o.corePaths?.length && o.paths.some(p => matches(o.corePaths!, p))) return c.coreDiff as Tier
  if (o.paths.some(p => matches(t.risky, p))) return 'thorough'
  if (o.lines === undefined) return n <= t.light.paths ? 'light' : 'standard'
  return n > t.thorough.files || o.lines > t.thorough.lines ? 'thorough' : n < t.light.files && o.lines < t.light.lines ? 'light' : 'standard'
}
// what the reviewer is told to check, in task language (no tier names)
export const FOCUS: Record<Tier, string> = {
  light: 'Small change: confirm it does what the task says, that any scenario it has is checked by a test that really checks it, and that nothing outside the task changed.',
  standard: '',
  core: 'Shared core code other tasks build on: besides the scenarios, check that its public interface is complete, stable and documented, and that nothing task-specific leaked into it.',
  thorough: 'Large or sensitive change: besides the scenarios, check security (input handling, permissions, secrets, unsafe defaults) and fit with the existing structure (boundaries, duplicated logic, public contracts, migrations).',
}

// Model x effort per run (ADR 0019): the role's cell for the risk, its escalation after `escalate.after` failed rounds (0 = never). Reads only that cell; `setting`
// names the key it came from (the Activity line shows it). Pure.
export interface Cell { model: string; effort: string; escalate?: { after: number; model: string; effort: string } }
export function route(role: string, c: Cell, risk: Tier | '', rounds: number): { model: string; effort?: string; escalated?: true; setting: string } {
  const up = !!c.escalate && c.escalate.after > 0 && rounds >= c.escalate.after, p = up ? c.escalate! : c
  return { model: p.model, ...(p.effort !== 'default' ? { effort: p.effort } : {}), ...(up ? { escalated: true as const } : {}), setting: `roles.${role}${risk ? `.byRisk.${risk}` : ''}${up ? '.escalate' : ''}` }
}
