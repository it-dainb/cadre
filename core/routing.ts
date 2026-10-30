// Model x effort routing (ADR 0016, 0019; plan 2.4 RoleSpec.routing). The risk of a task is the planner's declaration (task field `risk`, B9); nothing here scores a diff.
export type Tier = 'light' | 'standard' | 'thorough' | 'core'   // picks the model x effort cell of every role (roles.<role>.byRisk.<risk>, defaults from the profile's routing)
export const RISKS: readonly Tier[] = ['light', 'standard', 'thorough', 'core']
export const riskOf = (t?: { meta: Record<string, string> }): Tier => RISKS.find(r => r === t?.meta['cadre.risk']) ?? 'standard'
// what the reviewer is told to check, in task language (no tier names)
export const FOCUS: Record<Tier, string> = {
  light: 'Small change: confirm it does what the task says, that any scenario it has is checked by a test that really checks it, and that nothing outside the task changed.',
  standard: '',
  core: 'Shared core code other tasks build on: besides the scenarios, check that its public interface is complete, stable and documented, and that nothing task-specific leaked into it.',
  thorough: 'Large or sensitive change: besides the scenarios, check security (input handling, permissions, secrets, unsafe defaults) and fit with the existing structure (boundaries, duplicated logic, public contracts, migrations).',
}
// the role's cell for the risk, its escalation after `escalate.after` failed rounds (0 = never). Reads only that cell; `setting` names the key it came from (the Activity line shows it). Pure.
export interface Cell { model: string; effort: string; escalate?: { after: number; model: string; effort: string } }
export function route(role: string, c: Cell, risk: Tier | '', rounds: number): { model: string; effort?: string; escalated?: true; setting: string } {
  const up = !!c.escalate && c.escalate.after > 0 && rounds >= c.escalate.after, p = up ? c.escalate! : c
  return { model: p.model, ...(p.effort !== 'default' ? { effort: p.effort } : {}), ...(up ? { escalated: true as const } : {}), setting: `roles.${role}${risk ? `.byRisk.${risk}` : ''}${up ? '.escalate' : ''}` }
}
