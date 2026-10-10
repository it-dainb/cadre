// Adapter protocol client (DESIGN 11.3, docs/protocol.md): one-shot spawn (stdin closed after the request), framing, versions, error codes, grants.
import type { Host } from '../types'

export const CODES = ['Offline', 'Auth', 'RateLimited', 'Conflict', 'NotFound', 'Invalid', 'Unsupported'] as const
export type Code = typeof CODES[number]
export type Grant = 'sync' | 'events' | 'commands'
export interface AdapterCfg { command: string[]; credentialEnv?: string; grants: Grant[] }
export class AdapterError extends Error {
  constructor(public code: Code, message: string = code, public retryAfterMs?: number) { super(message) }
}
// method -> grant it needs (null = none)
export const NEEDS: Record<string, Grant | null> = { ping: null, describe: null, describeSchema: 'sync', listProjects: 'sync', validateAccess: 'sync', push: 'sync', pull: 'sync', deliver: 'events' }

export async function call(h: Host, name: string, cfg: AdapterCfg, method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!(method in NEEDS)) throw new AdapterError('Unsupported', `unknown method ${method}`)
  const need = NEEDS[method]; if (need && !cfg.grants?.includes(need)) throw new AdapterError('Unsupported', `adapter ${name} lacks the ${need} grant`)
  if (!Array.isArray(cfg.command) || !cfg.command.length) throw new AdapterError('Invalid', `adapter ${name} has no command`)
  if (!h.spawn) throw new AdapterError('Offline', 'process.spawn is unavailable')
  if (cfg.credentialEnv && (await h.run(['printenv', cfg.credentialEnv])).exitCode !== 0) throw new AdapterError('Auth', `environment variable ${cfg.credentialEnv} is not set`)
  let r: Awaited<ReturnType<NonNullable<Host['spawn']>>>
  try { r = await h.spawn({ argv: cfg.command, input: JSON.stringify({ protocol: 'cadre-adapter', v: 1, method, params }), timeoutMs: 30_000 }) } catch (e) { throw new AdapterError('Offline', `adapter ${name}: ${(e as Error).message}`) }
  let m: any
  try { m = JSON.parse(r.stdout) } catch { throw new AdapterError(r.exitCode ? 'Offline' : 'Invalid', `adapter ${name}: ${r.exitCode ? `exit ${r.exitCode}` : 'reply is not JSON'} ${r.stderr.slice(0, 200)}`.trim()) }
  if (!m || m.v !== 1 || typeof m.ok !== 'boolean') throw new AdapterError('Invalid', `adapter ${name}: unsupported protocol version ${m?.v}`)
  if (!m.ok) { const e = m.error ?? {}; throw new AdapterError(CODES.includes(e.code) ? e.code : 'Invalid', String(e.message ?? e.code ?? 'error'), typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined) }
  return m.result
}
