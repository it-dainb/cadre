import { describe, expect, test } from 'claude-code/testing'
import { compact, drain, meter, queueResume, submit } from '../core/reuse'
import { step } from '../core/lifecycle'
import { UI } from '../core/board'
import { checkpoint } from '../core/effect'
import { arm, casDrive, drive, goal } from '../core/drive'
import { prune, rehydrate, warm } from '../core/session'
import { tick } from '../core/admission'
import { wrap } from '../core/effect'
import { ROUTES } from '../core/dispatch'
import '../core/close'   // registers ROUTES.resolve
import { pushDelta } from '../core/briefs'
import { emit } from '../core/events'
import { viewHash, modelView } from '../core/board'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { defaults as types } from '../task-management/registry'
import { fakeHost, task } from './support'
import { repoKeyOf, scoped } from '../commands/init'
import type { Binding, Host } from '../types'
import { guard, setPolicy } from '../policy/guards'
import { send as guardSend } from '../policy/guards'

// agents bound as admission binds them (a run record each)
const bound = async (h: Host, m: Record<string, Binding>) => { await h.bind.update(() => ({})); for (const [a, b] of Object.entries(m)) await step(h, a, { type: 'spawn.ok', bind: b }) }
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

describe('G9 /cadre resolve accept (UI-DESIGN 5.4)', () => {
  const accept = (h: any, id: string) => ROUTES.resolve!(h, { cmd: 'resolve', args: [id, 'accept'] } as any)
  const flagged = async (h: any, id: string, flags: string[]) => h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, flags } : t)) }))
  test('conflict: accept re-applies the remote value kept in the flag record; the flag clears', async () => {
    const { h, store, a } = await mk(); await store.setMeta(a, { 'cadre.remote.title': 'Remote title', 'cadre.remote.priority': '1' }, 'sync'); await flagged(h, a, ['conflict'])
    expect((await store.get(a)).title).toBe('login'); const r = await accept(h, a)
    expect(r.text).toContain('flags cleared'); expect(await store.get(a)).toMatchObject({ title: 'Remote title', priority: 1 }); expect((await h.board.read()).tasks.find((t: any) => t.id === a).flags).toEqual([])
  })
  test('drift: accept adopts the remote status through the machine; an illegal move is refused and keeps the flag', async () => {
    const { h, store, a } = await mk(); await h.store.set(`cadre:${repoKeyOf('/repo')}:actor`, 'me'); await flagged(h, a, ['drift'])   // the claimer is this actor
    await store.setMeta(a, { 'cadre.remote.status': 'done' }, 'sync'); expect((await accept(h, a)).text).toMatch(/refused: .*illegal/)   // active·worker cannot close
    expect((await h.board.read()).tasks.find((t: any) => t.id === a).flags).toEqual(['drift'])
    await store.setMeta(a, { 'cadre.remote.status': 'blocked' }, 'sync'); expect((await accept(h, a)).text).toContain('flags cleared')
    const t = (await h.board.read()).tasks.find((x: any) => x.id === a); expect([t.state, t.flags]).toEqual(['blocked', []]); expect((await store.get(a)).category).toBe('blocked')
    await flagged(h, a, ['drift']); await store.setMeta(a, { 'cadre.remote.status': 'weird' }, 'sync'); expect((await accept(h, a)).text).toMatch(/refused: .*cannot be adopted/)
  })
})

