import { describe, expect, test } from 'claude-code/testing'
import { UI, prune, checkpoint, compact, drain, drive, goal, queueResume, rehydrate, step, submit, tick } from '../core/reuse'
import { wrap } from '../core/effect'
import { ROUTES } from '../core/dispatch'
import { pushDelta } from '../core/briefs'
import { emit } from '../core/events'
import { viewHash } from '../core/board'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { defaults as types } from '../task-management/registry'
import { fakeHost, task } from './support'
import { repoKeyOf } from '../commands/init'
import type { Binding } from '../types'
import { guard, setPolicy } from '../policy/guards'
import { controlOf } from '../task-management/sync-engine/loop'

const B = (taskId: string, sessionId: string, o: Partial<Binding> = {}): Binding => ({ taskId, role: 'worker', step: 'worker', worktree: `/wt/${taskId}`, sessionId, ctxTokens: 1000, startedAt: 1000, ...o })
// a host with a memory store, config, a recording sender/submitter and a scripted git (clean tree unless `dirty`)
async function mk(o: { session?: string; usd?: number; pct?: number; dirty?: string[]; cfg?: (c: any) => void; journal?: boolean } = {}) {
  const h = fakeHost() as any, store = new MemoryStore(() => 1000), sent: [string, string][] = [], submitted: string[] = [], order: string[] = [], runs: string[][] = []
  await store.init({ types: types(), journal: !!o.journal })
  const epic = await store.createEpic('auth', 'goal'), a = await store.createDraft({ title: 'login', description: 'd', type: 'feature', parent: epic }), b = await store.createDraft({ title: 'logout', description: 'd', type: 'feature', parent: epic })
  await store.approve([a.id, b.id]); await store.claim(a.id, 'me')
  const cfg = defaults(); o.cfg?.(cfg)
  Object.assign(h, {
    taskStore: async () => store, config: async () => cfg,
    sendTo: async (id: string, text: string) => { order.push('send'); sent.push([id, text]); return { isDelivered: true } },
    submit: async (t: string) => { order.push('submit'); submitted.push(t) },
    usage: async () => ({ context: { percent: o.pct ?? 10 }, cost: { usd: o.usd ?? 1 } }),
    run: async (argv: string[]) => { runs.push(argv); const s = argv.join(' '); return { exitCode: s.includes('diff --cached --quiet') && o.dirty?.length ? 1 : 0, stdout: s.includes('status --porcelain') ? (o.dirty ?? []).map(p => ` M ${p}\0`).join('') : s.includes('rev-parse') ? 'abc1234' : '', stderr: '' } },
  })
  await h.secret.update((s: any) => ({ ...s, session: o.session ?? 'S1' }))
  await h.board.update((s: any) => ({ ...s, seq: 5, epic, plan: { id: epic, slug: 'auth', state: 'approved', epicBranch: 'epic/auth' }, tasks: [task(a.id, { state: 'active', step: 'worker', owner: 'me' }), task(b.id)] }))
  return { h, store, epic, a: a.id, b: b.id, sent, submitted, order, runs, cfg }
}
const turn = (h: any, e: any, order: string[] = []) => drain(h, e, async () => { order.push('next'); return { text: 'done' } })

