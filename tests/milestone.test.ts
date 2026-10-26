// Milestone lane (ADR 0015): lane + override, the roadmap draft (epics, paths, core, critic), ONE approval, just-in-time epic plans approved automatically,
// scheduling within milestone.maxEpics, the next: line, stop propagation and the gate per mode, per-epic no progress.
import { describe, expect, test } from 'claude-code/testing'
import { decide } from '../commands/cadre'
import { changeLane, laneOf, nextLane } from '../core/lanes'
import { roadmap, stopEpic } from '../core/milestone'
import { nextAction } from '../core/render'
import { modelView } from '../core/board'
import { drain } from '../core/reuse'
import { kick, tally } from '../core/drive'
import { emit } from '../core/events'
import { sendBrief } from '../core/lanes'
import '../core/close'   // registers ROUTES.resolve (the stopped epic's Retry)
import { defaults as typeDefaults } from '../task-management/registry'
import { defaults } from '../config/index'
import { admitWith, type Deps } from '../core/admission'
import { continueRun, proc, savePointer } from '../core/session'
import { fakeHost } from './support'
import type { Task } from '../task-management/store'
import type { Plan } from '../types'
import { BUDGET } from './fixtures/budget.generated'
import { banned } from './fixtures/wording'
import { FULL, world } from './fixtures/native/world'

const reg = typeDefaults()
const T = (o: Partial<Task> = {}): Task => ({ id: 'a', title: 'x', description: 'd', type: 'feature', category: 'draft', nativeStatus: 'draft', priority: 2, deps: [], labels: [], meta: {}, updatedAt: '', ...o })
const MSP = { kind: 'plan', lane: 'milestone', reason: 'three features: signup, login, reset' }
const answered = (w: Awaited<ReturnType<typeof world>>) => w.h.ui.update(u => ({ ...u, asks: { ag9: { id: 'ask-ag9', q: 'critique', k: 0, answer: 'add a core epic for the user model' } } }))

// a roadmap: core epic + n epics after it (or independent ones), critiqued; returns ids
async function road(w: Awaited<ReturnType<typeof world>>, n = 2, core = true) {
  const m = (await w.call('TaskCreate', { subject: 'User accounts', description: 'accounts', metadata: MSP })).result.task.id as string
  const c = core ? (await w.call('TaskCreate', { subject: 'User model', description: 'the shared user record', metadata: { size: 1, core: true, paths: ['src/user.ts'] } })).result.task.id as string : ''
  const es: string[] = []
  for (let i = 0; i < n; i++) {
    const e = (await w.call('TaskCreate', { subject: `Feature ${i}`, description: `goal ${i}`, metadata: { size: 2, paths: [`src/f${i}.ts`] } })).result.task.id as string; es.push(e)
    if (c) await w.call('TaskUpdate', { taskId: e, addBlockedBy: [c] })
  }
  await answered(w); await w.call('TaskUpdate', { taskId: m, metadata: { critique: 'it asked for a core epic: added' } })
  return { m, c, es }
}
async function approved(n = 2, core = true, maxEpics = 2, mode: 'auto' | 'yolo' = 'auto') {
  const cfg = defaults(); cfg.milestone.maxEpics = maxEpics; cfg.drive.mode = mode; cfg.milestone.epicPlanner = 'main'   // main plans here; the planner agent: tests/planner.test.ts
  const w = await world({ config: cfg }), submitted: string[] = []
  Object.assign(w.h, { submit: async (t: string) => { submitted.push(t) }, usage: async () => ({ cost: { usd: 1 } }) })
  if (mode === 'yolo') await w.h.board.update(b => ({ ...b, containment: { state: 'contained', unsandboxed: 0 } }))
  const r = await road(w, n, core), d = (await w.h.board.read()).decisions!.find(x => x.kind === 'plan')!
  const out = (await decide(w.h, d.id, 'a', d.hash)).text
  return { ...w, ...r, out, submitted, board: () => w.h.board.read() }
}
// draft the tasks of a ready epic and mark it planned
async function planIt(w: Awaited<ReturnType<typeof approved>>, e: string, k = 1) {
  const ids: string[] = []
  for (let i = 0; i < k; i++) ids.push((await w.call('TaskCreate', { subject: `Task ${e}.${i}`, description: 'impl', metadata: { ...FULL, epic: e, paths: [`src/${e}-${i}.ts`] } })).result.task.id)
  return { ids, r: await w.call('TaskUpdate', { taskId: e, metadata: { planned: true } }) }
}
const ev = async (w: { h: any }) => Object.values((await w.h.events.read()).epics).flat() as any[]

