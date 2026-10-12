import { describe, expect, test } from 'claude-code/testing'
import { DESC, LIFECYCLE, describe as describeHook, planRules } from '../native/tasks'
import { defaults } from '../task-management/registry'
import { FULL, plan, world } from './fixtures/native/world'
import { RULES } from './fixtures/briefs-plan/rules'
import { pkgOf } from '../core/specview'

describe('plan rules + missing line (DESIGN 3.1)', () => {
  test('first plan answer: {result:{task:{id,subject}}} + context [rules, missing]; rules golden, ≤1.5 KB', async () => {
    const w = await world()
    const r = await w.call('TaskCreate', { subject: 'Auth login', description: 'goal', metadata: { kind: 'plan' } })
    expect(r).toEqual({ result: { task: { id: 'm-1', subject: 'Auth login' } }, context: [RULES, 'missing: tasks'] })
    expect(planRules(defaults())).toBe(RULES)
    expect(new TextEncoder().encode(RULES).length).toBeLessThanOrEqual(1536)
    const b = await w.h.board.read()
    expect(b.plan).toMatchObject({ id: 'm-1', slug: 'auth-login', state: 'draft', epicBranch: 'epic/m-1-auth-login' }); expect(b.approval).toEqual({ planId: 'm-1', missing: ['tasks'] })
  })
  test('later draft answers carry only the missing: line while non-empty, none when complete', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })
    const a = await w.call('TaskCreate', { subject: 'Add login', description: 'x', metadata: { type: 'feature' } })
    expect(a).toEqual({ result: { task: { id: 'm-2', subject: 'Add login' } }, context: ['missing: m-2: scenarios, changelog, interface, package'] })
    const u = await w.call('TaskUpdate', { taskId: 'm-2', metadata: { scenarios: FULL.scenarios, changelog: FULL.changelog, interface: FULL.interface, package: '.' } })
    expect(u).toEqual({ result: { success: true, taskId: 'm-2', updatedFields: ['metadata.scenarios', 'metadata.interface', 'metadata.package', 'metadata.changelog'] } })
    expect((await w.h.board.read()).approval.missing).toEqual([])
  })
  test('a task needs a plan; mission drafts carry no rules and take no tasks', async () => {
    const w = await world()
    expect(await w.call('TaskCreate', { subject: 'X', description: '' })).toEqual({ deny: 'no plan yet: first TaskCreate with metadata {"kind":"plan"}' })
    const m = await w.call('TaskCreate', { subject: 'Mission', description: 'goal', metadata: { kind: 'mission' } })
    expect(m).toEqual({ result: { task: { id: 'm-1', subject: 'Mission' } } })
    expect(await w.call('TaskCreate', { subject: 'X', description: '' })).toEqual({ deny: 'a mission draft takes no tasks; once it is approved, start a plan' })
  })
})

describe('field validation: example-bearing errors, retries ≤3', () => {
  test('malformed present fields are refused with an example; absent ones are not', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })
    expect(await w.call('TaskCreate', { subject: 'T', description: '', metadata: { scenarios: ['user can log in'] } })).toEqual({
      deny: 'metadata.scenarios[0]: expected "S1: Given <state> When <action> Then <outcome>", got "user can log in" (attempt 1/3)' })
    const t = await w.call('TaskCreate', { subject: 'T', description: '', metadata: { type: 'nope' } })
    expect(t.deny).toContain('metadata.type: expected one of feature|bug|refactor|docs|test|spike, got "nope"')
    expect((await w.call('TaskCreate', { subject: 'T', description: '', metadata: { changelog: { category: 'Nope', entry: 'x' } } })).deny).toContain('metadata.changelog: expected {"category":"Added"')
    expect((await w.call('TaskCreate', { subject: 'T', description: '', metadata: { foo: 1 } })).deny).toContain('metadata.foo: unknown field')
  })
  test('the cap: the 4th failure for one draft is refused outright and a fix is not accepted until a new draft', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })
    const bad = { subject: 'T', description: '', metadata: { package: 3 } }
    for (const n of [1, 2, 3]) expect((await w.call('TaskCreate', bad)).deny).toContain(`(attempt ${n}/3)`)
    expect((await w.call('TaskCreate', bad)).deny).toContain('retry cap 3 reached')
    expect((await w.call('TaskCreate', { subject: 'T', description: '', metadata: { package: '.' } })).deny).toContain('retry cap 3 reached')
    expect((await w.call('TaskCreate', { subject: 'U', description: '', metadata: { package: '.' } })).result.task.subject).toBe('U')
  })
})

