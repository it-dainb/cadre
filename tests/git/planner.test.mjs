// Dev-only: the epic planner (ADR 0021) on real git + MemoryStore, mod mode: a 2-epic milestone where the spawner starts one planner per ready epic, each plan
// is checked and approved automatically (its epic branch cut from the milestone), the tasks run, both epics land on the milestone and the milestone on dev.
// Main takes no turn. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { defaults: types } = await import('../../task-management/registry.ts')
const { admitWith } = await import('../../core/admission.ts')
const { handleWith } = await import('../../tools/index.ts')
const { mirror } = await import('../../core/dispatch.ts')
const { arm } = await import('../../core/drive.ts')
const { spawnStep } = await import('../../core/spawner.ts')
const { skeleton } = await import('../../core/changelog.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const IFACE = { symbols: [{ name: 'f', kind: 'function', params: [], returns: 'string', status: 'new' }] }
const TASK = (subject, path) => ({ subject, description: `write ${path}`, metadata: { type: 'refactor', package: '.', scenarios: ['S1: Given the repo When it builds Then it passes'], changelog: { none: true, reason: 'internal' }, interface: IFACE, paths: [path] } })

test('a 2-epic milestone: both epic plans come from planners started by cadre; every task lands; the milestone lands on dev; main takes no turn', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-planner-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'CHANGELOG.md'), skeleton()); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'; cfg.drive.spawn = 'mod'; cfg.packages = [{ root: '.', verify: ['verify'], checks: { verify: ['true'] } }]
  const store = new MemoryStore(); await store.init({ types: types(), journal: true })
  const m = await store.createEpic('accounts', 'two features'), ms = `milestone/${m}-accounts`; sh(d, 'branch', ms, 'dev')
  await store.setMeta(m, { 'cadre.lane': 'milestone' }, 't')
  const es = []
  for (const [name, f] of [['signup', 'a.txt'], ['login', 'b.txt']]) es.push((await store.createDraft({ title: name, description: `users can ${name}`, type: 'epic', parent: m, meta: { 'cadre.size': '1', 'cadre.paths': JSON.stringify([f]) } })).id)
  await store.approve(es)
  const h = fakeHost({ env: { CADRE_SPAWN: 'mod' } }); let tick = 0
  const submitted = [], spawned = []
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    submit: async t => { submitted.push(t) }, sendTo: async () => ({ isDelivered: true }), usage: async () => ({ cost: { usd: 0 } }), taskStore: async () => store, config: async () => cfg })
  const dep = { store, cfg, reg: cfg.types, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' }))
  await h.board.update(b => ({ ...b, seq: 1, epic: m, plan: { id: m, slug: 'accounts', state: 'approved', epicBranch: ms, lane: 'milestone', mode: 'auto' } }))
  await mirror(h, store, types())
  let k = 0
  const cadre = Object.assign(async e => { const id = `ag${++k}`; spawned.push([id, e.subagentType, e.prompt]); return { agentId: id, model: 'm' } }, { origin: { plugin: 'cadre', tier: 'user' } })
  h.spawnAgent = a => admitWith(h, dep, { ...a, background: true }, cadre)
  const turn = () => spawnStep(h, 'turn.complete'), rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  const pass = { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] }
  const states = async () => (await h.board.read()).plan.epics.map(e => e.state)

  await arm(h, 'auto'); assert.equal((await h.board.read()).drive.planner, 'agent'); assert.deepEqual(await states(), ['ready', 'ready'])
  await turn()
  assert.deepEqual(spawned.map(x => x[1]), ['cadre:planner', 'cadre:planner']); assert.match(spawned[0][2], new RegExp(`# PLAN-${es[0]} signup`))
  assert.match(await rep('ag1', { role: 'planner', summary: 'one task', tasks: [TASK('Write a', 'a.txt')] }), /plan accepted/)
  assert.match(await rep('ag2', { role: 'planner', summary: 'one task', tasks: [TASK('Write b', 'b.txt')] }), /plan accepted/)
  assert.deepEqual(await states(), ['running', 'running'])
  for (const [e, n] of [[es[0], 'signup'], [es[1], 'login']]) assert.equal(sh(d, 'rev-parse', `epic/${e}-${n}`), sh(d, 'rev-parse', ms))   // cut from the milestone tip
  assert.equal((await store.list({})).filter(x => x.type === 'decision' && /drafted by the planner/.test(x.title)).length, 2)

  await turn(); assert.deepEqual(spawned.slice(2).map(x => x[1]), ['cadre:worker', 'cadre:worker'])
  const [a, b] = (await h.board.read()).tasks.map(t => t.id), wt = async id => (await store.get(id)).meta['cadre.worktree']
  writeFileSync(join(await wt(a), 'a.txt'), 'a\n'); writeFileSync(join(await wt(b), 'b.txt'), 'b\n')
  assert.match(await rep('ag3', { role: 'worker', outcome: 'done', summary: 'a' }), /report accepted/); assert.match(await rep('ag4', { role: 'worker', outcome: 'done', summary: 'b' }), /report accepted/)
  await turn(); assert.deepEqual(spawned.slice(4).map(x => x[1]), ['cadre:reviewer', 'cadre:reviewer'])
  // the second pass and its reviewer's turn end come while the first turn end is squashing (live: that landing had read the board before the pass; nothing landed it after)
  let late; const run0 = h.run
  h.run = async (argv, o) => { if (!late && argv.includes('--squash')) late = (async () => { assert.match(await rep('ag6', pass), /pass@/); await turn() })(); return run0(argv, o) }
  assert.match(await rep('ag5', pass), /pass@/); await turn(); await late; h.run = run0
  const s = await h.board.read()
  assert.deepEqual(s.tasks.map(t => t.state), ['done', 'done']); assert.deepEqual(await states(), ['landed', 'landed'])
  assert.equal(s.plan.state, 'done-on-dev'); assert.equal(sh(d, 'show', 'dev:a.txt'), 'a'); assert.equal(sh(d, 'show', 'dev:b.txt'), 'b')
  assert.deepEqual(submitted, [])   // main took no turn: it planned no epic and spawned nothing
})
