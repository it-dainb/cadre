import { describe, expect, test } from 'claude-code/testing'
import { MAIN, SPECS, sameTask } from '../tools/index'
import { viaEngine } from './fixtures/engine'
import { handleWith } from '../tools/index'
import { mainAgent } from '../core/plantools'
import { REPORTS, checkInput } from '../core/validate'
import { toolsRow } from '../commands/doctor'
import { scoped } from '../commands/init'
import { fakeHost } from './support'
import { decide } from '../commands/cadre'
import { FULL, world } from './fixtures/native/world'
import type { Host } from '../types'

type W = Awaited<ReturnType<typeof world>>
const tool = (w: W, name: string, input: Record<string, unknown>, agentId?: string) => viaEngine(w.h, { tool: `mcp__cadre__${name}`, tool_use_id: 'u1', ...(agentId ? { agentId } : {}), ...input }) as Promise<any>
const err = (r: any) => (typeof r.result === 'string' ? r.result : '')
const { type, package: pkg, scenarios, changelog, interface: iface, paths } = FULL
const TASK = { type, package: pkg, scenarios, changelog, interface: iface, paths }
async function planned(w: W) {
  const p = await tool(w, 'plan', { title: 'Auth login', description: 'goal', lane: 'full', reason: 'two steps' })
  const a = await tool(w, 'task', { title: 'Add login', description: 'impl', ...TASK })
  return { plan: p.result.plan as string, a: a.result.id as string }
}

describe('main tools: valid input is stored with the plan revision', () => {
  test('plan then task: a receipt {id, plan, revision, at, by} per write, revision +1, the missing line rides along', async () => {
    const w = await world()
    const p = await tool(w, 'plan', { title: 'Auth login', description: 'goal', lane: 'full', reason: 'two steps' })
    expect(p.result).toEqual({ id: 'm-1', plan: 'm-1', revision: 1, at: expect.any(Number), by: 'main' })
    const t = await tool(w, 'task', { title: 'Add login', description: 'impl', type: 'feature' })
    expect(t.result).toMatchObject({ id: 'm-2', plan: 'm-1', revision: 2 }); expect(t.context).toEqual(['missing: m-2: scenarios, changelog, interface, package'])
    expect((await w.store.get('m-1')).meta['cadre.rev']).toBe('2')
    expect((await w.h.board.read()).tasks.map(x => x.id)).toEqual(['m-2'])
  })
  test('after[]: the task waits for the named ids; amend with the current revision edits it', async () => {
    const w = await world(); const { a } = await planned(w)
    const b = await tool(w, 'task', { title: 'Add logout', description: 'impl', ...TASK, paths: ['src/logout.ts'], after: [a] })
    expect((await w.store.get(b.result.id)).deps).toEqual([{ id: a, type: 'blocks' }])
    const m = await tool(w, 'amend', { id: b.result.id, expectedRevision: b.result.revision, title: 'Add logout button' })
    expect(m.result).toMatchObject({ id: b.result.id, revision: b.result.revision + 1 }); expect((await w.store.get(b.result.id)).title).toBe('Add logout button')
  })
})