describe('TaskUpdate: deps, refused fields, frozen fields', () => {
  test('addBlockedBy / addBlocks link drafts; a cycle is refused; the board mirrors typed deps', async () => {
    const w = await world(); const { task } = await plan(w)
    const b = (await w.call('TaskCreate', { subject: 'B', description: '', metadata: FULL })).result.task.id
    expect(await w.call('TaskUpdate', { taskId: b, addBlockedBy: [task] })).toEqual({ result: { success: true, taskId: b, updatedFields: ['blockedBy'] } })
    expect((await w.store.get(b)).deps).toEqual([{ id: task, type: 'blocks' }])
    expect((await w.h.board.read()).tasks.find(t => t.id === b)!.deps).toEqual([{ id: task, type: 'blocks' }])
    const c = await w.call('TaskUpdate', { taskId: task, addBlockedBy: [b] })
    expect(c.result.success).toBe(false); expect(c.result.error).toContain('Cycle')
    expect((await w.call('TaskUpdate', { taskId: task, addBlocks: [b] })).result.success).toBe(true)
  })
  test('owner, in_progress, cadre* metadata, unknown ids are refused with success:false', async () => {
    const w = await world(); const { task } = await plan(w)
    expect((await w.call('TaskUpdate', { taskId: task, owner: 'x' })).result).toEqual({ success: false, taskId: task, updatedFields: [], error: 'owner is set when the task\'s agent is spawned' })
    expect((await w.call('TaskUpdate', { taskId: task, status: 'in_progress' })).result.error).toContain('in_progress is set when')
    expect((await w.call('TaskUpdate', { taskId: task, metadata: { 'cadre.step': 'worker' } })).result.error).toBe('metadata.cadre*: reserved; omit it')
    expect((await w.call('TaskUpdate', { taskId: 'zz', subject: 'x' })).result).toEqual({ success: false, taskId: 'zz', updatedFields: [], error: 'no task zz' })
    expect((await w.call('TaskUpdate', { taskId: task, status: 'completed' })).result.error).toContain('does not apply to a draft')
  })
  test('an approved epic is not a draft: completed reaches the epic lifecycle', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    LIFECYCLE.completed = async () => null
    expect((await w.call('TaskUpdate', { taskId: p, status: 'completed' })).result.success).toBe(true); delete LIFECYCLE.completed
  })
  test('a draft can be deleted', async () => {
    const w = await world(); const { task } = await plan(w)
    expect((await w.call('TaskUpdate', { taskId: task, status: 'deleted' })).result.success).toBe(true)
    expect((await w.h.board.read()).tasks).toEqual([])
  })
  test('approved tasks are frozen; metadata.amend:true returns a todo to draft and the edit applies', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    expect((await w.store.get(task)).category).toBe('todo')
    const f = await w.call('TaskUpdate', { taskId: task, subject: 'new' })
    expect(f.result).toEqual({ success: false, taskId: task, updatedFields: [], error: 'approved; set metadata.amend:true to return it to draft' })
    expect((await w.call('TaskUpdate', { taskId: task, metadata: { scenarios: ['S1: Given a When b Then c'] } })).result.success).toBe(false)
    const a = await w.call('TaskUpdate', { taskId: task, subject: 'new', metadata: { amend: true } })
    expect(a.result).toEqual({ success: true, taskId: task, updatedFields: ['subject', 'metadata.amend'] })
    const t = await w.store.get(task); expect([t.category, t.title]).toEqual(['draft', 'new'])
    expect((await w.h.board.read()).tasks.find(x => x.id === task)!.state).toBe('draft')
  })
  test('completed: the close card rides the answer so main sees the squash landed', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    LIFECYCLE.completed = async () => null; await w.h.board.update(b => ({ ...b, tasks: b.tasks.map(t => ({ ...t, card: 'TASK x · review → done · commit abc1234' })) }))
    const r = await w.call('TaskUpdate', { taskId: task, status: 'completed' })
    expect(r.result.success).toBe(true); expect(JSON.stringify(r)).toContain('commit abc1234')
    delete LIFECYCLE.completed
  })
  test('amend is illegal from an active task (machine decides)', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    await w.store.claim(task, 'a'); await w.h.board.update(b => ({ ...b, tasks: b.tasks.map(t => ({ ...t, state: 'active' as const })) }))
    const r = await w.call('TaskUpdate', { taskId: task, metadata: { amend: true } })
    expect(r.result.error).toContain('amend is illegal from active')
  })
})

