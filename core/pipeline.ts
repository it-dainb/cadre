// The pipeline interpreter (plan 2.3): the active profile's types and steps, read synchronously (set once at session start by core/profile, like the flag table and the roles).
// A step is a role run or a gate; its category, the step that produced what review judges and the task kind are derived from the profile, never named here.
import type { Category, Kind } from '../types'
import type { OnFail, Profile, Step, TypeSpec } from '../types/profile'
import { profile as DEFAULT } from '../profiles/default'
import { setFlags } from './flags'
import { setRoles } from './roles'
import { SANDBOX } from './git'

let P: Profile = DEFAULT
export const setProfile = (p: Profile): void => { P = p; setFlags(p.flags); setRoles(p.roles) }
export const active = (): Profile => P
export const typeOf = (type: string): TypeSpec | undefined => P.types[type]
export const stepOf = (id: string): Step | undefined => P.steps[id]
// the steps of a task: its type's pipeline, or the alternate one when the task's lane is `lite` (a type without `lite` has one pipeline)
export const pipeOf = (type: string, lane?: string): readonly string[] => { const s = P.types[type]; return !s ? [] : lane === 'lite' && s.lite ? s.lite : s.pipeline }
export const roleAt = (step: string): string | undefined => { const s = P.steps[step]; return s && 'role' in s ? s.role : undefined }
export const gateAt = (step: string): string | undefined => { const s = P.steps[step]; return s && 'gate' in s ? s.gate : undefined }
export const workspaceAt = (step: string): string | undefined => { const s = P.steps[step]; return s && 'role' in s ? s.workspace : undefined }
// the step's lock rules: `acquire: 'out'` locks the files the step wrote, `enforce: 'in'` refuses edits of locked files while the step runs
export const locksAt = (step: string): { acquire?: 'out'; enforce?: 'in' } | undefined => { const s = P.steps[step]; return s && 'role' in s ? s.locks : undefined }
export const verdictAt = (step: string): boolean => !!P.roles[roleAt(step) ?? '']?.verdict   // a role step whose role judges: review
// a verdict step and the integrate gate await a review pass (`review`); every other step is `active`
export const catOf = (step: string): Category => (verdictAt(step) || gateAt(step) === 'integrate' ? 'review' : 'active')
// the step that produced what step i judges: the nearest earlier role step whose role has no verdict (else the first step)
export const producer = (p: readonly string[], i: number): string => [...p.slice(0, i)].reverse().find(s => roleAt(s) && !verdictAt(s)) ?? p[0]
export const enter = (type: string, lane?: string): string | undefined => pipeOf(type, lane)[0]
export const next = (type: string, lane: string | undefined, step: string): string | undefined => { const p = pipeOf(type, lane), i = p.indexOf(step); return i < 0 ? undefined : p[i + 1] }
// a task works in a tree when one of its steps does; one with no such step only reads (an answer, no landing)
export const kindOf = (type: string): Kind => (pipeOf(type).some(s => workspaceAt(s) === 'worktree') ? 'code' : 'spike')
export const merges = (type: string): boolean => pipeOf(type).some(s => gateAt(s) === 'integrate')
// a type whose acceptance is covered (by the gate's results or the reviewer's list) needs a test or a coverage entry per item; `none` covers nothing
export const covers = (type: string): boolean => (P.types[type]?.acceptance.cover ?? 'none') !== 'none'
export const onFail = (step: string): OnFail | undefined => P.steps[step]?.onFail
// the step's retries are spent at its n-th failed round (1-based): a step that goes `back` is sent back `retry` times and raised on the next failure (the review rounds);
// a step that waits for the human (`then: human`) counts the failing round itself (the tester's rounds)
export const spent = (step: string, n: number): boolean => { const f = onFail(step); return !!f && (typeof f.then === 'object' ? n > f.retry : n >= f.retry) }
// the `sandbox.env` of the profile with its `${NAME}`s filled in (the closed set: MODULES TMPDIR UID WT PATH id title version)
export const fill = (s: string, v: Record<string, string>): string => s.split('${').map((x, i) => { const e = x.indexOf('}'); return i && e >= 0 ? (v[x.slice(0, e)] ?? '') + x.slice(e + 1) : i ? `\${${x}` : x }).join('')
export const sandboxEnv = (v: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(P.sandbox.env).map(([k, s]) => [k, fill(s, v)]))
SANDBOX.env = sandboxEnv
