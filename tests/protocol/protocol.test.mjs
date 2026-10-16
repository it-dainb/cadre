// Dev-only (ADR 0003): adapter protocol conformance + sync engine against the fake adapter (real one-shot spawns).
// node --experimental-transform-types --import ./tests/dev/register.mjs --test tests/protocol/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { call, AdapterError } = await import('../../task-management/protocol.ts')
const L = await import('../../task-management/sync-engine/loop.ts')
const { FileStore } = await import('../../task-management/adapters/file/store.ts')
const { defaults } = await import('../../task-management/registry.ts')
const { fakeHost } = await import('../support.ts')
const { emit } = await import('../../core/events.ts')
const { defaults: cfgDefaults } = await import('../../config/index.ts')

const FAKE = new URL('../../adapters/fake/fake-adapter.mjs', import.meta.url).pathname
const GRANTS = ['sync', 'events']
const adapterCfg = (grants = GRANTS, extra = {}) => ({ command: ['node', FAKE], grants, ...extra })

// one-shot spawn like Host.spawn: stdin = input, closed; env carries the fake remote's state file
const spawner = file => async ({ argv, input }) => new Promise((res, rej) => {
  const p = spawn(argv[0], argv.slice(1), { env: { ...process.env, FAKE_ADAPTER_STATE: file } }); let stdout = '', stderr = ''
  p.stdout.on('data', d => (stdout += d)); p.stderr.on('data', d => (stderr += d)); p.on('error', rej); p.on('close', code => res({ exitCode: code, stdout, stderr })); p.stdin.end(input)
})
const remote = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
const edit = (file, fn) => { const s = remote(file); fn(s); writeFileSync(file, JSON.stringify(s)) }

async function world({ adapters = { fake: adapterCfg() }, sync = { trk: { adapter: 'fake', project: 'p1', direction: 'both' } }, journal = true } = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'cadre-sync-')), 'remote.json')
  let t = 1_700_000_000_000, r = 0
  const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { timeout: o.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
  const fh = { run, now: async () => t, rand: (k = 16) => (++r).toString(16).padStart(k * 2, '0'), write: async (p, x) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, x) } }
  const store = new FileStore(fh, join(dirname(file), 'state'), 's1'); await store.init({ types: defaults(), journal })   // the file store on real sh/ln/mv
  const config = { ...cfgDefaults(), adapters, sync }
  const files = {}, h = Object.assign(fakeHost({ t0: t, files }), { taskStore: async () => store, config: async () => config, spawn: spawner(file), run: async () => ({ exitCode: 0, stdout: 'x', stderr: '' }), cwd: async () => '/repo' })
  let n = 0; h.rand = (k = 16) => (++n).toString(16).padStart(k * 2, '0')
  const advance = ms => { t += ms; h.now = async () => t }
  h.now = async () => t
  const epic = await store.createEpic('E', 'goal'), ids = []
  for (const title of ['one', 'two']) ids.push((await store.createDraft({ title, description: `${title} d`, type: 'feature', parent: epic })).id)
  await store.approve(ids)
  await h.board.update(b => ({ ...b, epic, tasks: ids.map(id => ({ id, title: id, type: 'feature', kind: 'code', merges: true, state: 'todo', step: '', phaseSince: 0, deps: [], flags: [] })) }))
  return { h, store, file, ids, epic, advance, config, files }
}

test('conformance: ping describe describeSchema listProjects validateAccess (no writes) push (idempotent) pull (cursor)', async () => {
  const { h, file } = await world(), a = adapterCfg(), c = (m, p) => call(h, 'fake', a, m, p)
  assert.deepEqual(await c('ping'), { pong: true })
  assert.deepEqual((await c('describe')).caps, GRANTS)
  assert.ok((await c('describeSchema')).statuses.includes('In Progress'))
  assert.equal((await c('listProjects'))[0].id, 'p1')
  assert.equal(remote(file).writes ?? 0, 0)
  assert.equal((await c('validateAccess', { project: 'p1' })).auth, true)
  assert.equal(remote(file).writes ?? 0, 0, 'validateAccess must not write')
  const tasks = [{ localId: 'm-1', changed: ['title'], fields: { title: 'A' } }]
  const r1 = await c('push', { tasks }), r2 = await c('push', { tasks })
  assert.deepEqual(r1.results[0].rid, r2.results[0].rid); assert.equal(r1.results[0].etag, r2.results[0].etag)   // idempotent
  assert.equal(Object.keys(remote(file).tasks).length, 1)
  const p1 = await c('pull', {}); assert.equal(p1.tasks.length, 1)
  assert.equal((await c('pull', { since: p1.next })).tasks.length, 0)   // cursor
})

