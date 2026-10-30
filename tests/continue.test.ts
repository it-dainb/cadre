import { describe, expect, test } from 'claude-code/testing'
import { step } from '../core/lifecycle'
import { NOTHING, continueRun, life, proc, prune, quit, unfinished, rehydrate, savePointer, stampAlive } from '../core/session'
import { drain, queueResume } from '../core/reuse'
import { admit } from '../core/admission'
import { arm, casDrive } from '../core/drive'
import { ROUTES } from '../core/dispatch'
import '../core/close'
import { leaseLive } from '../core/board'
import { driveOf } from '../ui/v2/facts'
import { band2 } from '../ui/v2/band'
import { txt } from '../ui/model'
import { resumeBanner } from '../ui/index'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { types } from './support'
import { repoKeyOf } from '../commands/init'
import { fakeHost, task } from './support'

const T0 = 1_700_000_000_000, K = `cadre:${repoKeyOf('/repo')}`, ACTOR = 'cadre/u/abc'
// one machine: a shared $.store, one task store, one clock, a scripted git (the worker's tree is dirty when `dirty`); each session = its own $.state
async function machine() {
  const clock = { now: T0 }, kv = new Map<string, unknown>(), store = new MemoryStore(() => clock.now), cfg = defaults(), runs: string[] = [], git = { dirty: true }
  await store.init({ types: types(), journal: false })
  const epic = await store.createEpic('auth', 'goal'), mk = (title: string) => store.createDraft({ title, description: 'd', type: 'feature', parent: epic, meta: { 'cadre.lane': 'lite' } })
  const a = (await mk('login')).id, b = (await mk('logout')).id, c = (await mk('reset')).id
  await store.approve([a, b, c])
  for (const id of [a, b]) { await store.claim(id, ACTOR); await store.setMeta(id, { 'cadre.step': 'worker', 'cadre.worktree': `/wtx/${id}`, 'cadre.branch': `feat/${id}`, 'cadre.base': 'base000' }, ACTOR) }
  await store.setMeta(a, { 'cadre.lastCheck': 'test failed (exit 1):\nFAIL login rejects a bad password' }, ACTOR)
  await store.setMeta(b, { 'cadre.step': 'reviewer', 'cadre.sourceCommit': 'src0001' }, ACTOR); await store.move(b, 'review', ACTOR)
  const session = async (id: string) => {
    const h = fakeHost() as any
    Object.assign(h, {
      now: async () => clock.now, store: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => { kv.set(k, v) }, del: async (k: string) => { kv.delete(k) } },
      taskStore: async () => store, config: async () => cfg, usage: async () => ({ cost: { usd: 1 } }),
      run: async (argv: string[]) => {
        const s = argv.join(' '); runs.push(s)
        return { exitCode: s.includes('diff --cached --quiet') && git.dirty ? 1 : 0, stderr: '',
          stdout: s.includes('status --porcelain') ? (git.dirty ? ' M src/login.ts\0' : '') : s.includes('rev-parse') ? 'abc1234\n' : s.includes('diff --stat') ? ' src/login.ts | 3 ++-\n' : s.includes(' diff ') ? '+half of the login check\n' : '' }
      },
    })
    await h.secret.update((x: any) => ({ ...x, session: id }))
    return h
  }
  kv.set(`${K}:actor`, ACTOR)
  return { clock, kv, store, cfg, runs, git, epic, a, b, c, session }
}
const spawned = () => { const seen: any[] = []; return { seen, next: async (e: any) => (seen.push(e), { agentId: `ag${seen.length + 10}` }) } }