describe('resume queue + drain (#1, 4.4)', () => {
  test('queued resumes go out only after next, only for this session; other sessions\' entries stay (S31-style)', async () => {
    const { h, a, b, sent, order } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1'), ag2: B(b, 'S2') }))
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'rework: fix S2' })
    await queueResume(h, { agentId: 'ag2', taskId: b, text: 'for the other session' })
    expect((await h.board.read()).resumesQueued).toBe(1)
    await turn(h, { reason: 'answer' }, order)
    expect(order).toEqual(['next', 'send']); expect(sent).toEqual([['ag1', 'rework: fix S2']])
    const left = await h.store.get(`cadre:${repoKeyOf('/repo')}:resumes`)
    expect(left.map((x: any) => x.agentId)).toEqual(['ag2'])
    expect((await h.board.read()).resumesQueued).toBe(0)
    await turn(h, { reason: 'answer', agentId: 'ag1' }); expect(sent.length).toBe(1)   // drained once: no loop
  })
  test('one entry per agent (texts merge); a resume to another task is refused; deltas ride the resume', async () => {
    const { h, a, b, sent } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1') }))
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'one' }); await queueResume(h, { agentId: 'ag1', taskId: a, text: 'two' }); await queueResume(h, { agentId: 'ag1', taskId: b, text: 'x' })
    await pushDelta(h, 'ag1', 'dep bd-0 closed')
    await turn(h, { reason: 'answer' })
    expect(sent).toEqual([['ag1', 'one\n\ntwo\n\ndep bd-0 closed']]); expect(h.logs.join()).toContain('refused')
  })
  test('fresh instead of resume: over maxContextPct or undelivered -> retired (admission rebinds), nothing sent; stale lease -> dropped', async () => {
    const { h, a, b, sent, store } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1', { ctxTokens: 150_000 }), ag2: B(b, 'S1') }))
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'r' }); await queueResume(h, { agentId: 'ag2', taskId: b, text: 'r' })
    await turn(h, { reason: 'answer' })
    expect(sent).toEqual([]); expect((await h.bind.read()).ag1.retired).toBe(true); expect(h.toasts.join()).toContain(`spawn TASK-${a}`)
    expect((await h.bind.read()).ag2.retired).toBeUndefined()   // b has no lease: dropped, not retired
    expect(leaseOk(await store.get(a))).toBe(true)
  })
})
const leaseOk = (t: any) => !!t.leaseUntil

describe('checkpoints (8.4) and cost ledger (7)', () => {
  test('worker turn.complete: dirty tree -> wip commit + cadre.checkpoint; dirty locked path -> refused + locked-dirty', async () => {
    const one = await mk({ dirty: ['src/a.ts'] })
    expect(await checkpoint(one.h, one.store, 'me', one.a, '/wt/x')).toBe('abc1234')
    expect(one.runs.some(r => r.join(' ').includes(`wip(${one.a}): checkpoint`))).toBe(true); expect((await one.store.get(one.a)).meta['cadre.checkpoint']).toBe('abc1234')
    const two = await mk({ dirty: ['tests/a.test.ts'] })
    await setPolicy(two.h, { locks: { [two.a]: ['tests/a.test.ts'] } })
    expect(await checkpoint(two.h, two.store, 'me', two.a, '/wt/x')).toBe(null)
    expect((await two.h.board.read()).tasks[0].flags).toContain('locked-dirty'); expect(two.runs.some(r => r.includes('commit'))).toBe(false)
  })
  test('turn.step usage per agent -> binding ctx; its turn.complete overwrites cadre.cost on the task; main mirrors usd/cache/ctx', async () => {
    const { h, a, store } = await mk({ pct: 34, usd: 3.5 })
    await h.bind.update(() => ({ ag1: B(a, 'S1') }))
    const run = async (agentId?: string) => { const g = step(h, { agentId }, async function* () { return { usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'claude-sonnet' } } } as any); let r = await g.next(); while (!r.done) r = await g.next(); return r.value }
    expect((await run('ag1')).usage.input_tokens).toBe(100)
    expect((await h.bind.read()).ag1.ctxTokens).toBe(1000)
    await turn(h, { reason: 'answer', agentId: 'ag1' })
    expect(JSON.parse((await store.get(a)).meta['cadre.cost'])).toEqual({ tokens: 240, cachePct: 90 })
    await turn(h, { reason: 'answer' })
    expect((await h.board.read()).cost).toEqual({ tokens: 240, cachePct: 90, usd: 3.5 }); expect((await h.ui.read()).ctx).toBe(34)
  })
})