describe('refusals name the field and say how to retry; nothing is stored', () => {
  test('schema: unknown field, wrong type, a cap (rejected, never truncated), a missing required field', async () => {
    const w = await world(); await planned(w)
    const before = (await w.store.list({})).length
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', colour: 'red' }))).toBe('error: colour: unknown field (allowed: title, description, type, package, scope, breaking, scenarios, changelog, interface, paths, core, repro, holds, epic, after); remove it and call again')
    expect(err(await tool(w, 'task', { title: 5, description: 'y' }))).toBe('error: title: expected a string, got 5; fix it and call again')
    expect(err(await tool(w, 'task', { title: 'x'.repeat(201), description: 'y' }))).toBe('error: title: at most 200 characters, got 201; shorten it and call again')
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', after: Array(21).fill('m-2') }))).toContain('error: after: at most 20 items, got 21')
    expect(err(await tool(w, 'task', { description: 'y' }))).toBe('error: title: required; add it and call again')
    expect(err(await tool(w, 'amend', { id: 'm-2', expectedRevision: -1, title: 'z' }))).toBe('error: expectedRevision: at least 0, got -1; fix it and call again')
    // review 0.15 #8, #25: the nested objects are strict too (unknown keys and caps), and plan does not offer fields it always refuses
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', changelog: { category: 'Added', entry: 'e', extra: 1 } }))).toContain('error: changelog.extra: unknown field')
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', changelog: { category: 'Added', entry: 'e'.repeat(501) } }))).toContain('error: changelog.entry: at most 500 characters')
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', interface: { symbols: [{ name: 'a', kind: 'function', params: [], returns: 'v', status: 'new', note: 'x' }] } }))).toContain('error: interface.symbols[0].note: unknown field')
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', interface: { symbols: Array(51).fill({ name: 'a' }) } }))).toContain('error: interface.symbols: at most 50 items')
    expect(err(await tool(w, 'plan', { title: 'x', description: 'y', lane: 'full', reason: 'r', notes: [{ text: 't', who: 'me' }] }))).toContain('error: notes')
    expect(err(await tool(w, 'plan', { title: 'x', description: 'y', paths: ['a.ts'] }))).toContain('error: paths: unknown field')
    expect(MAIN.find(t => t.name === 'plan')!.description).toContain('how big the work is')
    expect((await w.store.list({})).length).toBe(before)
  })
  test('field rules: a malformed scenario names its index; no plan yet names the tool to call', async () => {
    const w = await world()
    expect(err(await tool(w, 'task', { title: 'x', description: 'y' }))).toBe('error: no plan yet: call plan first')
    await planned(w)
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', scenarios: ['user can log in'] }))).toContain('error: scenarios[0]: expected "S1: Given <state> When <action> Then <outcome>"')
  })
  test('graph: an unknown id and a cycle are refused before the write', async () => {
    const w = await world(); const { a } = await planned(w)
    expect(err(await tool(w, 'task', { title: 'x', description: 'y', after: ['m-9'] }))).toBe(`error: after[0]: m-9 is not a task of this plan (known: ${a}); fix it and call again`)
    const b = await tool(w, 'task', { title: 'Add logout', description: 'impl', ...TASK, paths: ['src/logout.ts'], after: [a] })
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: b.result.revision, after: [b.result.id] }))).toBe(`error: after[0]: ${b.result.id} already waits for ${a}, so this would be a cycle; drop it and call again`)
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: b.result.revision, after: [a] }))).toBe('error: after[0]: a task cannot wait for itself; remove it and call again')
    expect((await w.store.get(a)).deps).toEqual([])
  })
  test('a stale expectedRevision is refused with the current one; the retry with it passes', async () => {
    const w = await world(); const { a } = await planned(w)
    const stale = await tool(w, 'amend', { id: a, expectedRevision: 1, title: 'z' })
    expect(err(stale)).toBe('error: expectedRevision: the plan is at revision 2, not 1; check your change against it and call again with expectedRevision 2')
    expect(stale.isError).toBe(true)   // main reads a refusal as an error result (is_error), not an accepted answer
    expect((await w.store.get(a)).title).toBe('Add login')
    const ok = await tool(w, 'amend', { id: a, expectedRevision: 2, title: 'z' }); expect(ok.result.revision).toBe(3); expect(ok.isError).toBeUndefined()
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: 3 }))).toBe('error: nothing to change: give at least one field to change')
  })  // review 0.15 #9: the check, the write and the bump were three steps: another write landing after the check was overwritten unseen
  test('a write that lands between amend\'s revision check and its write: the amend is refused, nothing changes', async () => {
    const w = await world(); const { plan, a } = await planned(w), get = w.store.get.bind(w.store); let raced = false
    w.store.get = async id => { const t = await get(id); if (id === plan && !raced) { raced = true; await w.store.setMeta(plan, { 'cadre.rev': '3' }, 'main') } return t }
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: 2, title: 'z' }))).toContain('error: expectedRevision: the plan changed while you wrote')
    expect((await w.store.get(a)).title).toBe('Add login'); expect((await w.store.get(plan)).meta['cadre.rev']).toBe('3')
  })
})

