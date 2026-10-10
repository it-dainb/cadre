import { describe, expect, test } from 'claude-code/testing'
import { FULL, plan, world } from './fixtures/native/world'

const code = async (w: Awaited<ReturnType<typeof world>>) => (await w.h.secret.read()).approval!.code8
const nonce = async (w: Awaited<ReturnType<typeof world>>) => (await w.h.secret.read()).nonce

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

describe('approve: plan@code8, burn on use, completeness (DESIGN 3.1)', () => {
  test('a draft change draws a new nonce and code8 (8 hex), held only in cadre.secret', async () => {
    const w = await world(); const { task } = await plan(w)
    const [n1, c1] = [await nonce(w), await code(w)]
    expect(c1).toMatch(/^[0-9a-f]{8}$/)
    await w.call('TaskUpdate', { taskId: task, subject: 'changed' })
    expect([await nonce(w) === n1, await code(w) === c1]).toEqual([false, false])
    expect(JSON.stringify(await w.h.board.read())).not.toContain(await code(w)); expect(JSON.stringify(await w.h.events.read())).not.toContain(await code(w))
  })
  test('token mismatch is refused, nothing changes, and the nonce is redrawn', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    const [n1, c1] = [await nonce(w), await code(w)]
    expect(await w.text({ cmd: 'approve', args: [`${p}@deadbeef`] })).toEqual({ text: 'refused: token mismatch: use the code on the band or in the pane' })
    expect((await w.store.get(task)).category).toBe('draft'); expect(w.calls).toEqual([])
    expect([await nonce(w) === n1, await code(w) === c1]).toEqual([false, false])
  })
  test('burn on use: the accepted code is dead afterwards, and a refused attempt kills the live code', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    const live = await code(w)
    await w.text({ cmd: 'approve', args: [`${p}@nope0000`] })       // refused attempt
    expect((await w.text({ cmd: 'approve', args: [`${p}@${live}`] })).text).toContain('refused: token mismatch')   // the old code no longer matches
    const fresh = await code(w)
    expect((await w.text({ cmd: 'approve', args: [`${p}@${fresh}`] })).text).toBe(`Plan ${p} approved: 1 task ready; epic branch epic/${p}-auth-login cut.`)
    expect((await w.h.secret.read()).approval).toBeUndefined()
    expect((await w.text({ cmd: 'approve', args: [`${p}@${fresh}`] })).text).toContain('refused')   // replay
  })
  test('accepted: drafts -> todo through the machine, plan approved, decision record, epic branch cut from dev (first approval only)', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    await w.text({ cmd: 'approve', args: [`${p}@${await code(w)}`] })
    const b = await w.h.board.read()
    expect(b.tasks.find(t => t.id === task)!.state).toBe('todo'); expect(b.plan).toMatchObject({ state: 'approved', approvedAt: expect.any(Number) }); expect(b.approval).toEqual({ planId: null, missing: [] })
    expect((await w.store.get(task)).category).toBe('todo')
    const dec = (await w.store.list({})).find(t => t.type === 'decision')!; expect([dec.title, dec.description]).toEqual([`Approved plan ${p}: Auth login`, `- ${task} Add login (feature)`])
    expect(w.calls.map(c => c.join(' '))).toContain(`git -C /repo rev-parse --verify epic/${p}-auth-login^{commit}`)   // cutEpic ran (branch existed in the stub)
    const ev = (await w.h.events.read()).epics[p].map(e => e.type + ':' + (e.data as any).to); expect(ev).toContain('task.transitioned:todo')
    // a second batch of drafts in the approved plan is approved without a second cut
    w.calls.length = 0
    await w.call('TaskCreate', { subject: 'More', description: '', metadata: FULL })
    expect((await w.text({ cmd: 'approve', args: [`${p}@${await code(w)}`] })).text).toBe(`Plan ${p} approved: 1 task ready.`)
    expect(w.calls).toEqual([])
  })
  test('completeness refusal lists exactly what is missing, per task, and burns', async () => {
    const w = await world(); const p = (await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })).result.task.id
    await w.call('TaskCreate', { subject: 'A', description: '', metadata: { type: 'feature', package: '.' } })
    await w.call('TaskCreate', { subject: 'B', description: '', metadata: { type: 'docs', scenarios: FULL.scenarios, package: '.' } })
    await w.call('TaskCreate', { subject: 'S', description: '', metadata: { type: 'spike' } })   // spikes need nothing
    const c1 = await code(w)
    expect(await w.text({ cmd: 'approve', args: [`${p}@${c1}`] })).toEqual({ text: 'refused: incomplete, missing: m-2: scenarios, changelog, interface; m-3: changelog' })
    expect(await code(w)).not.toBe(c1)
    expect((await w.store.list({ parent: p })).every(t => t.category === 'draft')).toBe(true)
    expect((await w.h.board.read()).approval.missing).toEqual(['m-2: scenarios, changelog, interface', 'm-3: changelog'])
  })
  test('an empty plan is not approvable (missing: tasks); a wrong plan id is refused', async () => {
    const w = await world(); const p = (await w.call('TaskCreate', { subject: 'P', description: '', metadata: { kind: 'plan' } })).result.task.id
    expect((await w.text({ cmd: 'approve', args: [`${p}@${await code(w)}`] })).text).toBe('refused: incomplete, missing: tasks')
    expect((await w.text({ cmd: 'approve', args: [`p9@${await code(w)}`] })).text).toBe('refused: no draft plan p9')
  })
  test('the code covers the drafts: an edit made after the code was shown changes it', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    const shown = await code(w)
    await w.store.update(task, { title: 'sneaky' }, 'x')      // draft edited outside Task*: code8 no longer matches the drafts
    expect((await w.text({ cmd: 'approve', args: [`${p}@${shown}`] })).text).toContain('token mismatch')
  })
  test('mission draft: approval records a mission and clears the plan', async () => {
    const w = await world(); const m = (await w.call('TaskCreate', { subject: 'Ship auth', description: 'goal, constraints', metadata: { kind: 'mission' } })).result.task.id
    expect((await w.text({ cmd: 'approve', args: [`${m}@${await code(w)}`] })).text).toBe('Mission "Ship auth" approved and recorded.')
    expect(await w.h.board.read()).toMatchObject({ mission: 'Ship auth', plan: null, epic: null })
    expect((await w.store.list({})).some(t => t.type === 'milestone')).toBe(true)
  })
  test('reject drops the drafts (and a fresh plan), records a decision', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    expect((await w.text({ cmd: 'reject', args: [p, 'not', 'now'] })).text).toBe(`Plan ${p}: 1 draft dropped.`)
    expect(await w.h.board.read()).toMatchObject({ plan: null, epic: null, tasks: [] })
    expect((await w.store.list({})).map(t => t.type)).toEqual(['decision'])
  })
})
