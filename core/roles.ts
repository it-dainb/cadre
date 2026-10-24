// One RoleSpec per role (ADR 0024 §3): tools (the L1 allowlist and the agent file's list), the write scope, the cache TTL. agents/index and policy/guards derive from it.
import type { Role } from '../types'

export interface RoleSpec { description: string; tools: readonly string[]; mcpAllow?: boolean; write: readonly string[]; ttl: '5m' | '1h'; effort?: string; disallowedTools?: readonly string[] }
const R = 'mcp__cadre__report', C = 'mcp__cadre__run_check', I = 'mcp__cadre__inspect'
// write: globs under the role's tree; [] = read-only. The tester's tree is its view; fence() subtracts the PROTECTED paths it already refuses (git.PROTECTED) after this match.
export const ROLES_DEFAULT: Record<Role, RoleSpec> = {
  worker: { description: 'implements one approved task in its own folder', tools: ['Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', R, C], mcpAllow: true, write: ['**'], ttl: '1h' },
  tester: { description: 'writes black-box tests for one task from its scenarios', tools: ['Read', 'Write', 'Edit', R], write: ['**'], ttl: '1h' },
  reviewer: { description: 'reviews one task commit against its scenarios', tools: ['Read', I, C, R], write: [], ttl: '1h' },
  explorer: { description: 'read-only recon, discovery and spikes', tools: ['Read', I, R], write: [], ttl: '5m', effort: 'low' },
  planner: { description: 'drafts the task plan of one epic, read-only', tools: ['Read', I, R], write: [], ttl: '1h', effort: 'high' },
}
// Exit rule 1 and 6: the engine's exit tools are never refused; no spec may disallow them or list some of them and not all (an allowlist that drops one)
export const EXIT = ['SubagentHandback', 'StructuredOutput']
export const exitIssue = (s: { tools?: readonly string[]; disallowedTools?: readonly string[] }): string | null => {
  const no = EXIT.find(t => s.disallowedTools?.includes(t)), drop = EXIT.find(t => !s.tools?.includes(t) && EXIT.some(x => s.tools?.includes(x)))
  return no ? `${no} is how an agent ends: it cannot be disallowed` : drop ? `${drop} is how an agent ends: tools may not drop it` : null
}
// a write glob ('**' any depth, '*' one segment) against a path relative to the role's tree
export const writes = (spec: RoleSpec, rel: string): boolean => spec.write.some(g => new RegExp(`^${g.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`).test(rel))
// the rows of Settings that show what no setting changes (config/route FIXED)
export const fixedRules = (): [string, string, string][] => [['fixed.exitTools', EXIT.join(', '), 'tools every agent can always call to end: no role may drop them'],
  ['fixed.writeScope', (Object.keys(ROLES_DEFAULT) as Role[]).map(r => `${r} ${ROLES_DEFAULT[r].write.join(' ') || 'none'}`).join(', '), 'where each agent role may write (inside its own working directory, never the protected paths)']]
