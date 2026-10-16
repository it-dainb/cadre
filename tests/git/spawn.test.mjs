// Dev-only: mod mode (ADR 0018) on real git + MemoryStore: the spawner starts, closes and completes; main takes no turn. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost, task } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { admitWith } = await import('../../core/admission.ts')
const { handleWith } = await import('../../tools/index.ts')
const { arm, kick, watchdog, IDLE } = await import('../../core/drive.ts')
const { stopped } = await import('../../core/close.ts')
const { spawnStep, spawnMode } = await import('../../core/spawner.ts')
const { queueResume } = await import('../../core/reuse.ts')
const { continueRun, life } = await import('../../core/session.ts')
const { budgetOf } = await import('../../core/lifecycle.ts')
const { contextLine } = await import('../../core/render.ts')
const { modelView } = await import('../../core/board.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const DESIGN = JSON.stringify({ symbols: [{ name: 'f', kind: 'fn', params: [], returns: 'x', status: 'new' }] })

// n tasks of one approved plan, drive armed in mod mode (CADRE_SPAWN=mod); `turn()` = an agent's turn end reaching the spawner registration
async function world(n = 1, o = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-spawn-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'a.txt'), 'a\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'; cfg.maxParallel = o.maxParallel ?? 3; cfg.drive.spawn = o.mode ?? 'mod'; cfg.packages = [{ root: '.', verify: ['verify'], checks: { verify: ['true'] } }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), ids = []
  for (let i = 0; i < n; i++) ids.push((await store.createDraft({ title: `task ${i}`, description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.package': '.', 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id)
  await store.approve([epic, ...ids])
  const h = fakeHost({ env: { CADRE_SPAWN: o.mode ?? 'mod' } }); let tick = 0
  const submitted = [], spawned = [], sent = []
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    submit: async t => { submitted.push(t) }, sendTo: async (a, t) => { sent.push([a, t]); return { isDelivered: true } }, usage: async () => ({ cost: { usd: 0 } }) })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  const ts = await Promise.all(ids.map(async id => { const t = await store.get(id); return task(id, { title: t.title, type: t.type }) }))
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: epic, slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: ts }))
  let k = 0
  const engine = e => { const id = `ag${++k}`; spawned.push([id, e.prompt, e.subagentType]); return { agentId: id, model: 'm' } }
  const cadre = Object.assign(async e => engine(e), { origin: { plugin: 'cadre', tier: 'user' } }), main = Object.assign(async e => engine(e), { origin: { plugin: 'engine', tier: 'core' } })
  h.spawnAgent = a => admitWith(h, dep, { ...a, background: true }, cadre)
  const turn = () => spawnStep(h, 'turn.complete')
  const rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  const pass = { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }
  const wt = async id => (await store.get(id)).meta['cadre.worktree']
  return { d, h, dep, store, ids, epic, turn, rep, pass, wt, submitted, spawned, sent, mainSpawn: e => admitWith(h, dep, e, main) }
}
const edit = (wt, f = 'b.txt', body = 'b\n') => writeFileSync(join(wt, f), body)

test('mode: drive.spawn (CADRE_SPAWN maps onto it); a non-interactive session runs main unless CADRE_SPAWN=mod says so', async () => {
  const { load } = await import('../../config/index.ts'), { settingsRows } = await import('../../config/route.ts')
  const h = fakeHost(); h.config = async () => defaults()
  assert.equal((await spawnMode(h)).mode, 'mod')   // the default
  await h.ui.update(u => ({ ...u, headless: true })); assert.equal((await spawnMode(h)).mode, 'main')
  h.config = async () => { const c = defaults(); c.drive.spawn = 'main'; return c }; await h.ui.update(u => ({ ...u, headless: undefined })); assert.equal((await spawnMode(h)).mode, 'main')
  h.config = async () => { const c = defaults(); c.drive.spawn = 'mod'; return c }; h.env = async () => ({ CADRE_SPAWN: 'mod' }); await h.ui.update(u => ({ ...u, headless: true })); assert.equal((await spawnMode(h)).mode, 'mod')   // a stream-json driver
  const e = fakeHost({ env: { CADRE_SPAWN: 'main' } }); assert.equal((await load(e, { home: '/hm', root: '/r', repoKey: 'r' })).config.drive.spawn, 'main')   // env -> config, shown as [env]
  const q = fakeHost(); delete q.config; await q.ui.update(u => ({ ...u, headless: true })); const row = (await settingsRows(q)).find(r => r.key === 'drive.spawn')
  assert.deepEqual([row.value, row.src], ['main', 'forced']); assert.match(row.warn, /non-interactive session runs main/)
})

