import { describe, expect, test } from 'claude-code/testing'
import { BdStore } from '../task-management/adapters/beads/store'
import { Bd, errorOf } from '../task-management/adapters/beads/bd'
import { categoryOf, closeReason, toTask } from '../task-management/adapters/beads/map'
import { contract } from './store-contract'
import { SESSIONS } from './fixtures/bd/contract'

// The shared TaskStore contract over REAL bd output, replayed: tests/dev/beads-real.mjs (RECORD=1) records one session per store; here each call must
// issue exactly the recorded argv (+ stdin) and gets the recorded result. An adapter change that alters bd calls means re-recording against real bd.
let session = 0
contract('beads (replayed bd 1.3.1)', () => {
  const log = SESSIONS[session++] ?? [], at = { i: 0 }
  const run = async (argv: readonly string[], init?: { stdin?: string }) => {
    const want = log[at.i++], got = JSON.stringify([argv.slice(1), init?.stdin])
    if (!want || JSON.stringify([want.argv, want.stdin]) !== got) throw new Error(`replay diverged at call ${at.i} of session ${session}: wanted ${want ? JSON.stringify([want.argv, want.stdin]) : 'nothing'}, got ${got}`)
    return { exitCode: want.exitCode, stdout: want.stdout, stderr: want.stderr }
  }
  return new BdStore({ run, cwd: '/x', actor: 'cadre/test/abc123' })
})

const SHOW = { id: 'bd-7', title: 'A task', description: 'desc body\n', design: '{"none":true}', acceptance_criteria: 'S1: Given', status: 'in_progress', priority: 2, issue_type: 'feature', assignee: 'cadre/u/abc123',
  updated_at: '2026-10-10T02:44:59Z', lease_expires_at: '2026-10-10T02:49:59Z', metadata: { 'cadre.step': 'worker', n: 3 }, parent: 'bd-1', revision: '49630225007729846',
  dependencies: [{ id: 'bd-2', dependency_type: 'blocks' }, { id: 'bd-1', dependency_type: 'parent-child' }, { id: 'bd-3', dependency_type: 'conditional-blocks' }] }
describe('map (shapes copied from real `bd show` / `bd list`)', () => {
  test('show -> Task: category, lease, meta stringified, parent-child is the parent not a dep, revision as string, trailing newline trimmed', async () => {
    expect(toTask(SHOW)).toEqual({ id: 'bd-7', title: 'A task', description: 'desc body', design: '{"none":true}', acceptance: 'S1: Given', type: 'feature', category: 'active', nativeStatus: 'in_progress', priority: 2,
      assignee: 'cadre/u/abc123', leaseUntil: '2026-10-10T02:49:59Z', parent: 'bd-1', deps: [{ id: 'bd-2', type: 'blocks' }, { id: 'bd-3', type: 'conditional-blocks' }], labels: [], meta: { 'cadre.step': 'worker', n: '3' }, revision: '49630225007729846', updatedAt: '2026-10-10T02:44:59Z' })
  })
  test('list shape: {depends_on_id, type}', async () => {
    expect(toTask({ id: 'a', title: 't', status: 'open', dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'waits-for' }, { issue_id: 'a', depends_on_id: 'e', type: 'parent-child' }] }).deps).toEqual([{ id: 'b', type: 'waits-for' }])
  })
  test('native status <-> category; closed splits by reason; a cancelled reason always carries "failed" (conditional-blocks fires on it)', async () => {
    expect(['draft', 'open', 'in_progress', 'in_review', 'blocked'].map(s => categoryOf(s))).toEqual(['draft', 'todo', 'active', 'review', 'blocked'])
    expect(categoryOf('closed', 'done: x')).toBe('done'); expect(categoryOf('closed', 'cancelled: failed: no')).toBe('cancelled'); expect(categoryOf('closed')).toBe('done')
    expect(closeReason('done')).toBe('done'); expect(closeReason('cancelled', 'no')).toBe('cancelled: failed: no'); expect(closeReason('cancelled', 'failed: boom')).toBe('cancelled: failed: boom'); expect(closeReason('cancelled')).toBe('cancelled: failed')
  })
  test('error mapping: exit 13 = GuardMismatch; bd texts -> codes; unknown -> Invalid', async () => {
    expect(errorOf('anything', 13).code).toBe('GuardMismatch'); expect(errorOf('issue already claimed by x', 1).code).toBe('AlreadyClaimed'); expect(errorOf('adding dependency would create a cycle', 1).code).toBe('Cycle')
    expect(errorOf('cannot depend on itself', 1).code).toBe('Cycle'); expect(errorOf('no issues found matching the provided IDs', 1).code).toBe('NotFound'); expect(errorOf('boom', 1).code).toBe('Invalid')
  })
})