test('framing, versions, error codes, grants, credentials', async () => {
  const { h, file } = await world()
  await assert.rejects(call(h, 'fake', adapterCfg(['events']), 'push', {}), e => e instanceof AdapterError && e.code === 'Unsupported' && /sync grant/.test(e.message))
  await assert.rejects(call(h, 'fake', adapterCfg(), 'nope'), e => e.code === 'Unsupported')
  edit(file, s => { s.mode = 'ratelimited' }); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'RateLimited' && e.retryAfterMs === 45000)
  edit(file, s => { s.mode = 'auth' }); await assert.rejects(call(h, 'fake', adapterCfg(), 'listProjects'), e => e.code === 'Auth')
  edit(file, s => { s.mode = 'offline' }); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'Offline')
  const bad = (stdout, exitCode = 0) => Object.assign(h, { spawn: async () => ({ exitCode, stdout, stderr: '' }) })
  bad('{"v":2,"ok":true,"result":1}'); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'Invalid' && /version 2/.test(e.message))
  bad('not json'); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'Invalid')
  bad('', 3); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'Offline')
  bad('{"v":1,"ok":false,"error":{"code":"Weird","message":"m"}}'); await assert.rejects(call(h, 'fake', adapterCfg(), 'ping'), e => e.code === 'Invalid')
  h.run = async () => ({ exitCode: 1, stdout: '', stderr: '' }); await assert.rejects(call(h, 'fake', adapterCfg(GRANTS, { credentialEnv: 'FAKE_KEY' }), 'ping'), e => e.code === 'Auth' && /FAKE_KEY/.test(e.message))
})

test('push: changed fields only by hash, idempotent across ticks, first target sets externalRef', async () => {
  const { h, store, file, ids, advance } = await world()
  await L.tick(h); let r = remote(file); assert.equal(Object.keys(r.tasks).length, 2)
  assert.ok((await store.get(ids[0])).externalRef.startsWith('trk:'))
  const pushes = () => Object.values(remote(file).tasks).map(t => t.pushes)
  assert.deepEqual(pushes(), [1, 1])
  advance(40_000); await L.tick(h); assert.deepEqual(pushes(), [1, 1], 'no change, no push')
  await store.update(ids[0], { title: 'one!' }, 'cadre/x'); advance(40_000); await L.tick(h)
  assert.deepEqual(pushes(), [2, 1]); assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'one!')
  assert.ok((await store.control()).doc['sync.trk'].cursor)   // lease + cursor in the control doc
  assert.equal((await h.board.read()).sync[0].state, 'ok')
})

test('pull + 3-way merge: remote edit pulled (+sync, flag edited); both changed -> local wins + remote comment + conflict; status change -> drift', async () => {
  const { h, store, file, ids, advance } = await world()
  await L.tick(h); const rid = i => Object.keys(remote(file).tasks)[i]
  edit(file, s => { s.tasks[rid(0)].fields.title = 'remote title'; s.tasks[rid(0)].etag = '9'; s.tasks[rid(0)].seq = ++s.seq })
  advance(40_000); await L.tick(h)
  assert.equal((await store.get(ids[0])).title, 'remote title'); assert.ok((await h.board.read()).tasks[0].flags.includes('edited'))
  assert.equal(Object.values(remote(file).tasks)[0].pushes, 1, 'pulled value is not pushed back')
  await store.update(ids[1], { title: 'local two' }, 'cadre/x')
  edit(file, s => { s.tasks[rid(1)].fields.title = 'remote two'; s.tasks[rid(1)].etag = '8'; s.tasks[rid(1)].seq = ++s.seq })
  advance(40_000); await L.tick(h)
  const t2 = remote(file).tasks[rid(1)]; assert.equal((await store.get(ids[1])).title, 'local two'); assert.equal(t2.fields.title, 'local two'); assert.match(t2.comments[0], /local value was kept/)
  assert.ok((await h.board.read()).tasks[1].flags.includes('conflict'))
  assert.equal((await store.get(ids[1])).meta['cadre.remote.title'], 'remote two', 'the pulled value is kept for /cadre resolve accept')
  edit(file, s => { s.tasks[rid(0)].fields.status = 'Closed'; s.tasks[rid(0)].etag = '10'; s.tasks[rid(0)].seq = ++s.seq })
  advance(40_000); await L.tick(h)
  assert.ok((await store.get(ids[0])).meta['cadre.remote.status']); assert.ok((await h.board.read()).tasks[0].flags.includes('drift')); assert.equal(remote(file).tasks[rid(0)].fields.status, 'todo', 'local wins: status pushed back')
})