test('the spawner refuses a frame an agent\'s events are raised under, and a host without the spawn', async () => {
  const w = await world(1); await arm(w.h, 'auto')
  await assert.rejects(spawnStep(w.h, 'tool.call'), /spawn refused/)
  const { spawnAgent, ...bare } = w.h; await assert.rejects(spawnStep(bare, 'turn.complete'), /spawn refused/)
  assert.equal(w.spawned.length, 0)
})

test('arm in mod mode: the board says so, main\'s line names no step of its own, and main\'s own Agent call for a task is denied (an explorer passes)', async () => {
  const w = await world(1); assert.match(await arm(w.h, 'auto'), /drive auto on/)
  const s = await w.h.board.read(); assert.equal(s.drive.spawn, 'mod'); assert.match(contextLine(modelView(s)), /next: wait: the tasks run by themselves/)
  const r = await w.mainSpawn({ prompt: `TASK-${w.ids[0]}`, background: true }); assert.match(r.deny, /starts by itself/)
  assert.equal((await w.mainSpawn({ prompt: 'where is the login code?', background: true })).agentId, 'ag1')   // marker-less: the explorer
})

test('main mode: nothing is spawned by cadre and main\'s spawn is admitted', async () => {
  const w = await world(1, { mode: 'main' }); await arm(w.h, 'auto'); await w.turn()
  assert.equal(w.spawned.length, 0); assert.equal((await w.h.board.read()).drive.spawn, undefined)
  assert.equal((await w.mainSpawn({ prompt: `TASK-${w.ids[0]}`, background: true })).agentId, 'ag1')
})

test('maxParallel: 3 ready tasks, limit 2 -> two start; a second turn end at once starts none twice; spawns count as drive turns', async () => {
  const w = await world(3, { maxParallel: 2 }); await arm(w.h, 'auto')
  await Promise.all([w.turn(), w.turn()])
  assert.equal(w.spawned.length, 2); assert.deepEqual(w.spawned.map(x => x[2]), ['cadre:worker', 'cadre:worker'])
  assert.equal((await w.h.board.read()).tasks.filter(t => t.state === 'active').length, 2)
  assert.ok((await w.h.board.read()).drive.turns >= 2); assert.deepEqual(w.submitted, [])
})

test('maxParallel under contention: three turn ends at once, every await a little late, still two starts (picks are claimed before the next await)', async () => {
  const w = await world(3, { maxParallel: 2 }); await arm(w.h, 'auto')
  const up = w.h.ui.update; w.h.ui.update = async f => { await new Promise(r => setTimeout(r, 3)); return up(f) }   // widens every gap between a frame's read and its claim
  await Promise.all([w.turn(), w.turn(), w.turn()])
  assert.equal(w.spawned.length, 2); assert.equal((await w.h.board.read()).tasks.filter(t => t.state === 'active').length, 2)
})

test('a pick whose intent write throws gives its key back and does not leak the picks after it', async () => {
  const w = await world(2, { maxParallel: 2 }); await arm(w.h, 'auto')
  const r = w.h.rand; let boom = true; w.h.rand = n => { if (n === 6 && boom) { boom = false; throw new Error('state write failed') } return r(n) }
  await w.turn().catch(() => {}); assert.equal(w.spawned.length, 1)   // the second pick still started
  await w.turn(); assert.equal(w.spawned.length, 2)   // the first one's key was released: it starts now
})