describe('compaction (8.3, S49) and rehydrate (8.2, 13.4)', () => {
  test('main: answered {messages:[card, ...recent]} with toolUses:[] and no next; the card counts as sent', async () => {
    const { h } = await mk()
    let called = false
    const msgs = [{ role: 'user', text: 'old', toolUses: [] }, { role: 'assistant', text: 'x', toolUses: [{}] }, { role: 'user', text: '', toolUses: [], toolResults: [{}] }, { role: 'user', text: 'last ask', toolUses: [], handle: 'h9' }]
    const r = await compact(h, { trigger: 'manual', messages: msgs }, () => { called = true })
    expect(called).toBe(false)
    expect(r.messages[0]).toMatchObject({ role: 'user', toolUses: [] }); expect(r.messages[0].text).toContain('cadre resume card')
    expect(r.messages.slice(1).map((m: any) => m.text)).toEqual(['old', 'x', '', 'last ask'])
    expect((await h.secret.read()).ctx.key).toBe(viewHash(await h.board.read()))
  })
  test('agent: next with instructions keeping the task; no plan: next as is', async () => {
    const { h, a } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1') }))
    expect((await compact(h, { agentId: 'ag1', messages: [] }, (e: any) => e)).instructions).toContain(`task ${a}`)
    const bare = fakeHost(); expect(await compact(bare, { messages: [] }, () => 'engine')).toBe('engine')
  })
  const cleared = async (h: any) => {   // a /clear: fresh $.state and session id, same $.store and beads
    const f = fakeHost() as any; Object.assign(f, { taskStore: h.taskStore, config: h.config, usage: h.usage, submit: h.submit })
    for (const k of ['board', 'resumes']) f.store.set(`cadre:${repoKeyOf('/repo')}:${k}`, await h.store.get(`cadre:${repoKeyOf('/repo')}:${k}`))
    return f
  }
  test('after /clear: pointer + live bindings come back, card queued once, banner called; drive continues with its lease moved to the new session', async () => {
    const { h, a, epic, submitted } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1'), ag9: B('gone', 'S1') }))
    await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    await turn(h, { reason: 'answer' })   // drives once and saves the pointer
    const banner: any[] = []; UI.banner = async (_h, o) => { banner.push(o) }
    const fresh = await cleared(h)
    expect(await rehydrate(fresh)).toBe(true)
    const s = await fresh.board.read()
    expect(s.epic).toBe(epic); expect(s.tasks.map((t: any) => t.id)).toContain(a); expect(s.seq > 0).toBe(true); expect(s.drive).toMatchObject({ on: true, turns: 1 })
    expect(Object.keys(await fresh.bind.read())).toEqual(['ag1']); expect(banner[0].stale).toBe(1)
    expect((await fresh.secret.read()).ctx.card).toContain('cadre resume card'); expect(fresh.toasts.join()).toContain('/goal')
    await turn(fresh, { reason: 'answer' }); expect(submitted.length).toBe(2)   // the new session holds the lease and drives on
    expect(await rehydrate(fresh)).toBe(false)   // once
    UI.banner = undefined
  })
  test('M1: a background agent\'s turn.complete (not main prompt.submit) rehydrates the cold board and its bindings', async () => {
    const { h, a, epic } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1') }))
    await turn(h, { reason: 'answer' })   // main: saves the pointer
    const fresh = await cleared(h)
    expect((await fresh.board.read()).epic).toBeNull()
    await turn(fresh, { reason: 'answer', agentId: 'ag1' })
    expect((await fresh.board.read()).epic).toBe(epic); expect(Object.keys(await fresh.bind.read())).toEqual(['ag1'])
  })
  test('cold board, no pointer: adopts the unfinished epic with an approved child (once); drafts-only epics and missions are not adopted', async () => {
    const { h, store, epic, a } = await mk()
    const f = fakeHost() as any; Object.assign(f, { taskStore: h.taskStore, config: h.config, usage: h.usage, submit: h.submit })   // no pointer in f.store
    expect(await rehydrate(f)).toBe(true)
    const s = await f.board.read()
    expect(s.epic).toBe(epic); expect(s.plan).toMatchObject({ id: epic, slug: 'auth', state: 'approved', epicBranch: `epic/${epic}-auth` }); expect(s.tasks.map((t: any) => t.id)).toContain(a)
    const g = fakeHost() as any; Object.assign(g, { taskStore: async () => { const m = new MemoryStore(() => 1000); await m.init({ types: types(), journal: false }); const e = await m.createEpic('x', 'g'); await m.createDraft({ title: 't', description: 'd', type: 'feature', parent: e }); return m }, config: h.config, usage: h.usage, submit: h.submit })
    expect(await rehydrate(g)).toBe(false); expect((await g.board.read()).epic).toBeNull()
    const m = fakeHost() as any, ms = new MemoryStore(() => 1000); await ms.init({ types: types(), journal: false }); await ms.record('mission', 'Ship it', 'goal')
    Object.assign(m, { taskStore: async () => ms, config: h.config, usage: h.usage, submit: h.submit })
    expect(await rehydrate(m)).toBe(false); expect((await m.board.read()).mission).toBe('Ship it')   // a recorded mission survives into a cold session
    void store
  })
  test('ring rebuilt from the journal (transitions) + at-stamped records (phases), fresh seqs; adapters reset; records-only without a journal', async () => {
    const one = await mk({ journal: true, cfg: c => { c.adapters = { pm: {} } } })
    await one.store.setMeta(one.a, { 'cadre.rec.report': `[cadre:report v1] ${one.a} @5000 by worker\ncommit: abc` }, 'me')
    await turn(one.h, { reason: 'answer' })
    const f = await cleared(one.h); await f.store.set('deliver:pm', { acked: 40, init: true })
    await rehydrate(f)
    const evs = (await f.events.read()).epics[one.epic]
    expect(evs.map((e: any) => e.seq)).toEqual(evs.map((_: any, i: number) => i + 1))
    expect(evs.filter((e: any) => e.type === 'task.transitioned' && e.taskId === one.a).map((e: any) => `${e.data.from}>${e.data.to}`)).toEqual(['draft>todo', 'todo>active'])
    expect(evs.find((e: any) => e.type === 'task.phase_changed')).toMatchObject({ at: 5000, data: { taskId: one.a, from: 'worker', to: 'reviewer' } })
    expect(await f.store.get('deliver:pm')).toEqual({ acked: 40, init: false })
    const two = await mk()
    await two.store.setMeta(two.a, { 'cadre.rec.report': `[cadre:report v1] ${two.a} @5000 by worker` }, 'me')
    await turn(two.h, { reason: 'answer' }); const g = await cleared(two.h); await rehydrate(g)
    expect((await g.events.read()).epics[two.epic].map((e: any) => e.type)).toEqual(['task.phase_changed', 'task.transitioned'])
  })
})

