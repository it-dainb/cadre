// Test doubles shared by unit tests (and later workers): an in-memory Host with no $ behind it. Not a test file.
import type { Host, SnapTask } from '../types'
import { emptySnapshot } from '../core/board'
import { emptyRing } from '../core/events'
import { SAY, leaks } from '../core/say'
import { MemoryStore } from '../task-management/adapters/memory/store'

// boundary lint: every text that reaches a model goes through core/say.modelText; a leak there fails the test that produced it
SAY.check = (kind, text) => { const l = leaks(kind, text); if (l.length) throw new Error(`model-visible leak (${kind}): ${l[0].slice(0, 200)}`) }

const cell = <T>(v: T) => ({ read: async () => v, update: async (fn: (x: T) => T) => (v = fn(v)) })
// every decision a test host's board ever held: translation key -> the English strings under it (tests/language.test.ts: a key must map to ONE string)
const SEEN = new Map<string, Set<string>>()
const note = (k: string, en: string) => SEEN.set(k, (SEEN.get(k) ?? new Set()).add(en))
export const clashes = () => [...SEEN].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}: ${[...v].join(' | ')}`)
const board = () => { const c = cell(emptySnapshot('repo')); return { read: c.read, update: async (fn: (x: ReturnType<typeof emptySnapshot>) => ReturnType<typeof emptySnapshot>) => { const b = await c.update(fn); for (const d of b.decisions ?? []) { for (const o of d.options) note(`${d.key}.${o.key}`, o.label); for (const f of d.fields ?? []) note(`${d.key}.${f.key}`, f.label) } return b } } }
export function fakeHost(o: { t0?: number; files?: Record<string, string>; env?: Record<string, string>; options?: Host['options'] } = {}): Host & { logs: string[]; toasts: string[]; clock: { set(ms: number): void; advance(ms: number): void } } {
  let t = o.t0 ?? 1_000
  const kv = new Map<string, unknown>(), logs: string[] = [], toasts: string[] = [], mem = new MemoryStore(), ready = mem.init({ types: {} as any, journal: false })
  return {
    taskStore: () => ready.then(() => mem),   // the repo's task store (run records, owners, the pointer live in its control doc); tests replace it as they need
    now: async () => (t += 10), rand: (n = 16) => 'ab'.repeat(n).slice(0, n * 2),
    board: board() as Host['board'], events: cell(emptyRing()), secret: cell({ active: true }), ui: cell({}), git: cell({ busy: false, epoch: 0 }), bind: cell({}),
    store: { get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v) }, del: async k => { kv.delete(k) } },
    env: async () => o.env ?? {}, readText: async p => o.files?.[p] ?? null,
    log: s => { logs.push(s) }, toast: s => { toasts.push(s) }, options: o.options ?? {}, logs, toasts, clock: { set: ms => { t = ms }, advance: ms => { t += ms } },   // the injected clock (h.now) moves only by its 10 ms per read, or as a test says
    stat: async (p, r) => ({ kind: 'file', realPath: r?.resolve ? p : undefined }), run: async () => ({ exitCode: 1, stdout: '', stderr: 'no run' }), settings: async () => ({}), write: async (p, t) => { if (o.files) o.files[p] = t }, cwd: async () => '/repo', home: async () => '/hm/u',
  }
}
export const task = (id: string, o: Partial<SnapTask> = {}): SnapTask =>
  ({ id, title: `t ${id}`, type: 'feature', kind: 'code', merges: true, state: 'todo', step: '', phaseSince: 0, deps: [], flags: [], ...o })