test('a pick whose session read throws gives its key back too', async () => {
  const w = await world(1, { maxParallel: 1 }); await arm(w.h, 'auto')
  const r = w.h.rand; let boom = true; w.h.rand = n => { if (n === 4 && boom && /spawner\.ts/.test(new Error().stack.split('\n')[3])) { boom = false; throw new Error('state write failed') } return r(n) }
  await w.turn().catch(() => {}); assert.equal(w.spawned.length, 0); assert.equal(boom, false)
  await w.turn(); assert.equal(w.spawned.length, 1)   // its key was released: it starts now
})

test('lint: one spawn site. $.agent.spawn only in register.ts spawner(); spawner() only in turn.complete / command.run registrations; spawnAgent only in core/spawner', async () => {
  const root = new URL('../../', import.meta.url).pathname, src = f => readFileSync(join(root, f), 'utf8')
  const files = execFileSync('git', ['-C', root, 'ls-files', '*.ts'], { encoding: 'utf8' }).split('\n').filter(f => f && !f.startsWith('tests/') && !f.startsWith('harness/'))
  for (const f of files) {
    const t = src(f)
    if (f !== 'hooks/register.ts') assert.doesNotMatch(t, /\$\.agent\.spawn\(|agent\.spawn\(\{/, `${f} starts an agent`)
    if (!['core/spawner.ts', 'hooks/register.ts', 'types/index.d.ts', 'core/drive.ts'].includes(f)) assert.doesNotMatch(t, /spawnAgent/, `${f} uses the spawn`)
  }
  const reg = src('hooks/register.ts'), lines = reg.split('\n')
  assert.equal(reg.match(/\$\.agent\.spawn\(/g).length, 1); assert.match(lines.find(l => l.includes('$.agent.spawn(')), /h\.spawnAgent = /)
  for (const l of lines.filter(l => /\bspawner\(\$/.test(l) && !/^function /.test(l))) assert.match(l, /^\s*on\('(turn\.complete|command\.run)'/, `spawner() outside a turn.complete/command.run registration: ${l.slice(0, 80)}`)
  assert.ok(!lines.some(l => /clock\.(every|after)/.test(l) && /spawner\(|spawnStep|agent\.spawn/.test(l)), 'a timer never spawns')
})

test('lifecycle with zero main turns: workers start, report, reviewers start, a pass lands (actor mod), the plan completes; main only gets digest lines', async () => {
  const w = await world(2), { h, store, d } = w, [a, b] = w.ids; await arm(h, 'auto')
  await w.turn(); assert.deepEqual(w.spawned.map(x => [x[0], x[2]]), [['ag1', 'cadre:worker'], ['ag2', 'cadre:worker']])
  edit(await w.wt(a)); edit(await w.wt(b), 'c.txt')
  assert.match(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did a' }), /report accepted/); await w.turn()
  assert.deepEqual([w.spawned[2][0], w.spawned[2][2]], ['ag3', 'cadre:reviewer']); assert.match(w.spawned[2][1], new RegExp(`REVIEW TASK-${a}`))
  assert.match(await w.rep('ag3', w.pass), /pass@/); await w.turn()
  assert.equal((await h.board.read()).tasks.find(t => t.id === a).state, 'done'); assert.equal(sh(d, 'show', 'epic/p1-x:b.txt'), 'b')
  const evs = Object.values((await h.events.read()).epics).flat().filter(e => e.type === 'task.transitioned' && e.taskId === a && e.data.to === 'done'); assert.equal(evs[0].actor, 'mod')
  assert.deepEqual((await h.ui.read()).digest, [`${a} "task 0" landed`])
  await w.rep('ag2', { role: 'worker', outcome: 'done', summary: 'did b' }); await w.turn(); assert.equal(w.spawned[3][2], 'cadre:reviewer')
  await w.rep('ag4', w.pass); await w.turn()
  const s = await h.board.read(); assert.deepEqual(s.tasks.map(t => t.state), ['done', 'done'])
  assert.equal(s.plan.state, 'done-on-dev'); assert.ok(s.plan.landed); assert.equal(sh(d, 'show', 'dev:c.txt'), 'b')
  assert.deepEqual((await h.ui.read()).digest, [`${a} "task 0" landed`, `${b} "task 1" landed`, `plan ${w.epic} completed`])
  assert.equal(s.drive.on, false); assert.equal(s.drive.turns, 4)   // the run finished; its four spawns were its four steps
  assert.deepEqual(w.submitted, []); assert.equal(w.spawned.length, 4)
})

test('rework stays as it was: changes -> the worker step, no worker bound -> the spawner starts a worker again (rebind with the handoff)', async () => {
  const w = await world(1), id = w.ids[0]; await arm(w.h, 'auto'); await w.turn(); edit(await w.wt(id))
  await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' }); await w.turn()
  await w.h.bind.update(x => { const { ag1, ...r } = x; return r })   // the worker is gone (its run ended)
  assert.match(await w.rep('ag2', { ...w.pass, verdict: 'changes', findings: [{ severity: 'major', file: 'b.txt', issue: 'wrong' }] }), /changes \(1\/3\)/)
  await w.turn(); assert.equal(w.spawned[2][2], 'cadre:worker'); assert.match(w.spawned[2][1], /## Handoff\n[\s\S]*Review of \w+ asks for changes|## Handoff/)
  assert.equal((await budgetOf(w.h, id)).rework, 1)
})

test('yolo: a blocked task\'s question goes to main once from the spawner, not at every turn end; the other task goes on', async () => {
  const w = await world(2), [a] = w.ids; await w.h.board.update(b => ({ ...b, containment: { state: 'contained', unsandboxed: 0 } })); await arm(w.h, 'yolo'); await w.turn()
  assert.match(await w.rep('ag1', { role: 'worker', outcome: 'blocked', summary: 's', reason: 'which db?' }), /blocked recorded/)
  await w.turn(); await w.turn()
  assert.equal(w.submitted.length, 1); assert.match(w.submitted[0], new RegExp(`Task ${a} is blocked[\\s\\S]*which db\\?`))
})

test('idle fallback: a dialog answer with nothing running hands main one short turn; with an agent at work, none', async () => {
  const w = await world(2, { maxParallel: 1 }); await arm(w.h, 'auto')
  await w.h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'resolve x' } })); await kick(w.h)
  assert.equal((await w.h.ui.read()).goal, IDLE); await w.h.ui.update(u => ({ ...u, goal: undefined }))
  await w.turn(); assert.equal(w.spawned.length, 1)   // the main turn's end: the spawner starts the first task
  await w.h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'resolve x' } })); await kick(w.h); assert.equal((await w.h.ui.read()).goal, undefined)
})

test('/cadre (a command frame) starts agents at once and drops the queued idle turn; it never submits', async () => {
  const w = await world(1); await arm(w.h, 'auto'); await w.h.ui.update(u => ({ ...u, goal: IDLE }))
  await spawnStep(w.h, 'command.run'); assert.equal(w.spawned.length, 1); assert.equal((await w.h.ui.read()).goal, undefined); assert.deepEqual(w.submitted, [])
})

test('watchdog: nothing running with work to start -> the idle turn, at most every 2 minutes, counted as a turn', async () => {
  const w = await world(1); await arm(w.h, 'auto'); const t0 = (await w.h.board.read()).drive.turns
  await watchdog(w.h); assert.equal((await w.h.ui.read()).goal, undefined)   // the first look starts the window (main may be mid-turn)
  await w.h.ui.update(u => ({ ...u, idleAt: -200_000 })); await watchdog(w.h); assert.equal((await w.h.ui.read()).goal, IDLE); await w.h.ui.update(u => ({ ...u, goal: undefined }))
  await watchdog(w.h); assert.equal((await w.h.ui.read()).goal, undefined)   // within the window
  assert.equal((await w.h.board.read()).drive.turns, t0 + 1)
  await w.turn(); await w.h.ui.update(u => ({ ...u, idleAt: -200_000 })); await watchdog(w.h); assert.equal((await w.h.ui.read()).goal, undefined)   // an agent runs: no kick
})

test('usage limit: the agent\'s task goes back without an attempt, drive stops until the reset (cause limit), nothing starts meanwhile', async () => {
  const w = await world(1), id = w.ids[0]; await arm(w.h, 'auto'); await w.turn()
  w.h.usage = async () => ({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(0).toISOString() }] })   // on this test's clock: the reset is 15 minutes on
  await stopped(w.h, w.dep, { agentId: 'ag1', reason: 'error', answer: 'API Error' })
  const t = (await w.h.board.read()).tasks[0]; assert.equal(t.state, 'todo'); { const { epoch: _spawns, ...charged } = await budgetOf(w.h, id); assert.ok(Object.values(charged).every(v => v === 0)) }   // no charge at all
  const d = (await w.h.board.read()).drive; assert.match(d.stopped, /usage limit until/); assert.equal(d.cause.flag, 'limit'); assert.deepEqual(await w.h.bind.read(), {})
  await w.turn(); assert.equal(w.spawned.length, 1)
  const at = d.cause.resetAt; w.h.now = async () => at + 1000; await watchdog(w.h)   // past the reset: the timer lifts it and main gets a turn (the timer starts nothing)
  assert.equal((await w.h.board.read()).drive.stopped, undefined); assert.equal(w.spawned.length, 1); assert.equal((await w.h.ui.read()).goal, IDLE)
  await w.turn(); assert.equal(w.spawned.length, 2)   // main's turn end: it starts again
})