describe('drive (9)', () => {
  test('/cadre drive on arms without submitting; the first submit comes from #1 after next; a timer tick never submits', async () => {
    const { h, submitted, order } = await mk()
    expect((await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })).text).toContain('armed')
    expect(submitted).toEqual([])
    await tick(h); expect(submitted).toEqual([])
    await turn(h, { reason: 'answer' }, order)
    expect(order).toEqual(['next', 'submit']); expect(submitted[0]).toMatch(/^cadre drive: /); expect((await h.board.read()).drive.turns).toBe(1)
  })
  test('pauses at a human gate (blocked task) and resumes when it clears; agent turns never drive', async () => {
    const { h, a, submitted } = await mk()
    await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'blocked' } : t)) }))
    await turn(h, { reason: 'answer' })
    expect((await h.board.read()).drive.paused).toBe(`blocked ${a}`); expect(submitted).toEqual([])
    expect((await h.events.read()).epics[(await h.board.read()).epic].some((e: any) => e.type === 'drive.status' && e.data.state === 'paused')).toBe(true)
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'active' } : t)) }))
    await turn(h, { reason: 'answer', agentId: 'x' }); expect(submitted).toEqual([])
    await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.paused).toBeUndefined(); expect(submitted.length).toBe(1)
  })
  test('bounds: USD over maxCostUsd pauses (stays paused until re-armed); no progress in N driven turns pauses', async () => {
    const one = await mk({ usd: 1 })
    await ROUTES.drive(one.h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    one.h.usage = async () => ({ cost: { usd: 30 } })
    await turn(one.h, { reason: 'answer' })
    expect((await one.h.board.read()).drive.paused).toMatch(/^cost \$29/); expect(one.submitted).toEqual([])
    await turn(one.h, { reason: 'answer' }); expect(one.submitted).toEqual([])
    const two = await mk(); two.cfg.drive.noProgressTurns = 2
    await ROUTES.drive(two.h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    for (let i = 0; i < 4; i++) await turn(two.h, { reason: 'answer' })
    expect((await two.h.board.read()).drive.paused).toMatch(/^no progress/); expect(two.submitted.length).toBe(2)
  })
  test('lease in beads: another session holding a live lease is refused and never drives', async () => {
    const { h, store, epic, submitted } = await mk({ session: 'S1' })
    await store.setMeta(await controlOf(h, store), { 'cadre.drive': JSON.stringify({ on: true, level: 'epic', epicId: epic, turns: 0, usd0: 0, startedAt: 1000, lastSeq: 0, idle: 0, lease: { session: 'S2', until: 9e15 } }) }, 'x')
    expect((await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })).text).toBe('refused: drive: held by S2')
    await h.board.update((s: any) => ({ ...s, drive: { ...s.drive, on: true } }))
    await turn(h, { reason: 'answer' })
    expect(submitted).toEqual([]); expect((await h.board.read()).drive.heldBy).toBe('S2')
  })
  test('/goal observed on command.run and on prompt.submit text: drive pauses; /goal clear lifts it; the command passes untouched', async () => {
    const { h, submitted } = await mk()
    await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    expect(await goal(h, { command: 'goal', args: 'tests pass' }, (e: any) => ({ text: `engine ${e.args}` }))).toEqual({ text: 'engine tests pass' })
    expect((await h.board.read()).drive.paused).toBe('two loop owners: /goal active')
    await turn(h, { reason: 'answer' }); expect(submitted).toEqual([])
    await submit(h, { text: '/goal clear', origin: { kind: 'sdk' } }, (e: any) => e)
    expect((await h.board.read()).drive.paused).toBeUndefined()
    await submit(h, { text: '/goal ship it', origin: { kind: 'sdk' } }, (e: any) => e)
    expect((await h.board.read()).drive.paused).toBe('two loop owners: /goal active')
  })
})