describe('approval: an edit revokes it, an open question blocks it', () => {
  test('approve; an amend sends the task back to the user', async () => {
    const w = await world(); const { plan, a } = await planned(w)
    expect((await w.text({ cmd: 'approve', args: [plan] })).text).toContain('approved')
    const r = await tool(w, 'amend', { id: a, expectedRevision: 2, description: 'impl, with remember-me', reason: 'users asked', evidence: 'issue 12' })
    expect(r.result.revision).toBe(3)
    expect((await w.store.get(a)).category).toBe('draft')
    expect(err(await tool(w, 'amend', { id: plan, expectedRevision: 3, title: 'x' }))).toBe('error: id: the approved plan itself is fixed; amend its tasks')
  })
  // review 0.15 #24: the card is bound to the plan's revision, so an edit of the plan itself (not in its tasks) re-asks too
  test('an edit of the plan after its card was drawn: a press on the card the human saw is refused, the new card approves', async () => {
    const w = await world(); const { plan } = await planned(w)
    const card = async () => ((await w.h.board.read()).decisions ?? []).find(d => d.id === `plan:${plan}`)
    const seen = (await card())!; expect(seen).toBeDefined()
    expect((await tool(w, 'amend', { id: plan, expectedRevision: 2, description: 'goal, sign-up too' })).result).toMatchObject({ revision: 3 })
    expect((await decide(w.h, seen.id, 'a', seen.hash)).text).toBe('refused: it changed; review again')
    const now = (await card())!; expect(now.hash).not.toBe(seen.hash); expect((await decide(w.h, now.id, 'a', now.hash)).text).toContain('approved')
  })
  // review 0.15 #26, #29: removing an approved task, a value equal to the current one, and after[] go through the ledger like any change
  test('the ledger: removing an approved task needs reason and evidence and is recorded; an equal value is no change; after is a criterion', async () => {
    const w = await world(); const { plan, a } = await planned(w)
    const b = await tool(w, 'task', { title: 'Add logout', description: 'impl', ...TASK, paths: ['src/logout.ts'] })
    await w.text({ cmd: 'approve', args: [plan] })
    let rev = b.result.revision
    expect(err(await tool(w, 'amend', { id: b.result.id, expectedRevision: rev, remove: true }))).toContain('error: reason: required to change an approved task')
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: rev, title: 'Add login', reason: 'r', evidence: 'e' }))).toBe('error: nothing to change: every value you gave equals the current one')
    const r = await tool(w, 'amend', { id: a, expectedRevision: rev, after: [b.result.id], reason: 'logout first', evidence: 'src/a.ts:3' }); rev = r.result.revision
    expect(JSON.parse((await w.store.get(a)).meta['cadre.amendments']).map((x: any) => x.criterion)).toEqual(['after'])
    const d = await tool(w, 'amend', { id: b.result.id, expectedRevision: rev, remove: true, reason: 'not needed', evidence: 'issue 3' })
    expect(d.result).toMatchObject({ id: b.result.id }); expect(JSON.parse((await w.store.get(b.result.id)).meta['cadre.amendments'] ?? '[]')).toEqual([expect.objectContaining({ criterion: 'removed', reason: 'not needed', evidence: 'issue 3' })])
  })
  // review r2 N3: removing an approved task that an earlier amend sent back to draft closes it as deleted, recorded; it is never hard-deleted
  test('remove on an amended (back to draft) approved task: closed as deleted, both changes in the ledger, no error', async () => {
    const w = await world(); const { plan, a } = await planned(w); await w.text({ cmd: 'approve', args: [plan] })
    const r = await tool(w, 'amend', { id: a, expectedRevision: 2, description: 'impl, with remember-me', reason: 'users asked', evidence: 'issue 12' })
    expect((await w.store.get(a)).category).toBe('draft')
    expect(err(await tool(w, 'amend', { id: a, expectedRevision: r.result.revision, type: 'bug', reason: 'r', evidence: 'e' }))).toContain('type: fixed at creation')   // review r2 N4: a refused edit keeps the revision
    const d = await tool(w, 'amend', { id: a, expectedRevision: r.result.revision, remove: true, reason: 'not needed', evidence: 'issue 3' })
    expect(d.result).toMatchObject({ id: a, revision: r.result.revision + 1 })
    const t = await w.store.get(a); expect(t.category).not.toBe('draft')
    expect(JSON.parse(t.meta['cadre.amendments']).map((x: any) => x.criterion)).toEqual(['description', 'removed'])
    expect((await w.h.board.read()).decisions ?? []).toEqual([])   // review r3 N11: no approve card left for a plan with nothing to approve
  })
  test('an open question keeps the plan from approval until main records the user\'s answer', async () => {
    const w = await world(); const { plan } = await planned(w)
    const q = await tool(w, 'ask', { question: 'Keep the old session format?' })
    expect(q.result).toMatchObject({ id: 'q1', plan, revision: 3 }); expect(q.context).toEqual(['missing: open question q1 (ask the user, then answer it with ask)'])
    expect((await w.text({ cmd: 'approve', args: [plan] })).text).toContain('open question q1')
    expect(err(await tool(w, 'ask', { id: 'q1' }))).toBe('error: answer: required with id; give the user\'s answer in their words')
    expect(err(await tool(w, 'ask', { id: 'q7', answer: 'no' }))).toBe('error: id: no question q7; open: q1')
    await tool(w, 'ask', { id: 'q1', answer: 'yes, keep it' })
    expect((await w.h.board.read()).approval.missing).toEqual([])
  })
})

