// Roster (DESIGN 4.1): 4 agent types, shipped as plugin agent files agents/<role>.md (A28: per-agent experimental.cacheTtl; their body = PROMPTS, tools = TOOLS, test-pinned).
// The `tools` list is also the role's L1 allowlist (default-deny by name). Grep/Glob are absent in 2.1.295 (S45): no search tools; briefs name paths.
import { ROLES_DEFAULT } from '../core/roles'
import { modelText } from '../core/say'
import type { Role } from '../types'

const I = 'mcp__cadre__inspect'
export const TOOLS = Object.fromEntries(Object.entries(ROLES_DEFAULT).map(([r, x]) => [r, x.tools])) as Record<Role, readonly string[]>
// main: no shell, no Cron*/ScheduleWakeup (a second loop owner, DESIGN 9). File tools are fenced (policy/guards).
export const MAIN_TOOLS: readonly string[] = ['Read', 'LSP', 'WebFetch', 'WebSearch', 'ToolSearch',
  'Agent', 'AskUserQuestion', 'SendMessage', 'Skill', 'Edit', 'Write', 'NotebookEdit', I, ...['plan', 'task', 'epic', 'amend', 'explore', 'ask', 'status', 'preferences'].map(t => `mcp__cadre__${t}`)]   // main's own tools (tools/index MAIN); Agent only to start a planned task (core/plantools.mainAgent)
const DESC = Object.fromEntries(Object.entries(ROLES_DEFAULT).map(([r, x]) => [r, x.description])) as Record<Role, string>
// allowlist for a role: its tools, plus the user's mcpAllow for the worker (SA: user-level S key)
export const allowlist = (role: Role, mcpAllow: readonly string[] = []): string[] => [...TOOLS[role], ...(ROLES_DEFAULT[role].mcpAllow ? mcpAllow : [])]

export interface Roles { [k: string]: { model?: string; effort?: string; byRisk?: Record<string, { model?: string; effort?: string }> } }
// A role's spec as config resolves it (init stage 6 renders one per role): model/effort of its standard-risk cell (explorer: its own), 'default' effort left out.
export function spec(role: Role, cfg: { roles: Roles; mcpAllow: readonly string[] }) {
  const r0 = cfg.roles[role] ?? {}, r = r0.byRisk?.standard ?? r0
  return { name: role, description: DESC[role], prompt: modelText('agent-brief', ROLES_DEFAULT[role].prompt), tools: allowlist(role, cfg.mcpAllow), ...(r.model ? { model: r.model } : {}), ...(r.effort && r.effort !== 'default' ? { effort: r.effort } : {}) }
}
// The plugin agent file agents/<role>.md, byte for byte (tests compare it with the shipped file). No model: admission sets it per spawn from config.
// Prompt-cache TTL per role (A28, S44, ADR 0022): 1h for worker/tester/reviewer (same-role spawns are 5-60 min apart) and the planner (a milestone's planners
// start minutes apart, ADR 0021; effort high = roles.planner's default, for its first request, before admission binds it); the one-shot explorer an explicit 5m (cheaper writes). Shipped in the files, so it is a fixed row in settings (config/route), not a knob. The explorer also keeps low effort.
export const TTL = Object.fromEntries(Object.entries(ROLES_DEFAULT).map(([r, x]) => [r, x.ttl])) as Record<Role, '5m' | '1h'>
export const ROLES: readonly Role[] = ['worker', 'tester', 'reviewer', 'explorer', 'planner', 'specifier']
export const file = (role: Role): string => ['---', `name: ${role}`, `description: "${DESC[role]}"`, `tools: ${TOOLS[role].join(', ')}`,
  ...(ROLES_DEFAULT[role].effort ? [`effort: ${ROLES_DEFAULT[role].effort}`] : []), ...(ROLES_DEFAULT[role].maxTurns ? [`maxTurns: ${ROLES_DEFAULT[role].maxTurns}`] : []), 'experimental:', `  cacheTtl: ${TTL[role]}`, '---', ROLES_DEFAULT[role].prompt, ''].join('\n')
