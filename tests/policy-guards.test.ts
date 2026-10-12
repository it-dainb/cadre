import { describe, expect, test } from 'claude-code/testing'
import { check, configSet, realRoot, guard, inputPath, judge, judgeSpawn, send, setPolicy } from '../policy/guards'
import { isProt } from '../core/git'
import { idsIn } from '../core/briefs'
import { fakeHost, task } from './support'
import type { Binding, Role } from '../types'

const norm = (p: string) => { const o: string[] = []; for (const s of p.split('/')) { if (s === '..') o.pop(); else if (s && s !== '.') o.push(s) } return '/' + o.join('/') }
const EXISTS = ['/', '/x', '/x/repo', '/x/bd-a1', '/x/bd-a1.view', '/x/bd-a1/src', '/x/bd-a2', '/x/bd-a1/src/a.ts', '/x/bd-a1.view/t.test.ts', '/etc', '/etc/passwd', '/x/repo/a.ts', '/tmp', '/home', '/hm/u']
const b = (taskId: string, role: Role, worktree: string, step = 'worker'): Binding => ({ taskId, role, step, worktree, sessionId: 's', ctxTokens: 0, startedAt: 0 })
async function mk(opt: { strictness?: string; locks?: Record<string, string[]> } = {}) {
  const h = fakeHost({ options: { strictness: opt.strictness } })
  h.stat = async (p, o) => { const r = norm(p); return EXISTS.includes(r) ? { kind: 'file', realPath: o?.resolve ? r : undefined } : undefined }
  await setPolicy(h, { repo: '/x/repo', wtRoot: '/x', home: '/hm/u', locks: opt.locks })
  await h.board.update(s => ({ ...s, tasks: [task('bd-a1', { state: 'active', step: 'worker' }), task('bd-a2', { state: 'active', step: 'tester' })] }))
  await h.bind.update(() => ({ w1: b('bd-a1', 'worker', '/x/bd-a1'), t1: b('bd-a1', 'tester', '/x/bd-a1.view', 'tester'), r1: b('bd-a1', 'reviewer', '/x/bd-a1', 'reviewer') }))
  return h
}
const next = (e: any) => ({ ok: e.tool })
const call = (h: any, e: any) => guard(h, e, next)
const denied = (r: any) => typeof r?.deny === 'string'

