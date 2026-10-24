// One RoleSpec per role (ADR 0024 §3): tools (the L1 allowlist and the agent file's list), the write scope, the cache TTL. agents/index and policy/guards derive from it.
import type { Role } from '../types'
import { leaks, modelText } from './say'

export interface RoleSpec { description: string; tools: readonly string[]; mcpAllow?: boolean; write: readonly string[]; ttl: '5m' | '1h'; effort?: string; disallowedTools?: readonly string[]; canRequest?: readonly string[] }   // canRequest: the helpers its run may ask for (core/needs)
const R = 'mcp__cadre__report', C = 'mcp__cadre__run_check', I = 'mcp__cadre__inspect'
// write: globs under the role's tree; [] = read-only. The tester's tree is its view; fence() subtracts the PROTECTED paths it already refuses (git.PROTECTED) after this match.
export const ROLES_DEFAULT: Record<Role, RoleSpec> = {
  worker: { description: 'implements one approved task in its own folder', tools: ['Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', R, C], mcpAllow: true, write: ['**'], ttl: '1h', canRequest: ['explore', 'setup'] },
  tester: { description: 'writes black-box tests for one task from its scenarios', tools: ['Read', 'Write', 'Edit', R], write: ['**'], ttl: '1h', canRequest: ['explore', 'setup'] },
  reviewer: { description: 'reviews one task commit against its scenarios', tools: ['Read', I, C, R], write: [], ttl: '1h' },
  explorer: { description: 'read-only recon, discovery and spikes', tools: ['Read', I, R], write: [], ttl: '5m', effort: 'low' },
  planner: { description: 'drafts the task plan of one epic, read-only', tools: ['Read', I, R], write: [], ttl: '1h', effort: 'high', canRequest: ['explore', 'probe'] },
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

// ---- custom roles (roles.custom): a spec is checked at load; the user layer may name any known tool, the repo layer only read-only ones ----
export const PROMPT_CAP = 2048   // bytes (A2), both layers
const FIELDS = ['description', 'prompt', 'tools', 'disallowedTools', 'model', 'effort', 'maxTurns', 'write', 'network', 'canRequest']   // never permissionMode, hooks, mcpServers, isolation, memory, skills, background
const KNOWN = ['Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', 'WebFetch', 'WebSearch', R, C, I], HELPERS = ['explore', 'setup', 'probe']
const strs = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'))
// null = fine, else why. `repo`: the spec comes from the repo file; its canRequest may only narrow the user layer's spec of the same name
export function customIssue(name: string, s: any, repo?: { canRequest?: readonly string[] }): string | null {
  const bad = Object.keys(s && typeof s === 'object' ? s : {}).find(k => !FIELDS.includes(k)), t: string[] = s?.tools ?? []
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) return 'name: lower-case letters, digits and -'
  if (name in ROLES_DEFAULT || HELPERS.includes(name)) return 'name: a built-in role has it'
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'expected a role spec object'
  if (bad) return `${bad}: not a role field`
  if (!s.description || typeof s.description !== 'string' || !s.prompt || typeof s.prompt !== 'string') return 'a role needs a description and a prompt, both text'
  if (!strs(s.tools) || !strs(s.disallowedTools) || !strs(s.write) || !strs(s.canRequest)) return 'tools, disallowedTools, write and canRequest: expected lists of text'
  if (new TextEncoder().encode(s.prompt).length > PROMPT_CAP) return `the prompt is over ${PROMPT_CAP} bytes`
  if (leaks('agent-file', `${s.description}\n${s.prompt}`).length) return 'the description and the prompt must say what the agent does, not how the tool works inside'
  const unk = t.find(x => !KNOWN.includes(x) && !EXIT.includes(x) && !x.startsWith('mcp__cadre__'))
  if (!t.includes(R)) return `tools: must name ${R}`
  if (unk) return `tools: ${unk} is not a known tool`
  if (s.write?.some((g: string) => !/^[\w.*/-]+$/.test(g) || g.startsWith('/') || g.includes('..'))) return 'write: globs under the role\'s folder'
  if (![undefined, 'on', 'off'].includes(s.network)) return 'network is on or off'
  if (s.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(s.effort)) return 'effort: low, medium, high, xhigh or max'
  if (s.maxTurns !== undefined && !(Number.isInteger(s.maxTurns) && s.maxTurns >= 1 && s.maxTurns <= 100)) return 'maxTurns: a whole number from 1 to 100'
  if (s.model !== undefined && typeof s.model !== 'string') return 'model: expected text'
  if (s.canRequest?.some((x: string) => !(repo ? repo.canRequest ?? [] : HELPERS).includes(x))) return repo ? 'canRequest: the repo file may only narrow the user file\'s' : `canRequest: ${HELPERS.join(', ')}`
  if (s.network !== 'on' && t.some(x => x === 'WebFetch' || x === 'WebSearch')) return 'tools: the web tools need network "on"'
  if (repo && (s.write?.length || s.network === 'on' || t.some(x => ![ 'Read', I, R].includes(x)))) return 'the repo file may only define read-only roles: write [], network off, tools Read, inspect, report'
  return exitIssue(s)
}
// the AgentSpec handed to the engine: the whitelisted fields only, and the report format for a role that answers like an explorer
const FOOT = 'Finish by calling report once: {"schemaVersion":1,"role":"explorer","answer":"<your answer>","citations":[{"path":"src/a.ts","line":1}]}'
export const agentSpec = (name: string, s: any) => ({ name, description: modelText('agent-file', s.description), prompt: modelText('agent-file', `${s.prompt}\n\n${FOOT}`), tools: [...s.tools] as string[],
  ...(s.disallowedTools?.length ? { disallowedTools: [...s.disallowedTools] as string[] } : {}), ...(s.model ? { model: s.model as string } : {}), ...(s.effort ? { effort: s.effort as string } : {}), ...(s.maxTurns ? { maxTurns: s.maxTurns as number } : {}) })