describe('lane and override', () => {
  test('main picks milestone: never overridden; more than 7 tasks offers it; the dialog goes back to one plan', () => {
    expect(laneOf('milestone', [T()], reg)).toEqual({ lane: 'milestone' })
    const eight = Array.from({ length: 8 }, (_, i) => T({ id: `t${i}` }))
    expect(laneOf('full', eight, reg)).toEqual({ lane: 'full', why: '8 tasks: a milestone fits' })
    expect(laneOf('full', eight.slice(0, 7), reg)).toEqual({ lane: 'full' })
    const P = (lane: Plan['lane']): Plan => ({ id: 'p', slug: 's', state: 'draft', epicBranch: 'epic/p-s', lane })
    expect(nextLane(P('full'), eight, reg)).toBe('milestone'); expect(nextLane(P('milestone'), [], reg)).toBe('full')
  })
  test('Change lane: full with 8 tasks → milestone drops the tasks, names the milestone branch and briefs the roadmap; back → one plan', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'Accounts', description: 'g', metadata: { kind: 'plan', lane: 'full', reason: 'big' } })
    for (let i = 0; i < 8; i++) await w.call('TaskCreate', { subject: `T${i}`, description: 'd', metadata: { ...FULL, paths: [`src/t${i}.ts`] } })
    const id = (await w.h.board.read()).plan!.id
    expect((await w.h.board.read()).decisions?.find(d => d.kind === 'plan')?.options.find(o => o.key.startsWith('l-'))?.label ?? (await w.h.board.read()).approval.missing.join()).toBeTruthy()
    expect(await changeLane(w.h, w.store, reg, id)).toBe(`${id}: lane milestone`)
    const s = await w.h.board.read(); expect(s.plan).toMatchObject({ lane: 'milestone', epicBranch: `milestone/${id}-accounts` }); expect(await w.store.list({ parent: id })).toEqual([])
    const g = String((await w.h.ui.read()).goal); expect(g).toContain('Roadmap rules'); expect(banned(g)).toEqual([])
    expect(await changeLane(w.h, w.store, reg, id)).toBe(`${id}: lane full`)
    expect((await w.h.board.read()).plan!.epicBranch).toBe(`epic/${id}-accounts`); expect(String((await w.h.ui.read()).goal)).toContain('Draft its tasks now')
  })
  test('the guide names the milestone lane and stays short', () => {
    const g = (BUDGET.guides as Record<string, string>).goal
    for (const k of ['**milestone**', '"lane": "milestone"']) expect(g).toContain(k)
    expect(g.length).toBeLessThan(5000)   // + the clarify step (ADR 0020)
  })
})