// session S1 in process P1 runs the plan: drive armed in `mode`, a worker on a, a reviewer on b; then the process quits (P2 is the next one)
async function running(mode: 'auto' | 'yolo' = 'yolo') {
  const m = await machine(); proc.id = 'P1'; proc.pid = 'box 111'
  const h1 = await m.session('S1')
  await h1.board.update((s: any) => ({ ...s, seq: 3, epic: m.epic, containment: { state: 'contained', unsandboxed: 0 }, plan: { id: m.epic, slug: 'auth', state: 'approved', epicBranch: 'epic/auth', mode },
    tasks: [task(m.a, { state: 'active', step: 'worker', owner: ACTOR }), task(m.b, { state: 'review', step: 'reviewer', owner: ACTOR }), task(m.c)] }))
  expect(await arm(h1, mode)).toBe(`drive ${mode} on`)
  await step(h1, 'w1', { type: 'spawn.ok', bind: { taskId: m.a, role: 'worker', step: 'worker', worktree: `/wtx/${m.a}`, sessionId: 'S1', ctxTokens: 0, startedAt: T0 } })   // as admission binds them
  await step(h1, 'r1', { type: 'spawn.ok', bind: { taskId: m.b, role: 'reviewer', step: 'reviewer', worktree: `/wtx/${m.b}`, sessionId: 'S1', ctxTokens: 0, startedAt: T0 } })
  for (const id of [m.a, m.b]) await m.store.setControl({ [`hb:${id}`]: { s: 'S1', at: T0 } })
  await stampAlive(h1); await savePointer(h1)
  return { ...m, h1 }
}
const after = async (m: Awaited<ReturnType<typeof running>>, ms: number) => {   // a new process, `ms` later, its board cold; wake() has drawn containment
  proc.id = 'P2'; proc.pid = 'box 222'; m.clock.now += ms
  const h2 = await m.session('S2'); await h2.board.update((s: any) => ({ ...s, containment: { state: 'contained', unsandboxed: 0 } }))
  return h2
}

