// Roster (DESIGN 4.1): 4 agent types, shipped as plugin agent files agents/<role>.md (A28: per-agent experimental.cacheTtl; their body = PROMPTS, tools = TOOLS, test-pinned).
// The `tools` list is also the role's L1 allowlist (default-deny by name). Grep/Glob are absent in 2.1.295 (S45): no search tools; briefs name paths.
import { modelText } from '../core/say'
import type { Role } from '../types'
import { PROMPTS } from './prompts'

const R = 'mcp__cadre__report', C = 'mcp__cadre__run_check', I = 'mcp__cadre__inspect'
export const TOOLS: Record<Role, readonly string[]> = {
  worker: ['Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', R, C],
  tester: ['Read', 'Write', 'Edit', R],
  reviewer: ['Read', I, C, R],
  explorer: ['Read', I, R],
  planner: ['Read', I, R],
}
// main: no shell, no Cron*/ScheduleWakeup (a second loop owner, DESIGN 9). File tools are fenced (policy/guards).
export const MAIN_TOOLS: readonly string[] = ['Read', 'LSP', 'WebFetch', 'WebSearch', 'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'Agent', 'AskUserQuestion', 'SendMessage', 'Skill', 'Edit', 'Write', 'NotebookEdit', I]
const DESC: Record<Role, string> = {
  worker: 'implements one approved task in its own folder',
  tester: 'writes black-box tests for one task from its scenarios',
  reviewer: 'reviews one task commit against its scenarios',
  explorer: 'read-only recon, discovery and spikes',
  planner: 'drafts the task plan of one epic, read-only',
}
// allowlist for a role: its tools, plus the user's mcpAllow for the worker (SA: user-level S key)
export const allowlist = (role: Role, mcpAllow: readonly string[] = []): string[] => [...TOOLS[role], ...(role === 'worker' ? mcpAllow : [])]

export interface Roles { [k: string]: { model?: string; effort?: string; byRisk?: Record<string, { model?: string; effort?: string }> } }
// A role's spec as config resolves it (init stage 6 renders one per role): model/effort of its standard-risk cell (explorer: its own), 'default' effort left out.
export function spec(role: Role, cfg: { roles: Roles; mcpAllow: readonly string[] }) {
  const r0 = cfg.roles[role] ?? {}, r = r0.byRisk?.standard ?? r0
  return { name: role, description: DESC[role], prompt: modelText('agent-brief', PROMPTS[role]), tools: allowlist(role, cfg.mcpAllow), ...(r.model ? { model: r.model } : {}), ...(r.effort && r.effort !== 'default' ? { effort: r.effort } : {}) }
}
// The plugin agent file agents/<role>.md, byte for byte (tests compare it with the shipped file). No model: admission sets it per spawn from config.
// 1h cache TTL for worker/tester/reviewer/planner (A28, S44; a milestone's planners start minutes apart); the one-shot explorer keeps the 5 min default and low effort.
export const ROLES: readonly Role[] = ['worker', 'tester', 'reviewer', 'explorer', 'planner']
export const file = (role: Role): string => ['---', `name: ${role}`, `description: "${DESC[role]}"`, `tools: ${TOOLS[role].join(', ')}`,
  ...(role === 'explorer' ? ['effort: low'] : ['experimental:', '  cacheTtl: 1h']), '---', PROMPTS[role], ''].join('\n')
