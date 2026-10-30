// ADR 0014 G: parallel tasks in one plan. Declared paths, the overlap check at draft/approve, the core lock, shared notes, the planner rules.
// The rework, refresh and watch run on real git: tests/git/close.test.mjs.
import { describe, expect, test } from 'claude-code/testing'
import { plan, world, FULL } from './fixtures/native/world'
import { validateFields, missingList, overlap } from '../core/validate'
import { guard, policyOf, setPolicy } from '../policy/guards'
import { brief } from '../core/briefs'
import { planRules } from '../core/plantools'
import { task } from './support'
import type { Binding } from '../types'
import { lockCore } from '../core/rebase'

describe('declared paths and the overlap check', () => {
  test('paths, core and notes: malformed values are refused with an example', () => {
    expect(validateFields({ paths: ['src/a.ts'], core: true })).toBeNull(); expect(validateFields({ kind: 'plan', notes: 'auth lives in src/auth' })).toBeNull()
    expect(validateFields({ paths: 'src/a.ts' })).toContain('metadata.paths'); expect(validateFields({ kind: 'plan', paths: ['x'] })).toContain('metadata.paths')
    expect(validateFields({ core: 'yes' })).toContain('metadata.core'); expect(validateFields({ notes: 'x' })).toContain('metadata.notes')
  })
  test('overlap: same file, a folder of it, a glob that matches it; different files do not', () => {
    expect(overlap('src/a.ts', 'src/a.ts')).toBe(true); expect(overlap('src/auth', 'src/auth/login.ts')).toBe(true); expect(overlap('src/**', 'src/x/y.ts')).toBe(true); expect(overlap('test/*.ts', 'test/a.ts')).toBe(true)
    expect(overlap('src/a.ts', 'src/b.ts')).toBe(false); expect(overlap('src/auth', 'src/authz/x.ts')).toBe(false)
  })
  test('two code tasks: each needs paths; an overlap without a dependency sends the draft back; a blocks dependency (or a core task first) makes it approvable', async () => {
    const w = await world(), { plan: p, task: a } = await plan(w)
    const b = (await w.call('TaskCreate', { subject: 'Logout', description: 'd', metadata: { ...FULL, paths: ['src/login.ts', 'src/logout.ts'] } })).result.task.id
    const r = await w.call('TaskCreate', { subject: 'Docs', description: 'd', metadata: { ...FULL, type: 'docs', paths: undefined } })
    expect(r.context.at(-1)).toContain(`${r.result.task.id}: paths`)
    await w.call('TaskUpdate', { taskId: r.result.task.id, metadata: { paths: ['docs/auth.md'] } })
    expect(await w.text({ cmd: 'approve', args: [p] })).toEqual({ text: `refused: incomplete, missing: ${a}+${b} both change src/login.ts: move it into one core task or add a blocks dependency` })
    await w.call('TaskUpdate', { taskId: b, addBlockedBy: [a] }); expect((await w.h.board.read()).approval.missing).toEqual([])
  })
  test('one code task (and a spike) needs no paths', () => {
    const t = (id: string, type: string, meta: Record<string, string> = {}) => ({ id, title: id, description: 'd', type, deps: [], labels: [], meta: { 'cadre.lane': 'lite', 'cadre.changelog': '{}', ...meta } }) as any
    expect(missingList([t('a', 'bug'), t('s', 'spike')])).toEqual([])
  })
})

describe('the core lands first; its files are locked for the others', () => {
  const b = (taskId: string, worktree: string): Binding => ({ taskId, role: 'worker', step: 'worker', worktree, sessionId: 's', ctxTokens: 0, startedAt: 0 })
  test('lockCore writes the landed core files for each running task; the fence denies an edit with the next step; others stay editable', async () => {
    const w = await world(), { h, store } = w; const { plan: p, task: a } = await plan(w)
    await store.setMeta(p, { 'cadre.corePaths': JSON.stringify(['src/core.ts']) }, 'x'); await store.setMeta(a, { 'cadre.worktree': '/x/bd-a1' }, 'x')
    await h.board.update(s => ({ ...s, epic: p, tasks: [task(a, { state: 'active', step: 'worker' })] }))
    await lockCore(h, { store } as any); expect((await policyOf(h)).core).toEqual({ [a]: ['/x/bd-a1/src/core.ts'] })
    await setPolicy(h, { repo: '/x/repo', wtRoot: '/x', home: '/hm/u' }); h.stat = async (q: string, o?: any) => ({ kind: 'file', realPath: o?.resolve ? q : undefined }) as any
    await h.bind.update(() => ({ w1: b(a, '/x/bd-a1') }))
    const deny = (await guard(h, { tool: 'Edit', file_path: '/x/bd-a1/src/core.ts', agentId: 'w1' }, () => ({ ok: 1 }))) as any
    expect(deny.deny).toContain('shared core that already landed'); expect(deny.deny).toContain('report outcome "blocked"')
    expect(await guard(h, { tool: 'Edit', file_path: '/x/bd-a1/src/mine.ts', agentId: 'w1' }, () => ({ ok: 1 }))).toEqual({ ok: 1 })
  })
})

describe('briefs and planner rules', () => {
  test('a worker brief carries the shared notes and the other running tasks\' paths', () => {
    const t = brief('worker', { id: 'a2', title: 'Logout', type: 'feature', shared: 'sessions live in src/session.ts', others: ['- a1: src/login.ts'] })
    expect(t).toContain('## Shared notes\nsessions live in src/session.ts'); expect(t).toContain('## Paths of other active tasks\n- a1: src/login.ts')
  })
  test('the plan rules ask for paths, a thin core first, vertical slices and one shared exploration; still within 1.5 KB', () => {
    const r = planRules()
    for (const s of ['paths per task', 'ONE thin core task first', 'vertical slice', 'smoke assertion', 'plan\'s notes']) expect(r).toContain(s)
    expect(new TextEncoder().encode(r).length).toBeLessThanOrEqual(1536)
  })
})
