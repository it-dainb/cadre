// bd process wrapper (DESIGN 11.2): argv + env construction, envelope parsing, error mapping. The only place that spawns bd.
// Free text is never a separate argv word: callers pass `--flag=value` or stdin (cmd/bd/flags.go).
import { StoreError, type ErrorCode } from '../../store'

export type BdRun = (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export interface BdOpts { run: BdRun; cwd: string; actor: string; bin?: string; timeoutMs?: number; dir?: string }   // dir = BEADS_DIR (the store folder); absent = bd finds .beads itself

// bd exits 13 on a --if-assignee/--if-status mismatch; the other codes come from bd's own error text (the only signal it gives).
const MAP: [RegExp, ErrorCode][] = [
  [/already claimed/i, 'AlreadyClaimed'], [/cycle|depend on itself/i, 'Cycle'], [/not found|no issues found/i, 'NotFound'],
  [/not initialized|no beads database|no \.beads/i, 'NotInitialized'], [/locked|busy|timed out waiting for lock/i, 'Busy'],
  [/already closed/i, 'NotClosable'], [/not claimable/i, 'Invalid'],
]
export const errorOf = (msg: string, exit: number): StoreError =>
  new StoreError(exit === 13 ? 'GuardMismatch' : MAP.find(([re]) => re.test(msg))?.[1] ?? 'Invalid', msg.trim().slice(0, 300))

export class Bd {
  constructor(private o: BdOpts) {}
  private get dir(): Record<string, string> { return this.o.dir ? { BEADS_DIR: this.o.dir } : {} }
  // One bd call. `json` calls return the envelope's `data`; an `{error}` payload or non-zero exit throws a StoreError. Plain calls return stdout.
  async call(args: string[], x: { actor?: string; stdin?: string; json?: boolean } = {}): Promise<any> {
    const json = x.json ?? true
    let r
    try {
      r = await this.o.run([this.o.bin ?? 'bd', ...args, ...(json ? ['--json'] : [])], {
        cwd: this.o.cwd, stdin: x.stdin, timeoutMs: this.o.timeoutMs ?? 45000,
        env: { ...this.dir, BD_JSON_ENVELOPE: '1', BD_NON_INTERACTIVE: '1', BEADS_ACTOR: x.actor ?? this.o.actor, BEADS_GATE_WAIT_TIMEOUT: '10s' },
      })
    } catch (e) { throw new StoreError(/time/i.test(String(e)) ? 'Timeout' : 'Unavailable', String(e)) }
    if (!json) { if (r.exitCode) throw errorOf(r.stderr || r.stdout, r.exitCode); return r.stdout }
    let env: any; try { env = JSON.parse(r.stdout) } catch { /* stdout is not an envelope (plain error text) */ }
    if (r.exitCode || env?.data?.error) throw errorOf(`${env?.data?.error ?? ''} ${r.stderr}`.trim() || r.stdout, r.exitCode)
    if (!env) throw new StoreError('Invalid', `bd printed no JSON: ${r.stdout.slice(0, 200)}`)
    return env.data
  }
  // `bd events tail` prints JSON lines, not an envelope
  async lines(args: string[]): Promise<any[]> {
    const r = await this.o.run([this.o.bin ?? 'bd', ...args, '--json'], { cwd: this.o.cwd, timeoutMs: this.o.timeoutMs ?? 45000, env: { ...this.dir, BD_NON_INTERACTIVE: '1' } })
    if (r.exitCode) throw errorOf(r.stderr || r.stdout, r.exitCode)
    return r.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l))
  }
}