test('lease: a live lease of another session skips the target; expired takes over', async () => {
  const { h, store, file, advance } = await world()
  await L.tick(h); await store.setControl({ 'sync.trk': { cursor: '0', lease: { session: 'other', until: (await h.now()) + 60_000 } } })
  await store.update((await store.list({})).find(t => t.title === 'one').id, { title: 'changed' }, 'cadre/x'); advance(40_000); await L.tick(h)
  assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'one', 'not pushed while another session leads')
  advance(80_000); await L.tick(h); assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'changed')
})

test('the cursor survives compaction: folded past it, the next tick heals from the head and pushes what changed', async () => {
  const { h, store, file, ids, advance } = await world()
  await L.tick(h); const c0 = (await store.control()).doc['sync.trk'].cursor
  for (const x of ['a', 'b', 'c']) await store.update(ids[0], { title: x }, 'cadre/x')
  await store.compact(0); advance(40_000); await L.tick(h)
  assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'c'); assert.equal((await h.board.read()).sync[0].state, 'ok')
  assert.ok(Number((await store.control()).doc['sync.trk'].cursor) > Number(c0))
})

test('backoff 30s -> 5 min, sync.state_changed, recovery heals', async () => {
  const { h, file, advance } = await world()
  await L.tick(h); edit(file, s => { s.mode = 'offline' })
  advance(40_000); await L.tick(h); assert.equal((await h.board.read()).sync[0].state, 'offline')
  const seen = []; const rt = async () => (await h.store.get('sync.rt:trk')); const b1 = (await rt()).backoff; assert.equal(b1, 30_000)
  advance(31_000); await L.tick(h); assert.equal((await rt()).backoff, 60_000)
  for (let i = 0; i < 6; i++) { advance(310_000); await L.tick(h) } assert.equal((await rt()).backoff, 300_000)
  edit(file, s => { delete s.mode }); advance(310_000); await L.tick(h); assert.equal((await h.board.read()).sync[0].state, 'ok')
  const evs = Object.values((await h.events.read()).epics).flat().filter(e => e.type === 'sync.state_changed').map(e => e.data.state); assert.deepEqual(evs.slice(0, 2), ['offline', 'ok'])
})

test('crash-resume: cursor not advanced -> replay is idempotent (no duplicates), also when per-task meta was lost', async () => {
  const { h, store, file, ids, advance } = await world()
  const real = store.setMeta.bind(store); let boom = true
  store.setMeta = async (id, kv, actor, rev) => { if (boom && Object.keys(kv).some(k => k === 'cadre.sync.trk') && !JSON.parse(Object.values(kv)[0]).cursor && !JSON.parse(Object.values(kv)[0]).lease) throw new Error('crash'); return real(id, kv, actor, rev) }
  await L.tick(h)   // adapter got the pushes, then the per-task meta writes "crashed": tick records an offline state
  assert.equal(Object.keys(remote(file).tasks).length, 2); assert.equal((await h.board.read()).sync[0].state, 'offline')
  boom = false; advance(40_000); await L.tick(h)
  assert.equal(Object.keys(remote(file).tasks).length, 2, 'replay upserts by localId: no duplicate remote tasks'); assert.equal((await h.board.read()).sync[0].state, 'ok')
  assert.ok(JSON.parse((await store.get(ids[0])).meta['cadre.sync.trk']).rid)
})

test('no journal: full scan every tick (heal path), still level-triggered', async () => {
  const { h, store, file, ids, advance } = await world({ journal: false })
  await L.tick(h); await store.update(ids[1], { title: 'two!' }, 'cadre/x'); advance(40_000); await L.tick(h)
  assert.equal(Object.values(remote(file).tasks)[1].fields.title, 'two!')
})

test('deliver: events + snapshot (the model view, always); an adapter cannot send commands and decides nothing (ADR 0012)', async () => {
  const { h, file, advance } = await world({ adapters: { ui: adapterCfg(['events']), pub: adapterCfg(['events']) }, sync: {} })
  await emit(h, 'drive.status', { state: 'on' }); await L.tick(h)
  const d = remote(file).delivered; assert.equal(d.length, 2)   // ui + pub share the file here: both delivered once
  assert.equal(d[0].reset, true); assert.ok(d[0].events.length >= 1); assert.ok(!('seq' in d[0].snapshot) && !('seq' in d[1].snapshot), 'every adapter gets the model view')
  assert.ok(!JSON.stringify(d).match(/code8|initConfirm|"token"|decisions/))
  assert.equal(L.runCommand, undefined, 'no adapter command entry exists')
  // returned commands ride the next deliver; unchanged state sends nothing
  advance(10_000); await L.tick(h); const n = remote(file).delivered.length; advance(10_000); await L.tick(h); assert.equal(remote(file).delivered.length, n, 'unchanged state sends nothing')
  edit(file, s => { s.commands.push({ cmd: 'approve', args: ['p1'] }) })
  const r = await L.deliver(h, 'ui', adapterCfg(['events']), true); assert.deepEqual(r.results, ['refused: adapter ui cannot send commands; decisions are buttons in the pane'])
  await emit(h, 'drive.status', { state: 'off' }); advance(10_000); await L.tick(h)
  assert.equal(remote(file).delivered.length > n, true)
})