describe('result card paths (6.4, S39, S40)', () => {
  test('foreground Agent call: content[0].text replaced by the task card; ui.mapCard records the row', async () => {
    const { h, a } = await mk()
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, card: `TASK ${a} worker → review\nnext: spawn reviewer` } : t)) }))
    const maps: string[] = []; UI.mapCard = async (_h, tu, id) => { maps.push(`${tu}=${id}`) }
    const r = await wrap(h, { tool: 'Agent', tool_use_id: 'tu1', prompt: `do TASK-${a}` }, () => ({ result: { content: [{ type: 'text', text: 'raw answer' }, { type: 'text', text: 'agentId: x' }] } }))
    expect(r.result.content.map((c: any) => c.text)).toEqual([`TASK ${a} worker → review · next: spawn reviewer`, 'agentId: x']); expect(maps).toEqual([`tu1=${a}`])
    UI.mapCard = undefined
  })
  test('foreground Agent call whose agent never reported (the step did not move): the card says end your turn, do not respawn', async () => {
    const { h, a } = await mk()   // a is active at step worker; ag1 is its worker
    await h.bind.update(() => ({ ag1: B(a, 'S1') }))
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, card: `TASK ${a} tester → worker\nnext: spawn worker` } : t)) }))
    const r = await wrap(h, { tool: 'Agent', prompt: `do TASK-${a}` }, () => ({ result: { content: [{ type: 'text', text: 'raw\nagentId: ag1 (use SendMessage)' }] } }))
    expect(r.result.content[0].text).toContain('end your turn: the worker stopped without reporting')
  })
  test('background notification: prompt.submit origin task-notification rewritten to the card (agent found via the agent.bound ring)', async () => {
    const { h, a } = await mk()
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, card: 'CARD' } : t)) }))
    await emit(h, 'agent.bound', { agentId: 'ag7', taskId: a, role: 'worker' }, { agentId: 'ag7', taskId: a })
    const r = await submit(h, { text: '<task-notification>\n<task-id>ag7</task-id>\n<tool-use-id>tu9</tool-use-id>\n<result>long</result>', origin: { kind: 'task-notification' } }, (e: any) => e)
    expect(r.text).toBe('cadre result card (agent ag7): CARD')
    expect((await submit(h, { text: 'hello', origin: { kind: 'composer' } }, (e: any) => e)).text).toBe('hello')
  })
  test('agent calls: deltas drained into context; tester calls logged for the view audit', async () => {
    const { h, a } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1'), t1: B(a, 'S1', { role: 'tester', worktree: '/v' }) }))
    await pushDelta(h, 'ag1', 'decision: use bcrypt')
    expect(await wrap(h, { tool: 'Read', agentId: 'ag1', file_path: '/wt/x' }, () => ({ result: 'ok' }))).toEqual({ result: 'ok', context: ['decision: use bcrypt'] })
    await wrap(h, { tool: 'Read', agentId: 't1', input: { file_path: '/v/t.test.ts' } }, () => ({ result: 'ok' }))
    expect(await h.store.get('cadre:tlog:t1')).toEqual([{ tool: 'Read', path: '/v/t.test.ts', outcome: 'ok' }])
  })
})


