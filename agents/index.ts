// Roster (DESIGN 4.1): 4 agent types, registered in session.start. The `tools` list is also the role's L1 allowlist (default-deny by name).
import type { Role } from '../types'
import { PROMPTS } from './prompts'

const R = 'mcp__cadre__report', C = 'mcp__cadre__run_check', I = 'mcp__cadre__inspect'
export const TOOLS: Record<Role, readonly string[]> = {
  worker: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', R, C],
  tester: ['Read', 'Grep', 'Glob', 'Write', 'Edit', R],
  reviewer: ['Read', 'Grep', 'Glob', I, C, R],
  explorer: ['Read', 'Grep', 'Glob', I, R],
}
// main: no shell, no Cron*/ScheduleWakeup (a second loop owner, DESIGN 9). File tools are fenced (policy/guards).
export const MAIN_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'LSP', 'WebFetch', 'WebSearch', 'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'Agent', 'AskUserQuestion', 'SendMessage', 'Skill', 'Edit', 'Write', 'NotebookEdit', I]
const DESC: Record<Role, string> = {
  worker: 'cadre-internal: implements one approved task in its worktree',
  tester: 'cadre-internal: writes black-box tests for one task in its spec view',
  reviewer: 'cadre-internal: reviews one task commit against its scenarios',
  explorer: 'cadre-internal: read-only recon, discovery and spikes',
}
export interface Roles { [k: string]: { tier?: string; effort?: string } }

// allowlist for a role: its tools, plus the user's mcpAllow for the worker (SA: user-level S key)
export const allowlist = (role: Role, mcpAllow: readonly string[] = []): string[] => [...TOOLS[role], ...(role === 'worker' ? mcpAllow : [])]

// AgentSpec for `$.agent.register`; model/effort come from config roles + models (tier -> alias). 'default' effort is left out.
export function spec(role: Role, cfg: { roles: Roles; models: Record<string, string>; mcpAllow: readonly string[] }) {
  const r = cfg.roles[role] ?? {}
  return {
    name: role, description: DESC[role], prompt: PROMPTS[role], tools: allowlist(role, cfg.mcpAllow),
    ...(r.tier ? { model: cfg.models[r.tier] ?? r.tier } : {}), ...(r.effort && r.effort !== 'default' ? { effort: r.effort } : {}),   // omitClaudeMd stays absent: agents keep CLAUDE.md (DESIGN 4.1)
  }
}
export const roster = (cfg: Parameters<typeof spec>[1]) => (['worker', 'tester', 'reviewer', 'explorer'] as Role[]).map(r => spec(r, cfg))