describe('TaskList / TaskGet from the model view, tool.describe', () => {
  test('TaskList: state as a subject prefix, native status, blockedBy only open blockers', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    const b = (await w.call('TaskCreate', { subject: 'B', description: '', metadata: FULL })).result.task.id
    await w.call('TaskUpdate', { taskId: b, addBlockedBy: [task] })
    expect((await w.call('TaskList', {})).result).toEqual({ tasks: [
      { id: task, subject: '[draft] Add login', status: 'pending', blockedBy: [] }, { id: b, subject: '[draft] B', status: 'pending', blockedBy: [task] }] })
    await w.text({ cmd: 'approve', args: [p] })
    expect((await w.call('TaskList', {})).result.tasks[0].subject).toBe('[todo] Add login')
  })
  test('TaskGet renders scenarios, contract, changelog; unknown id → {task:null}', async () => {
    const w = await world(); const { task } = await plan(w)
    const g = (await w.call('TaskGet', { taskId: task })).result.task
    expect(g).toEqual({ id: task, subject: '[draft] Add login', status: 'pending', blocks: [], blockedBy: [], description: [
      'impl', 'Scenarios:', '- S1: Given a user When they log in Then a session exists', 'Contract:',
      '- [new] login (function) (email: string) -> Session', 'Changelog: Added: Login', 'type feature · package .'].join('\n') })
    expect(await w.call('TaskGet', { taskId: 'nope' })).toEqual({ result: { task: null } })
  })
  test('describe: Task* are never deferred with tightened byte-stable descriptions; others pass through; subagents are not answered', async () => {
    for (const t of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) {
      expect(describeHook({} as any, { tool: t, description: 'orig' }, () => 'NEXT')).toEqual({ description: DESC[t], isDeferred: false })
      expect(new TextEncoder().encode(DESC[t]).length).toBeLessThan(400); expect(DESC[t]).not.toMatch(/\d{4}-|m-\d/)
    }
    expect(describeHook({} as any, { tool: 'Read', description: 'o' }, () => 'NEXT')).toBe('NEXT')
    const w = await world(); expect(await w.call('TaskCreate', { subject: 'x', description: '' }, 'agent1')).toBe('NEXT')
    expect(await w.call('Read', {})).toBe('NEXT')
  })
  test('a missing store fails closed with a deny', async () => {
    const w = await world(); delete (w.h as any).taskStore
    expect((await w.call('TaskList', {})).deny).toContain('task board unavailable')
  })
})

// live 0.9.1: an open plan blocks a new one only when someone can act on it; every refusal names that action
describe('a new plan over an open one', () => {
  const PLAN = { subject: 'Homepage', description: 'goal', metadata: { kind: 'plan' } }
  test('a draft the store does not have (a stale pointer): the board lets go and the new plan starts', async () => {
    const w = await world()
    await w.h.board.update(b => ({ ...b, epic: 'dgtx-frek-32t', plan: { id: 'dgtx-frek-32t', slug: 'homepage', state: 'draft', epicBranch: '' } }))
    const r = await w.call('TaskCreate', PLAN); expect(r.result.task.id).toBe('m-1'); expect((await w.h.board.read()).plan!.id).toBe('m-1')
  })
  test('an incomplete draft (no dialog: the human never saw it): discarded, and Claude is told', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'Old', description: '', metadata: { kind: 'plan' } }); await w.call('TaskCreate', { subject: 'Half', description: 'x', metadata: { type: 'feature' } })
    const r = await w.call('TaskCreate', PLAN)
    expect(r.result.task.id).toBe('m-3'); expect(r.context[0]).toBe('The unfinished draft m-1 was discarded: the human never saw it.')
    expect((await w.store.list({})).map(t => t.id)).toEqual(['m-3'])
  })
  test('a complete draft waits in the dialog: the refusal says so; an approved plan: finish it first', async () => {
    const w = await world(), { plan: p } = await plan(w)
    expect(await w.call('TaskCreate', PLAN)).toEqual({ deny: `plan ${p} waits for the human in the dialog: ask them to approve or reject it there (press 1)` })
    await w.text({ cmd: 'approve', args: [p] })
    expect(await w.call('TaskCreate', PLAN)).toEqual({ deny: `plan ${p} is still in progress: finish it first (TaskList shows what is left); a new plan starts after it lands` })
  })
})

// live 0.9.1: a monorepo whose one package is kit/; a lite plan's task named no package and its gates found none ("no package")
describe('a task that names no package', () => {
  const d = (roots: string[]) => ({ cfg: { packages: roots.map(root => ({ root, checks: { test: ['npm', 'test'] } })) } }) as any
  test('the only package is its package; with several, the root package or none', async () => {
    expect(pkgOf(d(['kit']), { meta: {} })?.root).toBe('kit'); expect(pkgOf(d(['kit']), { meta: { 'cadre.package': '' } })?.root).toBe('kit')
    expect(pkgOf(d(['kit', 'app']), { meta: {} })).toBeUndefined(); expect(pkgOf(d(['.', 'kit']), { meta: {} })?.root).toBe('.')
    expect(pkgOf(d(['kit', 'app']), { meta: { 'cadre.package': 'app/src' } })?.root).toBe('app')
  })
})