describe('resume queue + drain (#1, 4.4)', () => {
  test('queued resumes go out only after next, only for this session; other sessions\' entries stay (S31-style)', async () => {
    const { h, a, b, sent, order } = await mk()
    await bound(h, { ag1: B(a, 'S1'), ag2: B(b, 'S2') })
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
  test('G6b: the drain\'s own resume may quote another task id (guards.send exempts it); a model send naming it is still refused; the mark is cleared', async () => {
    const { h, a, b, sent } = await mk(), pass = async () => ({ isDelivered: true })
    h.sendTo = async (id: string, text: string) => { const r = await guardSend(h, { to: id, text }, pass); if ((r as any).isDelivered) sent.push([id, text]); return r }
    await bound(h, { ag1: B(a, 'S1') })
    await queueResume(h, { agentId: 'ag1', taskId: a, text: `reviewer found: also breaks ${b}` })
    await turn(h, { reason: 'answer' })
    expect(sent).toEqual([['ag1', `reviewer found: also breaks ${b}`]]); expect((await h.ui.read()).drainTo).toBeUndefined()
    expect(await guardSend(h, { to: 'ag1', text: `look at ${b}` }, pass)).toMatchObject({ isDelivered: false })
  })
  test('one entry per agent (texts merge); a resume to another task is refused; deltas ride the resume', async () => {
    const { h, a, b, sent } = await mk()
    await bound(h, { ag1: B(a, 'S1') })
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'one' }); await queueResume(h, { agentId: 'ag1', taskId: a, text: 'two' }); await queueResume(h, { agentId: 'ag1', taskId: b, text: 'x' })
    await pushDelta(h, 'ag1', 'dep bd-0 closed')
    await turn(h, { reason: 'answer' })
    expect(sent).toEqual([['ag1', 'one\n\ntwo\n\ndep bd-0 closed']]); expect(h.logs.join()).toContain('refused')
  })
  test('fresh instead of resume: over maxContextPct or undelivered -> retired (admission rebinds), nothing sent; stale lease -> dropped', async () => {
    const { h, a, b, sent, store } = await mk()
    await bound(h, { ag1: B(a, 'S1', { ctxTokens: 150_000 }), ag2: B(b, 'S1') })
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
    await bound(h, { ag1: B(a, 'S1') })
    const run = async (agentId?: string) => { const g = meter(h, { agentId }, async function* () { return { usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'claude-sonnet' } } } as any); let r = await g.next(); while (!r.done) r = await g.next(); return r.value }
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
    expect(r.messages[0]).toMatchObject({ role: 'user', toolUses: [] }); expect(r.messages[0].text).toContain('Resume card')
    expect(r.messages.slice(1).map((m: any) => m.text)).toEqual(['old', 'x', '', 'last ask'])
    expect((await h.secret.read()).ctx.key).toBe(viewHash(await h.board.read()))
  })
  test('agent: next with instructions keeping the task; no plan: next as is', async () => {
    const { h, a } = await mk()
    await bound(h, { ag1: B(a, 'S1') })
    expect((await compact(h, { agentId: 'ag1', messages: [] }, (e: any) => e)).instructions).toContain(`task ${a}`)
    const bare = fakeHost(); expect(await compact(bare, { messages: [] }, () => 'engine')).toBe('engine')
  })
  const cleared = async (h: any) => {   // a /clear: fresh $.state and session id, same $.store and task store (the pointer and run records live in its control doc)
    const f = fakeHost() as any; Object.assign(f, { taskStore: h.taskStore, config: h.config, usage: h.usage, submit: h.submit })
    for (const k of ['resumes']) f.store.set(`cadre:${repoKeyOf('/repo')}:${k}`, await h.store.get(`cadre:${repoKeyOf('/repo')}:${k}`))
    return f
  }
  test('after /clear: pointer + live bindings come back, card queued once, banner called; drive continues with its lease moved to the new session', async () => {
    const { h, a, epic, submitted } = await mk()
    await bound(h, { ag1: B(a, 'S1'), ag9: B('gone', 'S1') })
    await arm(h, 'auto')
    await turn(h, { reason: 'answer' })   // drives once and saves the pointer
    const banner: any[] = []; UI.banner = async (_h, o) => { banner.push(o) }
    const fresh = await cleared(h)
    expect(await rehydrate(fresh)).toBe(true)
    const s = await fresh.board.read()
    expect(s.epic).toBe(epic); expect(s.tasks.map((t: any) => t.id)).toContain(a); expect(s.seq > 0).toBe(true); expect(s.drive).toMatchObject({ on: true, turns: 1 })
    expect(Object.keys(await fresh.bind.read())).toEqual(['ag1']); expect(banner[0].stale).toBe(1)
    expect((await fresh.secret.read()).ctx.card).toContain('Resume card'); expect(fresh.toasts.join()).toContain('/goal')
    await turn(fresh, { reason: 'answer' }); expect(submitted.length).toBe(2)   // the new session holds the lease and drives on
    expect(await rehydrate(fresh)).toBe(false)   // once
    UI.banner = undefined
  })
  test('M1: a background agent\'s turn.complete (not main prompt.submit) rehydrates the cold board and its bindings', async () => {
    const { h, a, epic } = await mk()
    await bound(h, { ag1: B(a, 'S1') })
    await turn(h, { reason: 'answer' })   // main: saves the pointer
    const fresh = await cleared(h)
    expect((await fresh.board.read()).epic).toBeNull()
    await turn(fresh, { reason: 'answer', agentId: 'ag1' })
    expect((await fresh.board.read()).epic).toBe(epic); expect(Object.keys(await fresh.bind.read())).toEqual(['ag1'])
  })
  test('cold board, no pointer: adopts the unfinished epic with an approved child (once); drafts-only epics and missions are not adopted', async () => {
    const { h, store, epic, a } = await mk()
    const f = fakeHost() as any; Object.assign(f, { taskStore: h.taskStore, config: h.config, usage: h.usage, submit: h.submit })   // no pointer in f.store
    const f2 = fakeHost() as any; Object.assign(f2, { taskStore: h.taskStore, config: h.config, usage: h.usage, submit: h.submit })
    await warm(f2); expect((await f2.board.read()).plan).toMatchObject({ id: epic, state: 'approved' })   // the first hook of a new session reads the rehydrated board
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
  test('cold board, no task store yet (init before stage 2): rehydrate is false and logs nothing', async () => {
    const f = fakeHost() as any, logs: string[] = []; f.log = (t: string) => { logs.push(t) }
    f.taskStore = async () => ({ list: async () => { throw new Error('the store is not initialized') } })
    expect(await rehydrate(f)).toBe(false); expect(logs).toEqual([])
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
  test('arming submits nothing; the first submit comes from #1 after next; a timer tick never submits', async () => {
    const { h, submitted, order } = await mk()
    expect(await arm(h, 'auto')).toBe('drive auto on')
    expect(submitted).toEqual([])
    await tick(h); expect(submitted).toEqual([])
    await turn(h, { reason: 'answer' }, order)
    expect(order).toEqual(['next', 'submit']); expect(submitted[0]).toMatch(/^Continue: /); expect((await h.board.read()).drive.turns).toBe(1)
  })
  test('pauses at a human gate (blocked task) and resumes when it clears; agent turns never drive', async () => {
    const { h, a, submitted } = await mk()
    await arm(h, 'auto')
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'blocked' } : t)) }))
    await turn(h, { reason: 'answer' })
    expect((await h.board.read()).drive.paused).toBe(`blocked ${a}`); expect(submitted).toEqual([])
    expect((await h.events.read()).epics[(await h.board.read()).epic].some((e: any) => e.type === 'drive.status' && e.data.state === 'paused')).toBe(true)
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'active' } : t)) }))
    await turn(h, { reason: 'answer', agentId: 'x' }); expect(submitted).toEqual([])
    await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.paused).toBeUndefined(); expect(submitted.length).toBe(1)
  })
  test('bounds: USD over maxCostUsd stops (stays stopped until resumed); no progress in N driven turns stops', async () => {
    const one = await mk({ usd: 1 })
    await arm(one.h, 'auto')
    one.h.usage = async () => ({ cost: { usd: 30 } })
    await turn(one.h, { reason: 'answer' })
    expect((await one.h.board.read()).drive.stopped).toMatch(/^cost \$29/); expect(one.submitted).toEqual([])
    await turn(one.h, { reason: 'answer' }); expect(one.submitted).toEqual([])
    const two = await mk(); two.cfg.drive.noProgressTurns = 2
    await arm(two.h, 'auto')
    for (let i = 0; i < 4; i++) await turn(two.h, { reason: 'answer' })
    expect((await two.h.board.read()).drive.stopped).toMatch(/^no progress/); expect(two.submitted.length).toBe(2)
  })
  test('G9: the USD bound survives a usage reset and /clear (deltas against a per-session baseline)', async () => {
    const { h, store, cfg, submitted } = await mk({ usd: 1, cfg: c => { c.drive.maxCostUsd = 10 } }), usage = (usd: number) => { h.usage = async () => ({ cost: { usd } }) }
    await arm(h, 'auto')
    usage(5); await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.costUsd).toBe(4)
    usage(2); await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.costUsd).toBe(6)   // usage reset to 0 then 2: +2, not -3
    await casDrive(h, store, r => r && { ...r, lease: { ...r.lease, session: 'S2' } }); await h.secret.update((s: any) => ({ ...s, session: 'S2' }))   // /clear: new session, lease moved
    usage(3); await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.costUsd).toBe(6)   // new baseline 3
    usage(9); await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.stopped).toMatch(/^cost \$12/); expect(cfg.drive.maxCostUsd).toBe(10)
  })
  test('lease in the control doc: another session holding a live lease is refused and never drives', async () => {
    const { h, store, epic, submitted } = await mk({ session: 'S1' })
    await store.setControl({ drive: { on: true, level: 'epic', epicId: epic, turns: 0, cost: 0, last: 0, sess: 'S2', startedAt: 1000, lastSeq: 0, idle: 0, lease: { session: 'S2', until: 9e15 } } })
    expect(await arm(h, 'auto')).toBe('drive is held by S2')
    await h.board.update((s: any) => ({ ...s, drive: { ...s.drive, on: true } }))
    await turn(h, { reason: 'answer' })
    expect(submitted).toEqual([]); expect((await h.board.read()).drive.heldBy).toBe('S2')
  })
  test('/goal observed on command.run and on prompt.submit text: drive pauses; /goal clear lifts it; the command passes untouched', async () => {
    const { h, submitted } = await mk()
    await arm(h, 'auto')
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
  test('foreground Agent call whose agent never reported (the step did not move): the card says wait (the mod is resuming it), do not respawn', async () => {
    const { h, a } = await mk()   // a is active at step worker; ag1 is its worker
    await bound(h, { ag1: B(a, 'S1') })
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, card: `TASK ${a} tester → worker\nnext: spawn worker` } : t)) }))
    const r = await wrap(h, { tool: 'Agent', prompt: `do TASK-${a}` }, () => ({ result: { content: [{ type: 'text', text: 'raw answer' }] } }))
    expect(r.result.content[0].text).toContain('wait: the worker is finishing its report')
  })
  test('background notification: prompt.submit origin task-notification rewritten to the card (agent found via the agent.bound ring)', async () => {
    const { h, a } = await mk()
    await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, card: 'CARD' } : t)) }))
    await emit(h, 'agent.bound', { agentId: 'ag7', taskId: a, role: 'worker' }, { agentId: 'ag7', taskId: a })
    const r = await submit(h, { text: '<task-notification>\n<task-id>ag7</task-id>\n<tool-use-id>tu9</tool-use-id>\n<result>long</result>', origin: { kind: 'task-notification' } }, (e: any) => e)
    expect(r.text).toBe('Result of agent ag7: CARD')
    expect((await submit(h, { text: 'hello', origin: { kind: 'composer' } }, (e: any) => e)).text).toBe('hello')
  })
  test('agent calls: deltas drained into context; tester calls logged for the view audit', async () => {
    const { h, a } = await mk()
    await bound(h, { ag1: B(a, 'S1'), t1: B(a, 'S1', { role: 'tester', worktree: '/v' }) })
    await pushDelta(h, 'ag1', 'decision: use bcrypt')
    expect(await wrap(h, { tool: 'Read', agentId: 'ag1', file_path: '/wt/x' }, () => ({ result: 'ok' }))).toEqual({ result: 'ok', context: ['decision: use bcrypt'] })
    await wrap(h, { tool: 'Read', agentId: 't1', input: { file_path: '/v/t.test.ts' } }, () => ({ result: 'ok' }))
    expect(await h.store.get('cadre:tlog:t1')).toEqual([{ tool: 'Read', path: '/v/t.test.ts', outcome: 'ok' }])
  })
})


