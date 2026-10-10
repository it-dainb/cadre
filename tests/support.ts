// Test doubles shared by unit tests (and later workers): an in-memory Host with no $ behind it. Not a test file.
import type { Host, SnapTask } from '../types'
import { emptySnapshot } from '../core/board'
import { emptyRing } from '../core/events'

const cell = <T>(v: T) => ({ read: async () => v, update: async (fn: (x: T) => T) => (v = fn(v)) })
export function fakeHost(o: { t0?: number; files?: Record<string, string>; env?: Record<string, string>; options?: Host['options'] } = {}): Host & { logs: string[]; toasts: string[] } {
  let t = o.t0 ?? 1_000
  const kv = new Map<string, unknown>(), logs: string[] = [], toasts: string[] = []
  return {
    now: async () => (t += 10), rand: (n = 16) => 'ab'.repeat(n).slice(0, n * 2),
    board: cell(emptySnapshot('repo')), events: cell(emptyRing()), secret: cell({}), ui: cell({}), git: cell({ busy: false, epoch: 0 }), bind: cell({}),
    store: { get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v) }, del: async k => { kv.delete(k) } },
    env: async () => o.env ?? {}, readText: async p => o.files?.[p] ?? null,
    log: s => { logs.push(s) }, toast: s => { toasts.push(s) }, options: o.options ?? {}, logs, toasts,
    stat: async (p, r) => ({ kind: 'file', realPath: r?.resolve ? p : undefined }), run: async () => ({ exitCode: 1, stdout: '', stderr: 'no run' }), settings: async () => ({}), write: async (p, t) => { if (o.files) o.files[p] = t }, cwd: async () => '/repo', home: async () => '/home/u',
  }
}
export const task = (id: string, o: Partial<SnapTask> = {}): SnapTask =>
  ({ id, title: `t ${id}`, type: 'feature', kind: 'code', merges: true, state: 'todo', step: '', phaseSince: 0, deps: [], flags: [], ...o })