describe('bd transport (11.2)', () => {
  test('argv + env: --json last, envelope/non-interactive/actor/gate-timeout env, cwd, timeout; stdin for free text', async () => {
    const seen: any[] = []; const bd = new Bd({ run: async (argv, init) => { seen.push({ argv, init }); return { exitCode: 0, stdout: '{"data":{"id":"x"},"schema_version":1}', stderr: '' } }, cwd: '/repo', actor: 'cadre/u/a1' })
    expect(await bd.call(['comment', 'x', '--stdin'], { stdin: 'hello', actor: 'cadre/u/z9' })).toEqual({ id: 'x' })
    expect(seen[0]).toEqual({ argv: ['bd', 'comment', 'x', '--stdin', '--json'], init: { cwd: '/repo', stdin: 'hello', timeoutMs: 45000, env: { BD_JSON_ENVELOPE: '1', BD_NON_INTERACTIVE: '1', BEADS_ACTOR: 'cadre/u/z9', BEADS_GATE_WAIT_TIMEOUT: '10s' } } })
  })
  test('a `data.error` payload, a non-zero exit, a spawn failure and a timeout all throw StoreErrors', async () => {
    const mk = (r: any) => new Bd({ run: async () => { if (r instanceof Error) throw r; return r }, cwd: '/r', actor: 'a' })
    await expect(mk({ exitCode: 0, stdout: '{"data":{"error":"x not found"}}', stderr: '' }).call(['show', 'x'])).rejects.toMatchObject({ code: 'NotFound' })
    await expect(mk({ exitCode: 13, stdout: '{"data":{"error":"mismatch"}}', stderr: '' }).call(['update'])).rejects.toMatchObject({ code: 'GuardMismatch' })
    await expect(mk(new Error('spawn bd ENOENT')).call(['version'])).rejects.toMatchObject({ code: 'Unavailable' }); await expect(mk(new Error('timed out')).call(['version'])).rejects.toMatchObject({ code: 'Timeout' })
    await expect(mk({ exitCode: 0, stdout: 'plain', stderr: '' }).call(['show'])).rejects.toMatchObject({ code: 'Invalid' })
  })
  test('setMeta ifRevision is a read-check-write (bd 1.3.1 has no --if-revision): a stale revision never reaches bd update', async () => {
    const calls: string[][] = []; const run = async (argv: readonly string[]) => { calls.push([...argv]); return { exitCode: 0, stdout: JSON.stringify({ data: [{ ...SHOW, revision: 5 }] }), stderr: '' } }
    const s = new BdStore({ run, cwd: '/r', actor: 'a' })
    await expect(s.setMeta('bd-7', { k: 'v' }, 'a', '4')).rejects.toMatchObject({ code: 'GuardMismatch' }); expect(calls.some(c => c[1] === 'update')).toBe(false)
    await s.setMeta('bd-7', { k: 'v' }, 'a', '5'); expect(calls.find(c => c[1] === 'update')).toEqual(['bd', 'update', 'bd-7', '--set-metadata=k=v', '--json'])
  })
})