test('a resume queued in the spawner\'s own frame (a close that sent the worker back) goes out from that frame', async () => {
  const w = await world(1), id = w.ids[0]; await arm(w.h, 'auto'); await w.turn()
  await queueResume(w.h, { agentId: 'ag1', taskId: id, text: 'The plan moved on: resolve the conflicts, then report done again.' })
  await w.turn(); assert.deepEqual(w.sent.map(x => x[0]), ['ag1']); assert.match(w.sent[0][1], /resolve the conflicts/)
})

test('/cadre continue in mod mode: no step of main\'s -> no brief from a frame that spawns; a press (no frame) gets the idle turn', async () => {
  const w = await world(1); await arm(w.h, 'auto')
  await continueRun(w.h); assert.equal((await w.h.ui.read()).goal, undefined)
  const { spawnAgent, ...press } = w.h; Object.setPrototypeOf(press, Object.getPrototypeOf(w.h)); await continueRun(press); assert.equal((await w.h.ui.read()).goal, IDLE)
})

test('a quit under way starts nothing; the owner is recorded before the spawn, so a session that dies mid-spawn reads as gone', async () => {
  const w = await world(2), [a, b] = w.ids; await arm(w.h, 'auto')
  let seen; const claim = w.store.claim.bind(w.store); w.store.claim = async (...x) => { seen = (await w.store.control()).doc[`hb:${a}`]; return claim(...x) }   // what a session killed during the claim leaves
  await w.turn(); assert.deepEqual(seen, { s: 's1', at: 0 })
  life.ending = true; try { w.h.spawnAgent = async () => assert.fail('spawned while quitting'); await w.turn() } finally { life.ending = false }
})
test('an explorer that cannot start keeps its questions for the next tick, and the tick still starts its tasks', async () => {
  const w = await world(1); await arm(w.h, 'auto'); await w.h.ui.update(u => ({ ...u, explore: ['where is auth?', 'who calls f?'] }))
  const rand = w.h.rand; let once = true; w.h.rand = n => { if (once) { once = false; throw new Error('store busy') } return rand(n) }
  await w.turn(); assert.equal(w.spawned.length, 1); assert.deepEqual((await w.h.ui.read()).explore, ['where is auth?', 'who calls f?'])
})