describe('role gate and the other tools', () => {
  test('an agent cannot call main\'s tools; main cannot report', async () => {
    const w = await world()
    for (const t of MAIN) expect(err(await tool(w, t.name, {}, 'agent-1'))).toBe(`error: ${t.name} is for the main session; finish your own step with report`)
    expect((await handleWith(w.h, {} as any, { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 's' } })).result).toBe('error: only a spawned agent reports')
  })
  test('explore queues a question for the spawner (3 at most); {id} reads an answer', async () => {
    const w = await world()
    expect((await tool(w, 'explore', { question: 'where is login handled?' })).result).toContain('An explorer starts when this turn ends')
    expect((await w.h.ui.read()).explore).toEqual(['where is login handled?'])
    await tool(w, 'explore', { question: 'b' }); await tool(w, 'explore', { question: 'c' })
    expect(err(await tool(w, 'explore', { question: 'd' }))).toContain('error: question: 3 explorers are already waiting')
    expect(err(await tool(w, 'explore', { id: 'ask-zz' }))).toBe('error: id: no explorer answer ask-zz')
    await w.h.ui.update(u => ({ ...u, asks: { 'agent-123456': { id: 'ask-123456', q: 'where?', k: 0, answer: 'src/login.ts:3' } } }))
    expect((await tool(w, 'explore', { id: 'ask-123456' })).result).toMatchObject({ id: 'ask-123456', description: 'src/login.ts:3', status: 'completed' })
  })
  test('epic: only in a milestone; a new epic needs title, goal and size', async () => {
    const w = await world(); await planned(w)
    expect(err(await tool(w, 'epic', { title: 'x', goal: 'g', size: 2 }))).toBe('error: epics belong to a milestone (plan lane "milestone"); add tasks with task')
    const v = await world(); await tool(v, 'plan', { title: 'Big', description: 'goal', lane: 'milestone', reason: 'three parts' })
    expect(err(await tool(v, 'epic', { title: 'x', goal: 'g' }))).toBe('error: size: required for a new epic; add it and call again (to change an existing epic use amend)')
    expect((await tool(v, 'epic', { title: 'Auth', goal: 'log in', size: 2, paths: ['src/auth/'] })).result).toMatchObject({ id: 'm-2', revision: 2 })
    expect((await v.store.get('m-2')).type).toBe('epic')
  })
  test('preferences: the card comes up; the choices wait for its confirm', async () => {
    const a = fakeHost() as Host; await a.secret.update(s => ({ ...s, run: { kind: 'setup' as const, at: 0, turns: 0, follow: 0, guide: 'g' } }))
    const r1: any = await viaEngine(a, { tool: 'mcp__cadre__preferences', tool_use_id: 'u', mode: 'yolo', maxTurns: 50 })
    expect(r1.result).toEqual({ preferences: 'shown to the user' }); expect((await a.board.read()).decisions?.map(d => d.id)).toEqual(['init:93']); expect((await a.ui.read())['prefs.pending']).toMatchObject({ want: { mode: 'yolo', maxTurns: 50 } })
    expect((await viaEngine(a, { tool: 'mcp__cadre__preferences', tool_use_id: 'u', maxTurns: 0 }) as any).result).toBe('error: maxTurns: expected a whole number from 1 to 10000')
  })
  test('main\'s Agent: refused toward the tools; an agent\'s own Agent call passes', () => {
    expect(mainAgent({ tool: 'Agent', prompt: 'where is login?' }, ['m-2'])).toEqual({ deny: 'plan the work with plan and task; to learn about the code or ask a critic, call explore with your question' })
    expect(mainAgent({ tool: 'Agent', prompt: 'TASK-m-2' }, ['m-2'])).toBeUndefined()   // a planned task's start (Claude starts the agents): on to admission
    expect(mainAgent({ tool: 'Agent', prompt: 'look at c-12' }, ['c-1'])?.deny).toBeDefined()   // a task id inside another id is not a planned task's start
    expect(mainAgent({ tool: 'Agent', prompt: 'run-ab12' }, [], { plugin: 'cadre' })).toBeUndefined(); expect(mainAgent({ tool: 'Agent', prompt: 'x' }, [], { plugin: 'engine' })?.deny).toBeDefined()   // cadre's spawner starts its explorers through the same chain
    expect(mainAgent({ tool: 'Agent', agentId: 'a1' }, [])).toBeUndefined(); expect(mainAgent({ tool: 'Read' }, [])).toBeUndefined()
    for (const t of ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate']) expect(mainAgent({ tool: t }, []).deny).toContain('plan with the plan tools'); expect(mainAgent({ tool: 'TaskStop' }, [])).toBeUndefined()
  })
  test('Doctor: a tool Claude Code refused is a crit row; an active repo without them this session says restart', async () => {
    const h = fakeHost()
    await h.secret.update(s => ({ ...s, tools: { on: ['report', 'plan'], refused: ['ask'] } })); expect((await toolsRow(h))[0]).toBe('crit')
    await h.secret.update(s => ({ ...s, tools: { on: ['report'], refused: [] } })); expect(await toolsRow(h)).toEqual(['warn', 'the planning tools load at Claude\'s next turn', 'send Claude any message; if they stay missing, restart Claude Code'])
    await h.secret.update(s => ({ ...s, tools: { on: ['report', 'plan'], refused: [], task: ['TaskCreate'] } })); expect(await toolsRow(h)).toEqual(['crit', 'the built-in task tools are on in this session (TaskCreate)', '/cadre init, then restart Claude Code'])
    await h.secret.update(s => ({ ...s, tools: { on: ['report', 'plan'], refused: [] } })); expect(await toolsRow(h)).toEqual(['crit', 'settings.local lacks the task-tool gate', '/cadre init'])
    await h.store.set(await scoped(h, 'settings'), { rev: 1, added: [] }); (h as any).readText = async () => JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TASKS: 'false', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } })
    expect(await toolsRow(h)).toEqual(['ok', 'cadre tools loaded'])
  })
  test('checkInput: nested items name their index', () => {
    expect(checkInput({ type: 'object', properties: { after: { type: 'array', items: { type: 'string' } } } }, { after: ['a', 2] })).toBe('after[1]: expected a string, got 2; fix it and call again')
  })
})