describe('roadmap draft', () => {
  test('an epic whose every path is protected is refused (create and amend); one real file beside it is fine', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'User accounts', description: 'accounts', metadata: MSP })
    const r = await w.call('TaskCreate', { subject: 'Notes', description: 'g', metadata: { size: 2, paths: ['CHANGELOG.md'] } }); expect(r.deny).toContain('every path of this epic is protected (CHANGELOG.md): cadre writes the changelog itself'); expect(r.deny).toContain('drop the epic or give it the files it changes')
    expect((await w.call('TaskCreate', { subject: 'Notes', description: 'g', metadata: { size: 2, paths: ['.cadre/x.json', 'CHANGELOG.md'] } })).deny).toContain('every path of this epic is protected')
    const ok = (await w.call('TaskCreate', { subject: 'Notes', description: 'g', metadata: { size: 2, paths: ['CHANGELOG.md', 'src/a.ts'] } })).result.task.id
    const u = await w.call('TaskUpdate', { taskId: ok, metadata: { paths: ['CHANGELOG.md'] } }); expect(u.result.error).toContain('every path of this epic is protected')
  })
  test('the plan answer carries the roadmap rules; epics need goal, size, paths; overlap and core size go back to the planner', async () => {
    const w = await world(), p = await w.call('TaskCreate', { subject: 'User accounts', description: 'accounts', metadata: MSP }), m = p.result.task.id
    expect(p.context.join('\n')).toContain('Roadmap rules'); expect((await w.h.board.read()).plan!.epicBranch).toBe(`milestone/${m}-user-accounts`)
    const a = (await w.call('TaskCreate', { subject: 'Signup', description: '', metadata: {} })).result.task.id
    expect((await w.store.get(a)).type).toBe('epic'); expect((await w.h.board.read()).approval.missing.join('; ')).toContain(`${a}: goal, size`)
    await w.call('TaskUpdate', { taskId: a, description: 'sign up with email', metadata: { size: 2, paths: ['src/auth/'] } })
    expect((await w.h.board.read()).approval.missing).toContain('epics: a milestone has 2 or more (else change the lane to one plan)')
    const b = (await w.call('TaskCreate', { subject: 'Login', description: 'log in', metadata: { size: 3, paths: ['src/auth/login.ts'] } })).result.task.id
    expect((await w.h.board.read()).approval.missing.join('; ')).toContain(`${a}+${b} both change src/auth/: move it into the core epic or add a dependency`)
    const c = (await w.call('TaskCreate', { subject: 'Core', description: 'auth core', metadata: { size: 3, core: true, paths: ['src/core/'] } })).result.task.id
    expect((await w.h.board.read()).approval.missing.join('; ')).toContain(`${c}: a core epic has at most 2 tasks`)
    await w.call('TaskUpdate', { taskId: c, metadata: { size: 2 } }); await w.call('TaskUpdate', { taskId: b, addBlockedBy: [a] })
    expect((await w.h.board.read()).approval.missing).toEqual(['critic review (the roadmap rules say how)'])
    expect((await w.h.board.read()).decisions?.some(d => d.kind === 'plan') ?? false).toBe(false)   // no dialog before the critic
    expect((await w.call('TaskUpdate', { taskId: m, metadata: { critique: 'fine' } })).result.error).toContain('ask the critic first')
    await answered(w); expect((await w.call('TaskUpdate', { taskId: m, metadata: { critique: 'it found login after signup; added the dependency' } })).result.success).toBe(true)
    const d = (await w.h.board.read()).decisions!.find(x => x.kind === 'plan')!
    expect(d.title).toBe(`approve milestone ${m}`); expect(d.lines[0]).toBe('auto · milestone · 3 epics · three features: signup, login, reset')
    expect(d.lines).toContain(`  ${b} Login · 3 tasks · after ${a}`); expect(d.lines).toContain(`  ${c} core Core · 2 tasks`)
  })
  test('validation: size 1-7 on an epic, epic only on a task, critique a bounded string, lane milestone accepted', async () => {
    const w = await world(); await w.call('TaskCreate', { subject: 'M', description: 'g', metadata: MSP })
    expect((await w.call('TaskCreate', { subject: 'E', description: 'g', metadata: { size: 9 } })).deny).toContain('size: expected')
    expect((await w.call('TaskCreate', { subject: 'E', description: 'g', metadata: { epic: 5 } })).deny).toContain('epic: expected')
    const v = await world(); await v.call('TaskCreate', { subject: 'P', description: 'g', metadata: { kind: 'plan' } })
    expect((await v.call('TaskCreate', { subject: 'T', description: 'g', metadata: { epic: 'm-9' } })).deny).toContain('only in a milestone')
  })
})