describe('L1 capability (13.1)', () => {
  test('main: Bash and Edit in the repo denied; Read allowed; no Cron', async () => {
    const h = await mk()
    expect(denied(await call(h, { tool: 'Bash', command: 'ls' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Edit', file_path: '/x/repo/a.ts' }))).toBe(true)
    expect(JSON.stringify(await call(h, { tool: 'Edit', file_path: '/x/repo/a.ts' }))).toContain('TaskCreate')   // the deny names main's next action
    expect(denied(await call(h, { tool: 'CronCreate' }))).toBe(true)
    expect(await call(h, { tool: 'Read', file_path: '/x/repo/a.ts' })).toEqual({ ok: 'Read' })
  })
  test('shell only for a bound worker in the worker step', async () => {
    const h = await mk()
    expect(await call(h, { tool: 'Bash', agentId: 'w1' })).toEqual({ ok: 'Bash' })
    await h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, step: 'green' })) }))
    expect(denied(await call(h, { tool: 'Bash', agentId: 'w1' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Bash', agentId: 'r1' }))).toBe(true)
  })
  test('unknown ids and marker-less forks get the explorer list', async () => {
    const h = await mk()
    expect(denied(await call(h, { tool: 'Edit', agentId: 'zzz', file_path: '/x/bd-a1/src/a.ts' }))).toBe(true)
    expect(await call(h, { tool: 'Read', agentId: 'zzz', file_path: '/x/bd-a1/src/a.ts' })).toEqual({ ok: 'Read' })
    expect(denied(await call(h, { tool: 'Grep', agentId: 'zzz' }))).toBe(true)   // S45: Grep/Glob are in no allowlist (absent in 2.1.295)
  })
  test('dangerouslyDisableSandbox denied in any loop; advisory turns denies into warnings', async () => {
    const h = await mk()
    for (const agentId of [undefined, 'w1']) expect(denied(await call(h, { tool: 'Bash', agentId, command: 'x', dangerouslyDisableSandbox: true }))).toBe(true)
    const a = await mk({ strictness: 'advisory' })
    expect(await call(a, { tool: 'Bash', command: 'ls' })).toEqual({ ok: 'Bash' }); expect(a.logs.join()).toContain('advisory')
  })
})

describe('file fence (13.2)', () => {
  test('owner: own worktree allowed, other worktree / mod-owned / locked denied', async () => {
    const h = await mk({ locks: { 'bd-a1': ['/x/bd-a1/src/a.ts'] } })
    expect(denied(await call(h, { tool: 'Edit', agentId: 'w1', file_path: '/x/bd-a1/src/b.ts' }))).toBe(false)
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a2/new.ts' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a1/.git/config' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a1/CHANGELOG.md' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Edit', agentId: 'w1', file_path: '/x/bd-a1/src/a.ts' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a1/src/../../bd-a2/x.ts' }))).toBe(true)
    await h.board.update((b: any) => ({ ...b, tasks: b.tasks.map((t: any) => (t.id === 'bd-a1' ? { ...t, state: 'blocked' } : t)) }))   // reported spec_change / blocked: told to wait, not to look elsewhere
    expect((await call(h, { tool: 'Edit', agentId: 'w1', file_path: '/x/bd-a1/src/b.ts' })).deny).toBe('your task waits for a decision; stop now: you are resumed with the answer')
  })
  test('tester: /x/bd-a1 is not under /x/bd-a1.view; Glob /etc/* denied; Glob **/*.ts in the view allowed (call + check)', async () => {
    const h = await mk()
    expect(denied(await call(h, { tool: 'Read', agentId: 't1', file_path: '/x/bd-a1/src/a.ts' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Read', agentId: 't1', file_path: '/x/bd-a1.view/../bd-a1/src/a.ts' }))).toBe(true)
    expect(await call(h, { tool: 'Read', agentId: 't1', file_path: '/x/bd-a1.view/t.test.ts' })).toEqual({ ok: 'Read' })
    expect(await call(h, { tool: 'Write', agentId: 't1', file_path: '/x/bd-a1.view/tests/deeper/new.test.ts' })).toEqual({ ok: 'Write' })   // a new folder under the view is placed by its deepest existing ancestor (live: rust 'cannot place the path')
    expect(denied(await call(h, { tool: 'Write', agentId: 't1', file_path: '/x/bd-a1.view/tests/../../bd-a1/src/new.ts' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Glob', agentId: 't1', pattern: '/etc/*' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Glob', agentId: 't1', pattern: '**/*.ts' }))).toBe(true)   // not a tester tool (S45); the fence still normalizes it for tool.check
    expect(await call(h, { tool: 'mcp__cadre__report', agentId: 't1' })).toEqual({ ok: 'mcp__cadre__report' })   // the tester's own report tool is not fenced (S41 live)
    expect(await check(h, { tool: 'Glob', agentId: 't1', input: { pattern: '**/*.ts' } }, () => 'engine')).toMatchObject({ decision: 'allow' })
    expect(await check(h, { tool: 'Write', agentId: 't1', input: { file_path: '/x/bd-a1.view/new.test.ts' } }, () => 'engine')).toMatchObject({ decision: 'allow' })
    expect(await check(h, { tool: 'Glob', agentId: 't1', input: { pattern: '/etc/*' } }, () => 'engine')).toBe('engine')
    expect(denied(await call(h, { tool: 'Bash', agentId: 't1' }))).toBe(true)
  })
  test('tool.check allow covers Read inside the agent\'s own tree only (S26); main and other trees go to the engine', async () => {
    const h = await mk()
    expect(await check(h, { tool: 'Read', agentId: 'w1', input: { file_path: '/x/bd-a1/src/a.ts' } }, () => 'engine')).toMatchObject({ decision: 'allow' })
    expect(await check(h, { tool: 'Read', agentId: 'r1', input: { file_path: '/x/bd-a1/src/a.ts' } }, () => 'engine')).toMatchObject({ decision: 'allow' })
    expect(await check(h, { tool: 'Read', agentId: 'w1', input: { file_path: '/x/bd-a2/src/a.ts' } }, () => 'engine')).toBe('engine')
    expect(await check(h, { tool: 'Read', input: { file_path: '/x/bd-a1/src/a.ts' } }, () => 'engine')).toBe('engine')
  })
  test('tool.check allows the owner in its worktree, defers everything else', async () => {
    const h = await mk()
    expect(await check(h, { tool: 'Edit', agentId: 'w1', input: { file_path: '/x/bd-a1/src/b.ts' } }, () => 'engine')).toMatchObject({ decision: 'allow' })
    expect(await check(h, { tool: 'Edit', agentId: 'w1', input: { file_path: '/x/bd-a1/.git/x' } }, () => 'engine')).toBe('engine')
    expect(await check(h, { tool: 'Edit', input: { file_path: '/x/repo/a.ts' } }, () => 'engine')).toBe('engine')
  })
  test('input normalization per tool', () => {
    expect(inputPath('NotebookEdit', { notebook_path: '/a.ipynb' }, '/c')).toBe('/a.ipynb')
    expect(inputPath('Grep', {}, '/c')).toBe('/c'); expect(inputPath('Grep', { path: '/p' }, '/c')).toBe('/p')
    expect(inputPath('Glob', { pattern: '/etc/*' }, '/c')).toBe('/etc'); expect(inputPath('Glob', { pattern: '/a/b/**/*.ts' }, '/c')).toBe('/a/b')
    expect(inputPath('Glob', { pattern: '/a/b/c.ts' }, '/c')).toBe('/a/b'); expect(inputPath('Glob', { pattern: '*.ts', path: '/p' }, '/c')).toBe('/p')
  })
})

describe('judge, send, configSet', () => {
  test('judge is event-only', () => {
    expect(judge({ tool: 'Bash', dangerouslyDisableSandbox: true })).toBeTruthy()
    expect(judge({ tool: 'Bash' })).toBeTruthy(); expect(judge({ tool: 'Read' })).toBeUndefined()
    expect(judge({ tool: 'Edit', agentId: 'w', file_path: '/x/.git/HEAD' })).toBeTruthy()
  })
  test('known-id matcher goldens', () => {
    const k = new Set(['bd-a1', 'bd-a1.1', 'bd-a1.10'])
    expect(idsIn('see bd-a1.1', k)).toEqual(['bd-a1.1']); expect(idsIn('bd-a1.10 ok', k)).toEqual(['bd-a1.10'])
    expect(idsIn('done with bd-a1.', k)).toEqual(['bd-a1']); expect(idsIn('xbd-a1 bd-a1-x', k)).toEqual([]); expect(idsIn('TASK-bd-a1', k)).toEqual(['bd-a1'])
  })
  test('G7: the configured changelog.path is mod-owned like CHANGELOG.md; isProt takes it too', async () => {
    const h = await mk(); await setPolicy(h, { changelog: 'docs/CHANGES.md' })
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a1/docs/CHANGES.md' }))).toBe(true)
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/x/bd-a1/src/CHANGES.md' }))).toBe(false)
    expect(isProt('docs/CHANGES.md')).toBe(false); expect(isProt('docs/CHANGES.md', 'docs/CHANGES.md')).toBe(true); expect(isProt('CHANGELOG.md')).toBe(true)
  })
  test('G6a: re-entry spawn judged from the event: a task marker is refused, marker-less passes', () => {
    expect(judgeSpawn({ prompt: 'implement TASK-bd-a1' })).toMatch(/refused/); expect(judgeSpawn({ prompt: 'do bd-a7 now' })).toMatch(/refused/)
    expect(judgeSpawn({ prompt: 'where is the login code?' })).toBeUndefined()
  })
  test('SendMessage naming another id is not delivered', async () => {
    const h = await mk()
    expect(await send(h, { agentId: 'w1', to: 'r1', text: 'also look at bd-a2' }, () => 'sent')).toMatchObject({ isDelivered: false })
    expect(await send(h, { agentId: 'w1', to: 'r1', text: 'bd-a1 is fine' }, () => 'sent')).toBe('sent')
    expect(await send(h, { to: 'main', text: 'bd-a2' }, () => 'sent')).toBe('sent')
  })
  test('strictness change refused while tasks run', async () => {
    const h = await mk()
    expect(await configSet(h, { key: 'cadre.strictness', value: 'advisory', previous: 'strict' }, () => 'ok')).toMatchObject({ deny: expect.any(String) })
    expect(await configSet(h, { key: 'theme', value: 'x', previous: 'y' }, () => 'ok')).toBe('ok')
    await h.board.update(s => ({ ...s, tasks: [] }))
    expect(await configSet(h, { key: 'cadre.strictness', value: 'advisory', previous: 'strict' }, () => 'ok')).toBe('ok')
  })
})

describe('round 1 fixes (ADR 0006)', () => {
  test('H4/sec-H1: a bound subagent writes only inside its own worktree (+ $TMPDIR); tool.check never auto-allows elsewhere', async () => {
    const h = await mk()
    for (const file_path of ['/etc/passwd', '/hm/u/.bashrc']) {
      expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path }))).toBe(true)
      expect(await check(h, { tool: 'Write', agentId: 'w1', input: { file_path } }, next)).toEqual({ ok: 'Write' })   // engine decides (prompt), no allow
    }
    expect(denied(await call(h, { tool: 'Write', agentId: 'w1', file_path: '/tmp/scratch.txt' }))).toBe(false)
    expect(await check(h, { tool: 'Write', agentId: 'w1', input: { file_path: '/tmp/scratch.txt' } }, next)).toEqual({ ok: 'Write' })
    expect(await check(h, { tool: 'Edit', agentId: 'w1', input: { file_path: '/x/bd-a1/src/b.ts' } }, next)).toMatchObject({ decision: 'allow' })
  })
  test('M10: strictness comes from the resolved config', async () => {
    const h = await mk(); (h as any).config = async () => ({ strictness: 'advisory' })
    expect(await call(h, { tool: 'Bash', command: 'ls' })).toEqual({ ok: 'Bash' })
  })
  test('sec-L1: re-entry judge refuses shells and foreign tools for an agent', () => {
    expect(judge({ tool: 'Bash', agentId: 'w1' })).toMatch(/not available/); expect(judge({ tool: 'mcp__x__y', agentId: 'w1' })).toMatch(/not available/)
    expect(judge({ tool: 'Read', agentId: 'w1' })).toBeUndefined()
  })
  test('M13: realRoot resolves the deepest existing ancestor (symlinked ~/.cache)', async () => {
    const h = fakeHost(); h.stat = async (p, o) => (p === '/hm/u/.cache' ? { kind: 'dir', realPath: o?.resolve ? '/data/cache' : undefined } : undefined)
    expect(await realRoot(h, '/hm/u/.cache/cadre/wt')).toBe('/data/cache/cadre/wt')
  })
})