describe('tdd author:same (3.5)', () => {
  test('red -> worker: the tester-step agent is re-stepped and resumed with the worker brief at the next drain', async () => {
    const { h, a, sent } = await mk()
    await h.bind.update(() => ({})); for (const [x, b] of [['ag1', B(a, 'S1', { step: 'tester' })], ['ag2', B(a, 'S1', { role: 'reviewer', step: 'reviewer' })]] as const) await step(h, x, { type: 'spawn.ok', bind: b })   // as admission binds them
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
    await arm(h, 'auto')
    await h.board.update((s: any) => ({ ...s, plan: { ...s.plan, flags: ['integration-failed'] } }))
    await turn(h, { reason: 'answer' }); expect((await h.board.read()).drive.paused).toBe('resolve integration-failed'); expect(submitted).toEqual([])
    await h.board.update((s: any) => ({ ...s, plan: { ...s.plan, flags: [], state: 'done-on-dev', landed: { dev: 'dev', sha: 'abc', at: 1 } } }))
    await turn(h, { reason: 'answer' })
    expect((await h.board.read()).drive.on).toBe(false); expect(submitted).toEqual([]); expect(h.toasts.join()).toContain('/clear for a fresh main')
  })
})

describe('round 2: effort, pruning, tester deny log', () => {
  test('turn.step applies the effort admission routed (on the binding); none leaves the frontmatter', async () => {
    const { h, a } = await mk()
    await bound(h, { t1: B(a, 'S1', { step: 'tester', effort: 'high' }), w1: B(a, 'S1') })
    const seen: any[] = []
    const run = async (agentId: string) => { const g = meter(h, { agentId }, async function* (e: any) { seen.push(e); return { usage: null } } as any); let r = await g.next(); while (!r.done) r = await g.next() }
    await run('t1'); await run('w1')
    expect(seen[0].effort).toBe('high'); expect('effort' in seen[1]).toBe(false)
  })
  test('the routed effort still applies to an agent\'s last step, after its binding was ended by the accepted report', async () => {
    const { h, a } = await mk()
    await bound(h, { r1: B(a, 'S1', { step: 'reviewer', effort: 'high' }) })
    const seen: any[] = []
    const run = async (agentId: string) => { const g = meter(h, { agentId }, async function* (e: any) { seen.push(e); return { usage: null } } as any); let r = await g.next(); while (!r.done) r = await g.next() }
    await run('r1'); await h.bind.update(() => ({})); await run('r1')   // the binding is gone for the second step
    expect(seen.map(e => e.effort)).toEqual(['high', 'high'])
    await h.bind.update(() => ({})); await run('stranger'); expect('effort' in seen[2]).toBe(false)   // an agent that never had a routed effort keeps the file's
  })
  test('session.start pruning: stale-lease resume entries, closed/expired pointer bindings, quarantine older than 30 days', async () => {
    const { h, a, b } = await mk()
    const day = 86_400_000
    await bound(h, { ag1: B(a, 'S1'), ag2: B(b, 'S1') })
    await queueResume(h, { agentId: 'ag1', taskId: a, text: 'x' }); await queueResume(h, { agentId: 'ag2', taskId: b, text: 'y' })   // a is claimed (lease live), b is not
    await (await (h as any).taskStore()).setControl({ board: { epic: 'e', bind: await h.bind.read() } })
    await h.store.set(await scoped(h, 'quarantine'), [{ ts: -40 * day }, { ts: -day }])
    await prune(h)
    expect(((await h.store.get(`cadre:${repoKeyOf('/repo')}:resumes`)) as any[]).map(x => x.agentId)).toEqual(['ag1'])
    expect(Object.keys(((await (await (h as any).taskStore()).control()).doc.board as any).bind)).toEqual(['ag1'])
    expect(await h.store.get(await scoped(h, 'quarantine'))).toEqual([{ ts: -day }])
  })
  test('guards: a tester call the guards deny still reaches the view call log (3.5.2)', async () => {
    const { h, a } = await mk()
    await bound(h, { t1: B(a, 'S1', { role: 'tester', step: 'tester', worktree: '/v' }) })
    const r: any = await guard(h, { tool: 'Bash', agentId: 't1', command: 'ls' }, () => ({ ok: 1 }))
    expect(typeof r.deny).toBe('string')
    expect(await h.store.get('cadre:tlog:t1')).toEqual([{ tool: 'Bash', path: undefined, outcome: r.deny }])
  })
})