describe('one approval, then epics plan themselves', () => {
  test('approve: the milestone branch is cut from dev, drive arms; the core epic is ready, the others wait on it', async () => {
    const w = await approved()
    expect(w.out).toContain(`Milestone ${w.m} approved: 3 epics ready`); expect(w.out).toContain('drive auto on')
    expect(w.calls.some(c => c.join(' ').includes(`milestone/${w.m}-user-accounts`))).toBe(true)
    const s = await w.board(); expect(s.plan!.epics!.map(e => e.state)).toEqual(['ready', 'waiting', 'waiting'])
    expect(nextAction(modelView(s))).toBe(`plan epic ${w.c}: task calls with epic "${w.c}", then epic {id:"${w.c}", planned:true}`)
    expect(String((await w.h.ui.read()).goal)).toContain(`Milestone ${w.m} is approved`)
  })
  test('JIT: tasks need metadata.epic of a ready epic; the first answer carries the plan rules; planned:true approves them automatically and records it', async () => {
    const w = await approved()
    expect((await w.call('TaskCreate', { subject: 'X', description: 'd', metadata: FULL })).deny).toContain(`ready to plan: ${w.c}`)
    expect((await w.call('TaskCreate', { subject: 'X', description: 'd', metadata: { ...FULL, epic: w.es[0] } })).deny).toContain('name the epic')   // waiting on the core
    const t = await w.call('TaskCreate', { subject: 'User record', description: 'd', metadata: { type: 'feature', epic: w.c } })
    expect(t.context.join('\n')).toContain('Plan rules'); expect((await w.store.get(t.result.task.id)).parent).toBe(w.c)
    let s = await w.board(); expect(s.plan!.epics![0].state).toBe('planning'); expect(s.approval).toEqual({ planId: null, missing: [`${w.c} plan: ${t.result.task.id}: scenarios, changelog, interface, package`] })
    expect((await w.call('TaskUpdate', { taskId: w.c, metadata: { planned: true } })).result.error).toContain('incomplete')
    await w.call('TaskUpdate', { taskId: t.result.task.id, metadata: { scenarios: FULL.scenarios, interface: FULL.interface, package: '.', changelog: FULL.changelog } })
    const r = await w.call('TaskUpdate', { taskId: w.c, metadata: { planned: true } }); expect(r.result.success).toBe(true)
    s = await w.board(); expect(s.plan!.epics![0].state).toBe('running'); expect(s.tasks).toMatchObject([{ id: t.result.task.id, state: 'todo', epic: w.c }])
    expect((s.decisions ?? []).filter(d => d.kind === 'plan')).toEqual([])   // no dialog: the roadmap was the approval
    expect((await w.store.list({})).some(x => x.type === 'decision' && x.title === `auto: plan ${w.c} approved automatically for milestone ${w.m}`)).toBe(true)
    expect((await ev(w)).some(e => e.type === 'drive.decided' && e.data.kind === 'plan')).toBe(true)
    expect(nextAction(modelView(s))).toBe(`spawn TASK-${t.result.task.id}`)
    expect(w.calls.some(c => c.join(' ') === `git -C /repo branch epic/${w.c}-user-model milestone/${w.m}-user-accounts`) || (await w.store.get(w.c)).meta['cadre.branch'] === `epic/${w.c}-user-model`).toBe(true)
  })
  test('scheduling: independent epics start within maxEpics (0 = no cap); a landed dependency frees the next', async () => {
    for (const [max, want] of [[2, ['ready', 'ready', 'waiting']], [0, ['ready', 'ready', 'ready']], [1, ['ready', 'waiting', 'waiting']]] as const) {
      const w = await approved(3, false, max); expect((await w.board()).plan!.epics!.map(e => e.state)).toEqual(want)
    }
    const w = await approved(2, true); await w.store.close(w.c, { outcome: 'done' })
    const r = await roadmap(w.store, w.m, 2, 'epic/'); expect(r.epics.map(e => e.state)).toEqual(['landed', 'ready', 'ready'])
  })
  test('next: complete an epic whose tasks are done; complete the milestone when every epic landed', async () => {
    const w = await approved(); const { ids } = await planIt(w, w.c)
    await w.h.board.update(b => ({ ...b, tasks: b.tasks.map(t => ({ ...t, state: 'done' })) }))
    expect(nextAction(modelView(await w.board()))).toContain(`complete epic ${w.c}: status {id:"${w.c}", set:"completed"}`)
    await w.h.board.update(b => ({ ...b, plan: { ...b.plan!, epics: b.plan!.epics!.map(e => ({ ...e, state: 'landed' as const })) } }))
    expect(nextAction(modelView(await w.board()))).toBe(`complete the milestone: status {id:"${w.m}", set:"completed"}`); expect(ids.length).toBe(1)
  })
})