test('guided setup: 5 confirmed diffs; project must exist (never created); mapping from the schema; validate without writes; direction init', async () => {
  const { h, file, files, store } = await world({ sync: {} }), A = (...a) => L.syncAdd(h, 'fake', a)
  assert.match(await A(), /1\/5 connection/)
  assert.match(await A('url=http://trk'), /step 1\/5: proposed changes[^]*sync\.fake[^]*url/)
  assert.match(await A('url=http://trk'), /proposed changes/); assert.match(await A('confirm'), /step 1\/5 done/); assert.match(await A('confirm'), /nothing pending/)
  assert.match(await A(), /2\/5 project[^]*never creates[^]*p1 \(Demo\)/); assert.match(await A('project=nope'), /2\/5 project/)
  assert.equal(remote(file).projects?.length ?? 1, 1)
  await A('project=p1'); await A('confirm')
  const m3 = await A(); assert.match(m3, /3\/5|mapping/); assert.match(m3, /"active":"In Progress"/); await A('confirm')
  const m4 = await A(); assert.match(m4, /5\/5 initial direction/); assert.equal(remote(file).writes ?? 0, 0, 'steps 1-4 never write remotely')
  assert.match(await A('direction=push'), /sync cursor init \(push\)/); assert.match(await A('confirm'), /done/)
  const cfg = JSON.parse(files['/repo/.cadre/config.json']).sync.fake; assert.equal(cfg.project, 'p1'); assert.equal(cfg.direction, 'both'); assert.equal(cfg.mapping.status.done, 'Closed')
  assert.deepEqual((await store.control()).doc['sync.fake'], { cursor: undefined, lastHeal: 0 })
})

test('guided setup blocks: no permission / required custom field without default / unknown adapter', async () => {
  const w = await world({ sync: {} }), A = (...a) => L.syncAdd(w.h, 'fake', a)
  assert.match(await L.syncAdd(w.h, 'zzz'), /no adapters\.zzz/)
  edit(w.file, s => { s.customFields = [{ name: 'Severity', required: true }] })
  await A('url=u'); await A('confirm'); await A('project=p1'); await A('confirm')
  assert.match(await A(), /blocked[^]*Severity/)
  edit(w.file, s => { s.customFields = []; s.perms = { view: true, add: false, edit: true } })
  await A(); await A('confirm')
  assert.match(await A(), /4\/5 validate: blocked: no add permission/)
})

test('external = status/assignee change by a foreign actor only; a title edit is not; deltas for pulled edits reach bound agents', async () => {
  const { h, store, file, ids, advance } = await world()
  await L.tick(h); advance(40_000); await L.tick(h)
  await store.update(ids[0], { title: 'foreign title' }, 'jira'); advance(40_000); await L.tick(h)
  assert.ok(!(await h.board.read()).tasks[0].flags.includes('external'), 'title edit is not external')
  await store.claim(ids[1], 'jira'); advance(40_000); await L.tick(h)
  assert.ok((await h.board.read()).tasks[1].flags.includes('external'), 'status change by jira is')
  await h.bind.update(() => ({ ag1: { taskId: ids[0], role: 'worker', step: 'worker', worktree: '/w', sessionId: 's', ctxTokens: 0, startedAt: 1 } }))
  const rid = Object.keys(remote(file).tasks)[0]
  edit(file, s => { s.tasks[rid].fields.description = 'remote desc'; s.tasks[rid].etag = '77'; s.tasks[rid].seq = ++s.seq })
  advance(40_000); await L.tick(h)
  const { drainDelta } = await import('../../core/briefs.ts'); assert.match(await drainDelta(h, 'ag1'), /edited on the tracker: description = "remote desc"/)
})

test('mission -> version, decision -> comment on the linked task (push-only special cases)', async () => {
  const { h, store, file, ids, advance } = await world()
  await store.record('mission', 'Ship v1', 'mission body'); const d = await store.record('decision', 'Chose X', 'because', ids[0])
  await L.tick(h); advance(40_000); await L.tick(h)
  const sent = Object.values(remote(file).tasks), ver = sent.find(t => t.fields.title === 'Ship v1'), dec = sent.find(t => t.fields.title === 'Chose X')
  assert.ok(ver && dec); assert.deepEqual(Object.keys(ver.fields), ['title', 'description'])
  assert.equal(ver.kind, 'version'); assert.equal(dec.kind, 'comment'); assert.equal(dec.on, Object.keys(remote(file).tasks).find(r => remote(file).tasks[r].localId === ids[0]))
})
