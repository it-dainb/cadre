// The one runner of delivery hooks, landing providers and (from S6b) the sync module (plan 2.7, 2.8; B21). It is only the spawn/limits/kill primitive: the caller owns cwd, locks,
// CAS and the schema of the result. The child gets an allowlisted environment and two paths: CADRE_INPUT (a JSON file core wrote) and CADRE_RESULT (the one file core reads back,
// a regular file of at most 1 MB). No regex here.
import type { Host } from '../types'
import { capped } from './junit'

// `h.run` merges its env over the session's (S0 spike 6), so the allowlist is an `env -i` prefix: nothing else reaches the child. Hygiene, not a boundary (a same-uid hook can read /proc).
export const ALLOW = ['PATH', 'LANG']
export interface Ran { exit: number; timedOut: boolean; result?: unknown; bad?: string }

// `scratch`: a folder of this run only (made 0700, the caller removes it); `envPass`: the env names this caller declared. A hang is killed by the host at `timeoutMs`.
export async function modrun(h: Host, o: { argv: readonly string[]; cwd: string; input: unknown; scratch: string; envPass?: readonly string[]; timeoutMs?: number }): Promise<Ran> {
  // a name is read by `printenv` through the host's own run (the kit lists the variables a module reads by literal name, so a profile's envPass names cannot go through $.env)
  const get = async (n: string) => { const r = await h.run(['printenv', '-0', '--', n]).catch(() => undefined); return r && !r.exitCode ? r.stdout.slice(0, -1) : undefined }, input = `${o.scratch}/input.json`, out = `${o.scratch}/result.json`
  await h.run(['mkdir', '-p', '-m', '700', o.scratch]); await h.write(input, JSON.stringify(o.input))
  const env: string[] = [`HOME=${await h.home()}`, `TMPDIR=${o.scratch}`, `CADRE_INPUT=${input}`, `CADRE_RESULT=${out}`]
  for (const n of [...ALLOW, ...(o.envPass ?? [])]) { const v = await get(n); if (v) env.push(`${n}=${v}`) }
  let exit = -1, timedOut = false
  try { exit = (await h.run(['env', '-i', ...env, ...o.argv], { cwd: o.cwd, timeoutMs: o.timeoutMs ?? 60_000 })).exitCode } catch { timedOut = true }
  const c = await capped(h, out, o.scratch, 'the result file'); if (c.bad) return { exit, timedOut, bad: c.bad }
  if (c.text === undefined) return { exit, timedOut }
  try { return { exit, timedOut, result: JSON.parse(c.text) } } catch { return { exit, timedOut, bad: 'the result file is not valid JSON' } }
}