describe('fx-data: board ctx, per-repo keys, checkpoint only while the task works', () => {
  test('turn.step mirrors the owner ctx% onto its board task; the model view ignores it; cost:all is per repo', async () => {
    const { h, a } = await mk()
    await bound(h, { ag1: B(a, 'S1') })
    const g = meter(h, { agentId: 'ag1' }, async function* () { return { usage: { input_tokens: 40_000, output_tokens: 1 } } } as any); let r = await g.next(); while (!r.done) r = await g.next()
    const s = await h.board.read(); expect(s.tasks[0].ctx).toBe(20); expect(JSON.stringify(modelView(s))).not.toContain('"ctx"')
    expect(await h.store.get(`cadre:${repoKeyOf('/repo')}:cost:all`)).toBeDefined(); expect(await h.store.get('cadre:cost:all')).toBeUndefined()
  })
  test('L3: a worker turn after report{done} (task in review) is not checkpointed', async () => {
    const { h, a, runs } = await mk({ dirty: ['src/a.ts'] })
    await bound(h, { ag1: B(a, 'S1') })
    await turn(h, { reason: 'answer', agentId: 'ag1' }); expect(runs.some(r => r.join(' ').includes('checkpoint'))).toBe(true)
    runs.length = 0; await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === a ? { ...t, state: 'review', step: 'reviewer' } : t)) }))
    await turn(h, { reason: 'answer', agentId: 'ag1' }); expect(runs.some(r => r.join(' ').includes('checkpoint'))).toBe(false)
  })
})