describe('continue after exit', () => {
  test('a new process re-adopts the plan on a cold board but restarts nothing by itself; the band offers 0: continue', async () => {
    const m = await running(), h2 = await after(m, 40_000)
    expect(await rehydrate(h2)).toBe(true)
    const s = await h2.board.read()
    expect(s.plan).toMatchObject({ id: m.epic, state: 'approved' }); expect(s.tasks.map((t: any) => t.id)).toEqual([m.a, m.b, m.c])
    expect(s.drive.on).toBe(false); expect(await h2.bind.read()).toEqual({})   // the old agents ended with their process: not adopted, not heartbeaten
    expect((await h2.ui.read()).cont).toBe(m.epic)
    expect(await unfinished(h2)).toEqual({ id: m.epic, slug: 'auth', done: 0, total: 3 })   // the status line's test: the same one continue and the band use
    const v = { b: s, ring: [], sec: {}, ui: await h2.ui.read(), c: { maxTurns: 100 }, now: m.clock.now, sx: 'strict', t: null } as any
    expect(driveOf(v)).toMatchObject({ key: 'continue', text: expect.stringContaining('unfinished plan') })
    const band = txt(band2(v, 140, { go() {}, pick() {}, answer() {}, step() {} })).join('\n')
    expect(band).toContain('0: continue'); expect(band).not.toMatch(/\d+h\d\d/)   // no counter since 1970: the rebuilt board has no start time
    await resumeBanner(h2); expect(h2.logs.at(-1)).toContain('/cadre continue or 0 picks it up')
    expect(driveOf({ ...v, b: { ...s, drive: { ...s.drive, on: true, turns: 1, costUsd: 0 } } })?.key).toBe('stop')   // one key, one meaning per state
    expect(driveOf({ ...v, b: { ...s, drive: { ...s.drive, on: true, stopped: 'max turns 100', turns: 1, costUsd: 0 } } })?.key).toBe('resume')
  })

  test('the same process after /clear keeps its agents and its drive (no continue needed)', async () => {
    const m = await running(), h2 = await m.session('S2')   // proc stays P1
    m.clock.now += 6 * 60_000   // no claim lease left (a task in review has none at all in the real store): the agents of this process still run
    const second = (async () => { while (!(await h2.board.read()).epic) await Promise.resolve(); await rehydrate(h2); return Object.keys(await h2.bind.read()).sort() })()   // a hook arriving mid-rehydrate (a reviewer's report right after the /clear)
    await rehydrate(h2); expect(await second).toEqual(['r1', 'w1'])
    expect((await h2.board.read()).drive).toMatchObject({ on: true, mode: 'yolo' }); expect(Object.keys(await h2.bind.read()).sort()).toEqual(['r1', 'w1'])
    expect(await unfinished(h2)).toBeNull()
    expect((await h2.ui.read()).cont).toBeUndefined()
  })

  test('a reviewer at work keeps its binding with no claim lease (a task in review has none): the prune after a /clear and its resumes', async () => {
    const m = await running('auto'), sent: string[] = []; m.clock.now += 6 * 60_000
    m.h1.sendTo = async (id: string) => { sent.push(id); return { isDelivered: true } }
    await prune(m.h1)
    expect(Object.keys(((await m.store.control()).doc.board as any).bind).sort()).toEqual(['r1', 'w1'])
    await queueResume(m.h1, { agentId: 'r1', taskId: m.b, text: 'review the fix' }); await drain(m.h1, { reason: 'answer' }, async () => ({}))
    expect(sent).toEqual(['r1'])
  })

  test('continue from the task store alone: $.store empty (a wiped profile), the plan, the drive record and its lease come back from .cadre/state', async () => {
    const m = await running('yolo'); m.kv.clear(); const h2 = await after(m, 40_000)
    expect(await continueRun(h2)).toBe(`Picking up ${m.a} worker, ${m.b} reviewer · drive yolo · ${m.epic} auth 0/3 done`)
    expect(await casDrive(h2, m.store, () => undefined)).toMatchObject({ on: true, mode: 'yolo', lease: { session: 'S2' } })
  })
  test('continue: immediate takeover from a gone session (claim still live), drive re-armed in its mode, respawns queued for main', async () => {
    const m = await running('yolo'), h2 = await after(m, 40_000)
    expect(leaseLive(await m.store.get(m.a), m.clock.now)).toBe(true)   // no waiting for the 5-minute claim
    const line = await continueRun(h2)
    expect(line).toBe(`Picking up ${m.a} worker, ${m.b} reviewer · drive yolo · ${m.epic} auth 0/3 done`)
    expect((await h2.board.read()).drive).toMatchObject({ on: true, mode: 'yolo', stopped: undefined })
    const rec = await casDrive(h2, m.store, () => undefined); expect(rec).toMatchObject({ on: true, mode: 'yolo', lease: { session: 'S2' } })
    const brief = String((await h2.ui.read()).goal)
    expect(brief).toContain(`spawn TASK-${m.a} (it starts from its last checkpoint)`); expect(brief).toContain(`spawn TASK-${m.b} (reviewer)`); expect(brief).toContain(`spawn TASK-${m.c}`)
    expect((await h2.ui.read()).cont).toBeUndefined()
    // main respawns: the rebind commits the dirty tree as wip and hands the new worker the checkpoint, the diff and the failing check
    const w = spawned(); await admit(h2, { prompt: `TASK-${m.a}`, description: 'd', subagentType: 'general-purpose', background: true, fork: false }, w.next)
    expect(w.seen).toHaveLength(1); const p = w.seen[0].prompt
    expect(p).toContain('## Handoff'); expect(p).toContain('the work so far is committed in your tree (checkpoint abc1234)'); expect(p).toContain('src/login.ts | 3 ++-'); expect(p).toContain('+half of the login check')
    expect(p).toContain('last check: test failed'); expect(p).toContain('FAIL login rejects a bad password')
    expect(m.runs.some(r => r.includes(`commit --no-verify -m wip(${m.a}): checkpoint`))).toBe(true)
    expect((await m.store.get(m.a)).meta['cadre.checkpoint']).toBe('abc1234')
    expect((await h2.bind.read()).ag11).toMatchObject({ taskId: m.a, role: 'worker', sessionId: 'S2' })
    const r = spawned(); await admit(h2, { prompt: `TASK-${m.b}`, description: 'd', subagentType: 'general-purpose', background: true, fork: false }, r.next)
    expect(r.seen[0]?.subagentType).toBe('cadre:reviewer')
  })

  test('yolo still needs contained agents: a broken sandbox stops the re-armed drive', async () => {
    const m = await running('yolo'), h2 = await after(m, 40_000)
    await h2.board.update((s: any) => ({ ...s, containment: { state: 'degraded', unsandboxed: 1 } }))
    expect(await continueRun(h2)).toContain('drive stopped: containment broke during the run · 0: resume')
  })

  test('a live other session keeps its plan and its tasks: no takeover, its agents are not respawned', async () => {
    const m = await running('auto'), h2 = await after(m, 5_000)   // S1 stamped 5 s ago: alive
    expect(await continueRun(h2)).toBe(`${m.epic} is running in another session · continue it there, or quit that one, then /cadre continue here (a session that crashed frees it within 30 s)`)
    await casDrive(h2, m.store, r => r && { ...r, on: false })   // even with nothing driving it, its tasks stay with it
    const line = await continueRun(h2)
    expect(line).toContain(`${m.a}, ${m.b} stay with another session`); expect(line).toContain('Nothing was in flight')
    expect(String((await h2.ui.read()).goal ?? '')).not.toContain(`TASK-${m.a} (it starts`)
    const w = spawned(), out = await admit(h2, { prompt: `TASK-${m.a}`, description: 'd', subagentType: 'general-purpose', background: true, fork: false }, w.next)
    expect(out.deny).toContain('being worked on from another session'); expect(w.seen).toEqual([])
  })

  test('a quit clears its stamp: a session started right after continues at once', async () => {
    const m = await running('auto'); await quit(m.h1)
    const h2 = await after(m, 2_000)
    expect(await continueRun(h2)).toMatch(new RegExp(`^Picking up ${m.a} worker, ${m.b} reviewer`))
  })

  test('a tick after the quit does not stamp again: the session that quit stays gone', async () => {
    const m = await running('auto'); try { await quit(m.h1); await m.h1.now(); await stampAlive(m.h1) } finally { life.ending = false }
    const h2 = await after(m, 2_000), run = h2.run; h2.run = async (argv: string[]) => (argv[2]?.startsWith('kill -0') ? { exitCode: 0, stdout: '', stderr: '' } : run(argv))   // the old pid is still in the table (a process not yet reaped)
    expect(await continueRun(h2)).toMatch(new RegExp(`^Picking up ${m.a} worker`))
  })

  test('a crash: a stamp whose process is gone on this machine frees the plan at once; another machine waits out the window', async () => {
    const m = await running('auto'), h2 = await after(m, 2_000), run = h2.run, kills: string[] = []
    h2.run = async (argv: string[]) => (argv[2]?.startsWith('kill -0') ? (kills.push(argv[4]), { exitCode: 1, stdout: '', stderr: 'No such process' }) : run(argv))
    proc.pid = 'other 222'; expect(await continueRun(h2)).toContain('is running in another session'); expect(kills).toEqual([])   // not this machine: never probed
    proc.pid = 'box 222'; expect(await continueRun(h2)).toMatch(new RegExp(`^Picking up ${m.a} worker`)); expect(kills).toContain('111')
  })

  test('pending decisions come back: a blocked task asks its question again (auto)', async () => {
    const m = await running('auto')
    await m.store.setMeta(m.c, { 'cadre.question': 'Which hash?' }, ACTOR); await m.store.claim(m.c, ACTOR); await m.store.move(m.c, 'blocked', ACTOR)
    const h2 = await after(m, 40_000), line = await continueRun(h2)
    expect(((await h2.board.read()).decisions ?? []).some((d: any) => d.id.includes(m.c))).toBe(true)
    expect(line).toMatch(/· 1 needs you · press 1 to answer$/); expect(line).toContain('drive auto')
  })

  test('continue typed while the tick rehydrates: the command reads the board the tick built, not the cold one its first read saw', async () => {
    const m = await running('auto'), tick = await after(m, 40_000)
    // the engine: a dispatch reads the moment of its first get; a write of its own (a compare-and-set miss included) moves it on
    let seen: any, pinned = true
    const cmd = { ...tick, board: { read: async () => (pinned ? (seen ??= await tick.board.read()) : tick.board.read()), update: async (fn: any) => { pinned = false; return tick.board.update(fn) } } } as any
    await cmd.board.read()   // the command's first get: the board is still cold
    const t = rehydrate(tick)   // the 5 s tick's flight
    const line = await continueRun(cmd); await t
    expect(line).toMatch(new RegExp(`^Picking up ${m.a} worker, ${m.b} reviewer · drive auto · ${m.epic} auth 0/3 done`))
  })

  test('the band press (drive continue) is the same command; nothing open: the one line', async () => {
    const m = await running('auto'), h2 = await after(m, 40_000)
    const r = await ROUTES.drive!(h2, { schemaVersion: 1, cmd: 'drive', args: ['continue'], origin: { kind: 'press' } } as any)
    expect(r.text).toMatch(new RegExp(`^Picking up ${m.a} worker`))
    const bare = fakeHost() as any, empty = new MemoryStore(() => T0); await empty.init({ types: types(), journal: false })
    Object.assign(bare, { taskStore: async () => empty, config: async () => defaults() })
    expect(await continueRun(bare)).toBe(NOTHING)
    expect((await ROUTES.continue!(bare, { schemaVersion: 1, cmd: 'continue', args: [], origin: { kind: 'composer' } } as any)).text).toBe('nothing to continue · /cadre <goal> to start')
  })
})