describe('promote to core mid-run', () => {
  test('a shared need found while running: TaskCreate core:true without an epic adds an approved core-patch epic to the roadmap, recorded', async () => {
    const w = await approved(2, false), r = await w.call('TaskCreate', { subject: 'Shared user model', description: 'both epics need it', metadata: { core: true, paths: ['src/user.ts'] } })
    const id = r.result.task.id, e = (await w.board()).plan!.epics!.find(x => x.id === id)!
    expect(e.core).toBe(true); expect(e.state).not.toBe('draft'); expect(r.context[0]).toContain('core-patch epic')
    expect((await w.store.list({})).some(t => t.type === 'decision' && /core patch epic/.test(t.title + t.description))).toBe(true)
  })
})
describe('stops and bounds', () => {
  test('a stopped epic stops its dependants; auto pauses for the human, the Retry clears it', async () => {
    const w = await approved(); await planIt(w, w.c)
    await stopEpic(w.h, w.c, 'its landing failed twice')
    let s = await w.board(); expect(s.plan!.epics!.map(e => e.state)).toEqual(['stopped', 'stopped', 'stopped']); expect(s.plan!.epics![1].why).toBe(`waits on ${w.c}, which stopped`)
    const d = s.decisions!.find(x => x.id === `flag:${w.c}:stopped`)!; expect(d.lines).toContain('its landing failed twice')
    await w.h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'x' } })); await kick(w.h)
    expect((await w.board()).drive.paused).toBe(`epic ${w.c} stopped: its landing failed twice`)
    expect((await decide(w.h, d.id, 'r', d.hash)).text).toContain('the epic goes on'); s = await w.board(); expect(s.plan!.epics![0].state).toBe('running'); expect(s.drive.paused).toBeUndefined()
  })
  test('yolo: independent epics go on past a stopped one; nothing left to move stops the run', async () => {
    const w = await approved(2, false, 2, 'yolo'); await planIt(w, w.es[0]); await planIt(w, w.es[1])
    await stopEpic(w.h, w.es[0], 'no progress in 3 turns')
    await w.h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'x' } })); await kick(w.h); expect((await w.board()).drive.stopped).toBeUndefined()
    await stopEpic(w.h, w.es[1], 'no progress in 3 turns')
    await w.h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'x' } })); await kick(w.h); expect((await w.board()).drive.stopped).toContain(`epic ${w.es[0]} stopped`)
  })
  test('per-epic no progress: a running epic with a free slot that nothing moves stops after noProgressTurns drive turns; bounds scale with the epics', async () => {
    const w = await approved(2, false); const a = await planIt(w, w.es[0]); await planIt(w, w.es[1])
    const turn = async () => { await sendBrief(w.h); await drain(w.h, { reason: 'answer' }, async () => ({ text: 'done' })) }   // the queued approval brief goes out first (the timer)
    for (let i = 0; i < 4; i++) { await emit(w.h, 'task.transitioned', { taskId: a.ids[0], from: 'todo', to: 'todo' }, { taskId: a.ids[0] }); await turn() }   // the first epic moves every turn, the second never
    const s = await w.board(); expect(s.plan!.epics!.map(e => [e.state, e.why])).toEqual([['running', undefined], ['stopped', 'no progress in 3 turns']])
    expect(s.drive.stopped).toBeUndefined(); expect(s.drive.turns).toBe(4)
    const dc = defaults().drive; expect([s.drive.maxTurns, s.drive.maxUsd, s.drive.maxMinutes]).toEqual([dc.maxTurns * 2, dc.maxCostUsd * 2, dc.maxWallMinutes * 2])   // milestone-wide bounds: the plan bounds times its epics
  })
  test('a specifier\'s pick (a task being prepared) is not a turn of no progress for its epic', async () => {
    const w = await approved(2, false), a = await planIt(w, w.es[0]); await planIt(w, w.es[1]); const cfg = defaults(), st = async () => (await w.board()).plan!.epics!.map(e => e.state)
    for (let i = 0; i < 5; i++) await tally(w.h, cfg, 1, 1, false)
    const prepared = await st()
    for (let i = 0; i < 4; i++) { await emit(w.h, 'task.transitioned', { taskId: a.ids[0], from: 'todo', to: 'todo' }, { taskId: a.ids[0] }); await tally(w.h, cfg, 1, 1) }   // the other epic moves, this one never
    expect([prepared, await st()]).toEqual([['running', 'running'], ['running', 'stopped']])   // five picks that only prepare tasks stop nothing; real steps with nothing moving still stop an epic after 3
  })
  test('Retry of an epic stopped for no progress starts its count again: it is not stopped by the very next step', async () => {
    const w = await approved(2, false); const a = await planIt(w, w.es[0]); await planIt(w, w.es[1])
    const turn = async () => { await sendBrief(w.h); await drain(w.h, { reason: 'answer' }, async () => ({ text: 'done' })) }
    for (let i = 0; i < 4; i++) { await emit(w.h, 'task.transitioned', { taskId: a.ids[0], from: 'todo', to: 'todo' }, { taskId: a.ids[0] }); await turn() }
    expect((await w.board()).plan!.epics![1].state).toBe('stopped')
    const d = (await w.h.board.read()).decisions!.find(x => x.id === `flag:${w.es[1]}:stopped`)!; await decide(w.h, d.id, 'r', d.hash)
    const after = [(await w.board()).plan!.epics![1].state]
    await emit(w.h, 'task.transitioned', { taskId: a.ids[0], from: 'todo', to: 'todo' }, { taskId: a.ids[0] }); await turn()
    expect([...after, (await w.board()).plan!.epics![1].state]).toEqual(['running', 'running'])   // one idle turn after the Retry is the first of three, not the fourth
  })
})

