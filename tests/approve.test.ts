import { describe, expect, test } from 'claude-code/testing'
import '../commands/agentrun'   // registers RUN.recheck (the mission approval re-checks a running init)
import { FULL, plan, world } from './fixtures/native/world'

describe('approval sheet data (board.sheet, drawn by ui/)', () => {
  test('per draft: type, tdd, changelog, scenarios, contract with status; a changed symbol carries the prior accepted signature', async () => {
    const w = await world(); const { task } = await plan(w)
    expect(((await w.h.board.read()) as any).sheet).toEqual([{ id: task, title: 'Add login', type: 'feature', package: '.', tdd: 'required', changelog: 'Added: Login',
      scenarios: ['S1: Given a user When they log in Then a session exists'], contract: [{ sig: 'login(email: string) -> Session', status: 'new' }] }])
    const prior = await w.store.createDraft({ title: 'old', description: '', type: 'feature', parent: (await w.h.board.read()).epic!, design: JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: ['u: string'], returns: 'Session' }] }) })
    await w.store.approve([prior.id]); await w.store.close(prior.id, { outcome: 'done' })
    await w.call('TaskUpdate', { taskId: task, metadata: { interface: { symbols: [{ name: 'login', kind: 'function', params: ['email: string'], returns: 'Session', status: 'changed' }] } } })
    expect(((await w.h.board.read()) as any).sheet[0].contract).toEqual([{ sig: 'login(email: string) -> Session', status: 'changed', before: 'login(u: string) -> Session' }])
  })
})