describe('tdd author:same (3.5)', () => {
  test('red -> worker: the tester-step agent is re-stepped and resumed with the worker brief at the next drain', async () => {
    const { h, a, sent } = await mk()
    await h.bind.update(() => ({ ag1: B(a, 'S1', { step: 'tester' }), ag2: B(a, 'S1', { role: 'reviewer', step: 'reviewer' }) }))
    await emit(h, 'task.phase_changed', { taskId: a, from: 'red', to: 'worker' }, { taskId: a })
    expect((await h.bind.read()).ag1.step).toBe('worker'); expect(sent).toEqual([])
    await turn(h, { reason: 'answer' })
    expect(sent.map(x => x[0])).toEqual(['ag1']); expect(sent[0][1]).toContain(`# TASK-${a} login (feature)`)
    await emit(h, 'task.phase_changed', { taskId: a, from: 'worker', to: 'reviewer' }, { taskId: a }); await turn(h, { reason: 'answer' }); expect(sent.length).toBe(1)
  })
})

describe('drive done / plan flags (9)', () => {
  test('integration-failed on the plan pauses; plan.landed finishes drive with the /clear hint past clearHintPct', async () => {
    const { h, submitted } = await mk({ pct: 55 })
    await ROUTES.drive(h, { schemaVersion: 1, cmd: 'drive', args: ['on'], origin: { kind: 'composer' } })
    await h.board.update((s: any) => ({ ...s, plan: { ...s.plan, flags: ['integration-failed'] } }))
    await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.paused).toBe('resolve integration-failed'); expect(submitted).toEqual([])
    await h.board.update((s: any) => ({ ...s, plan: { ...s.plan, flags: [], state: 'done-on-dev', landed: { dev: 'dev', sha: 'abc', at: 1 } } }))
    await turn(h, { reason: 'answer' })
    expect((await h.board.read()).drive.on).toBe(false); expect(submitted).toEqual([]); expect(h.toasts.join()).toContain('/clear for a fresh main')
  })
})

describe('round 2: effort, pruning, tester deny log', () => {
  test('turn.step applies roles.<role>.effort (tester profile in the tester step); default leaves the frontmatter', async () => {
    const { h, a } = await mk({ cfg: c => { c.roles.tester.effort = 'high' } })
    await h.bind.update(() => ({ t1: B(a, 'S1', { step: 'tester' }), w1: B(a, 'S1') }))
    const seen: any[] = []
    const run = async (agentId: string) => { const g = step(h, { agentId }, async function* (e: any) { seen.push(e); return { usage: null } } as any); let r = await g.next(); while (!r.done) r = await g.next() }
    await run('t1'); await run('w1')
    expect(seen[0].effort).toBe('high'); expect('effort' in seen[1]).toBe(false)
  })
  test('session.start pruning: stale-lease resume entries, closed/expired pointer bindings, quarantine older than 30 days', async () => {
    const { h, a, b } = await mk()
    const day = 86_400_000
    await h.bind.update(() => ({ ag1: B(a, 'S1'), ag2: B(b, 'S1') }))
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'x' }); await queueResume(h, { agentId: 'ag2', taskId: b, text: 'y' })   // a is claimed (lease live), b is not
    await h.store.set(`cadre:${repoKeyOf('/repo')}:board`, { epic: 'e', bind: await h.bind.read() })
    await h.store.set('quarantine', [{ ts: -40 * day }, { ts: -day }])
    await prune(h)
    expect(((await h.store.get(`cadre:${repoKeyOf('/repo')}:resumes`)) as any[]).map(x => x.agentId)).toEqual(['ag1'])
    expect(Object.keys(((await h.store.get(`cadre:${repoKeyOf('/repo')}:board`)) as any).bind)).toEqual(['ag1'])
    expect(await h.store.get('quarantine')).toEqual([{ ts: -day }])
  })
  test('guards: a tester call the guards deny still reaches the view call log (3.5.2)', async () => {
    const { h, a } = await mk()
    await h.bind.update(() => ({ t1: B(a, 'S1', { role: 'tester', step: 'tester', worktree: '/v' }) }))
    const r: any = await guard(h, { tool: 'Bash', agentId: 't1', command: 'ls' }, () => ({ ok: 1 }))
    expect(typeof r.deny).toBe('string')
    expect(await h.store.get('cadre:tlog:t1')).toEqual([{ tool: 'Bash', path: undefined, outcome: r.deny }])
  })
})