describe('a task of an epic', () => {
  test('claims from its epic\'s ready list and branch; a stopped epic\'s task is refused', async () => {
    const w = await approved(2, false), cfg = defaults(), { ids } = await planIt(w, w.es[0]), { ids: other } = await planIt(w, w.es[1])
    const d: Deps = { store: w.store, cfg, reg: cfg.types as any, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'repo-1', actor: 'cadre/u/a', session: 's-1' }
    const next = async () => ({ agentId: 'ag1' }), br = (await w.board()).plan!.epics![0].branch
    expect(br).toBe(`epic/${w.es[0]}-feature-0`)
    expect(((await admitWith(w.h, d, { prompt: `TASK-${ids[0]}` }, next)) as any).deny).toBeUndefined()
    expect(w.calls.some(c => c.join(' ') === `git -C /repo rev-parse --verify ${br}^{commit}`)).toBe(true)
    await stopEpic(w.h, w.es[1], 'no progress in 3 turns')
    expect(((await admitWith(w.h, d, { prompt: `TASK-${other[0]}` }, next)) as any).deny).toContain(`its epic ${w.es[1]} is stopped (no progress in 3 turns)`)
  })
})

describe('continue', () => {
  test('/cadre continue picks up the in-flight tasks of every running epic in a new process', async () => {
    const w = await approved(2, false), a = (await planIt(w, w.es[0])).ids[0], b = (await planIt(w, w.es[1])).ids[0]
    for (const id of [a, b]) { await w.store.claim(id, 'cadre/u/a'); await w.store.setMeta(id, { 'cadre.step': 'worker', 'cadre.worktree': `/wt/${id}`, 'cadre.branch': `feat/${id}` }, 'cadre/u/a') }
    await w.h.board.update(x => ({ ...x, tasks: x.tasks.map(t => ({ ...t, state: 'active', step: 'worker', owner: 'cadre/u/a' })) }))
    proc.id = 'P1'; await savePointer(w.h)
    const h2 = Object.assign(fakeHost({ t0: 1_700_000_000_000 + 600_000 }), { store: w.h.store, taskStore: async () => w.store, config: async () => defaults(), usage: async () => ({ cost: { usd: 1 } }), run: async () => ({ exitCode: 0, stdout: 'sha1\n', stderr: '' }) })
    await h2.secret.update((x: any) => ({ ...x, session: 'S2' })); proc.id = 'P2'
    const out = await continueRun(h2)
    expect(out).toContain(`Picking up ${a} worker, ${b} worker`)
    const s = await h2.board.read(); expect(s.plan!.epics!.map(e => e.state)).toEqual(['running', 'running']); expect(s.tasks.map(t => t.epic)).toEqual([w.es[0], w.es[1]])
    const g = String((await h2.ui.read()).goal); expect(g).toContain(`spawn TASK-${a}`); expect(g).toContain(`spawn TASK-${b}`)
  })
})