describe('approve: bound to the decision hash, completeness (DESIGN 3.1, ADR 0012)', () => {
  test('a draft change redraws the plan decision with a new content hash; nothing secret exists', async () => {
    const w = await world(); const { task } = await plan(w)
    const hash = async () => (await w.h.board.read()).decisions!.find(d => d.id.startsWith('plan:'))!.hash
    const h1 = await hash(); expect(h1).toMatch(/^[0-9a-f]+$/)
    await w.call('TaskUpdate', { taskId: task, subject: 'changed' })
    expect(await hash()).not.toBe(h1); expect(await w.h.secret.read()).not.toHaveProperty('approval')
  })
  test('typed origins cannot approve: composer, sdk, adapter, plugin are refused and nothing changes', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    for (const kind of ['composer', 'sdk', 'adapter', 'plugin', 'bridge']) expect((await w.text({ cmd: 'approve', args: [p], origin: { kind } })).text).toContain('cannot decide')
    expect((await w.store.get(task)).category).toBe('draft'); expect(w.calls).toEqual([])
  })
  test('a replay after approval is refused (the decision is gone)', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    expect((await w.text({ cmd: 'approve', args: [p] })).text).toBe(`Plan ${p} approved: 1 task ready; epic branch epic/${p}-auth-login cut.`)
    expect((await w.text({ cmd: 'approve', args: [p] })).text).toContain('refused')
  })
  test('accepted: drafts -> todo through the machine, plan approved, decision record, epic branch cut from dev (first approval only)', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    const b = await w.h.board.read()
    expect(b.tasks.find(t => t.id === task)!.state).toBe('todo'); expect(b.plan).toMatchObject({ state: 'approved', approvedAt: expect.any(Number) }); expect(b.approval).toEqual({ planId: null, missing: [] })
    expect((await w.store.get(task)).category).toBe('todo')
    const dec = (await w.store.list({})).find(t => t.type === 'decision')!; expect([dec.title, dec.description]).toEqual([`Approved plan ${p}: Auth login`, `- ${task} Add login (feature)`])
    expect(w.calls.map(c => c.join(' '))).toContain(`git -C /repo rev-parse --verify epic/${p}-auth-login^{commit}`)   // cutEpic ran (branch existed in the stub)
    const ev = (await w.h.events.read()).epics[p].map(e => e.type + ':' + (e.data as any).to); expect(ev).toContain('task.transitioned:todo')
    // a second batch of drafts in the approved plan is approved without a second cut
    w.calls.length = 0
    await w.call('TaskCreate', { subject: 'More', description: '', metadata: FULL })
    expect((await w.text({ cmd: 'approve', args: [p] })).text).toBe(`Plan ${p} approved: 1 task ready.`)
    expect(w.calls).toEqual([])
  })
  test('completeness refusal lists exactly what is missing, per task', async () => {
    const w = await world(); const p = (await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })).result.task.id
    await w.call('TaskCreate', { subject: 'A', description: '', metadata: { type: 'feature', package: '.' } })
    await w.call('TaskCreate', { subject: 'B', description: '', metadata: { type: 'docs', scenarios: FULL.scenarios, package: '.' } })
    await w.call('TaskCreate', { subject: 'S', description: '', metadata: { type: 'spike' } })   // spikes need nothing
    expect(await w.text({ cmd: 'approve', args: [p] })).toEqual({ text: 'refused: incomplete, missing: m-2: scenarios, changelog, interface; m-3: changelog' })
    expect((await w.store.list({ parent: p })).every(t => t.category === 'draft')).toBe(true)
    expect((await w.h.board.read()).approval.missing).toEqual(['m-2: scenarios, changelog, interface', 'm-3: changelog'])
  })
  test('an empty plan is not approvable (missing: tasks); a wrong plan id is refused', async () => {
    const w = await world(); const p = (await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })).result.task.id
    expect((await w.text({ cmd: 'approve', args: [p] })).text).toBe('refused: incomplete, missing: tasks')
    expect((await w.text({ cmd: 'approve', args: ['p9'] })).text).toBe('refused: no draft plan p9')
  })
  test('the hash covers the drafts: an edit made after the card was drawn refuses the approval and redraws the card', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    const shown = (await w.h.board.read()).decisions![0].hash
    await w.store.update(task, { title: 'sneaky' }, 'x')      // draft edited outside Task*: the card no longer matches the drafts
    expect((await w.text({ cmd: 'approve', args: [p] })).text).toBe('refused: it changed; review again')
    expect((await w.h.board.read()).decisions![0].hash).not.toBe(shown)
  })
  test('mission draft: approval records a mission and clears the plan', async () => {
    const w = await world(); const m = (await w.call('TaskCreate', { subject: 'Ship auth', description: 'goal, constraints', metadata: { kind: 'mission' } })).result.task.id
    expect((await w.text({ cmd: 'approve', args: [m] })).text).toBe('Mission "Ship auth" approved and recorded.')
    expect(await w.h.board.read()).toMatchObject({ mission: 'Ship auth', plan: null, epic: null })
    expect((await w.store.list({})).some(t => t.type === 'milestone')).toBe(true)
  })
  test('init: approving the mission re-checks the running init (one line)', async () => {
    const w = await world(); await w.h.secret.update(s => ({ ...s, run: { kind: 'init', at: 0, turns: 0, follow: 0, guide: '/p/guides/init.md' } }))
    const m = (await w.call('TaskCreate', { subject: 'Ship auth', description: 'goal', metadata: { kind: 'mission' } })).result.task.id
    expect((await w.h.board.read()).decisions?.map(d => [d.title, ...d.lines].join('|'))).toEqual(['approve the mission · Ship auth|goal'])   // the card shows the mission, not "0 tasks"
    const t = (await w.text({ cmd: 'approve', args: [m] })).text
    expect(t).toStartWith('Mission "Ship auth" approved and recorded · init: '); expect(t).not.toContain('\n')
  })
  test('M12: reject on an amended plan reverts the amendment to todo; the approved task is never deleted', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [p] })
    await w.call('TaskUpdate', { taskId: task, metadata: { amend: true }, subject: 'changed' })
    expect((await w.store.get(task)).category).toBe('draft')
    await w.text({ cmd: 'reject', args: [p, 'no'] })
    expect((await w.store.get(task)).category).toBe('todo'); expect((await w.h.board.read()).tasks.map(t => [t.id, t.state])).toEqual([[task, 'todo']])
    expect((await w.h.board.read()).plan?.state).toBe('approved')
  })
  test('reject drops the drafts (and a fresh plan), records a decision', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    expect((await w.text({ cmd: 'reject', args: [p, 'not', 'now'] })).text).toBe(`Plan ${p}: 1 draft dropped.`)
    expect(await w.h.board.read()).toMatchObject({ plan: null, epic: null, tasks: [] })
    expect((await w.store.list({})).map(t => t.type)).toEqual(['decision'])
  })
})