describe('sameTask: the brief heading reads TASK-<id>, but an id may itself begin with `task-`', () => {
  test('exact first, then the heading form; another task never matches', () => {
    expect(sameTask('c-8-1', 'c-8-1')).toBe(true); expect(sameTask('TASK-c-8-1', 'c-8-1')).toBe(true)
    expect(sameTask('task-1', 'task-1')).toBe(true); expect(sameTask('TASK-task-1', 'task-1')).toBe(true)
    expect(sameTask('c-8-2', 'c-8-1')).toBe(false); expect(sameTask('TASK-c-8-2', 'c-8-1')).toBe(false); expect(sameTask('task-1', 'c-8-1')).toBe(false); expect(sameTask(undefined, 'c-8-1')).toBe(false)
  })
})

describe('the report tool schema and the report contracts name the same fields', () => {
  test('every field a role may report is a property of the tool schema (additionalProperties is false), and the schema has no field no role accepts; shared fields agree on type', () => {
    const tool = (SPECS as any[]).find(x => x.name === 'report').inputSchema.properties as Record<string, { type?: string }>
    const per = Object.values(REPORTS()).flatMap(r => Object.entries((r as any).properties as Record<string, { type?: string }>))
    const accepted = new Set(per.map(([k]) => k))
    expect([...accepted].filter(k => !(k in tool))).toEqual([]); expect(Object.keys(tool).filter(k => !accepted.has(k))).toEqual([])
    for (const [k, v] of per) if (v.type && tool[k].type) expect([k, tool[k].type]).toEqual([k, v.type])
  })
})

describe('main is told what inspect gives it', () => {
  test('the inspect description names main\'s limit (status, files, log), so it does not ask for show or diff six times in one batch (live: leftover-pointer, 6 refusals)', () => {
    const d = (SPECS as any[]).find(x => x.name === 'inspect').description as string
    expect(d).toContain('main: status, files and log only'); expect(d).toContain('read a file with Read')
  })
})
