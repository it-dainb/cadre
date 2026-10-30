// The sync module (plan 2.15, D17) end to end: core/syncrun starts the real `node modules/sync.mjs` through core/modrun against the fake adapter and the file store, and applies its result.
// Every test is under 5 s; nothing sleeps (the clock is a stub, the hang is a 1 s wall). node --experimental-transform-types --import ./tests/dev/register.mjs --test tests/modules/sync.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const S = await import('../../core/syncrun.ts')
const { FileStore } = await import('../../task-management/adapters/file/store.ts')
const { types: dt } = await import('../../profiles/default.ts')
const { fakeHost } = await import('../support.ts')
const { emit } = await import('../../core/events.ts')
const { drainDelta } = await import('../../core/briefs.ts')
const { ROUTES, isHuman, initPropose } = await import('../../core/dispatch.ts')
const { defaults, resolve } = await import('../../config/index.ts')
const { modrun, envSet } = await import('../../core/modrun.ts')

const PLUGIN = new URL('../..', import.meta.url).pathname.replace(/\/$/, ''), FAKE = `${PLUGIN}/adapters/fake/fake-adapter.mjs`, LEASE = 120_000
process.env.REDMINE_API_KEY = 'tok-redmine'; process.env.GH_TOKEN = 'tok-gh'
const adapter = (grants = ['sync', 'events'], extra = {}) => ({ command: ['node', FAKE], envPass: ['FAKE_ADAPTER_STATE'], grants, ...extra })
const run = (argv, o = {}) => new Promise((res, rej) => execFile(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : process.env, timeout: o.timeoutMs, killSignal: 'SIGKILL' },
  (err, stdout, stderr) => (err?.killed ? rej(new Error('timeout')) : res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }))))
const stat = async (p, o) => { try { const { realpathSync, statSync } = await import('node:fs'); const s = statSync(p); return { kind: s.isDirectory() ? 'dir' : 'file', realPath: o?.resolve ? realpathSync(p) : undefined } } catch { return undefined } }

async function world({ adapters = { fake: adapter(['sync']) }, sync = { trk: { adapter: 'fake', project: 'p1', direction: 'both' } }, journal = true, titles = ['one', 'two'], plugin = PLUGIN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadre-sync-')), file = join(dir, 'remote.json'), repo = join(dir, 'repo'); mkdirSync(repo)
  let t = 1_700_000_000_000, r = 0
  const rand = (k = 16) => (++r).toString(16).padStart(k * 2, '0'), runs = []
  const fh = { run, now: async () => t, rand, write: async (p, x) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, x) } }
  const store = new FileStore(fh, join(dir, 'state'), 's1'); await store.init({ types: dt, journal })
  const config = { ...defaults(), adapters, sync }, files = {}
  const mk = (id = 's1') => {
    const h = Object.assign(fakeHost({ t0: t, files }), { taskStore: async () => store, config: async () => config, cwd: async () => repo, home: async () => dir, root: async () => plugin, stat, rand,
      run: async (argv, init = {}) => { runs.push(argv); return run(argv, { ...init, env: { ...init.env, FAKE_ADAPTER_STATE: file } }) }, write: fh.write, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return files[p] ?? null } } })
    h.now = async () => t; h.secret = { read: async () => ({ active: true, session: id }), update: async () => ({}) }
    return h
  }
  const h = mk(), epic = await store.createEpic('E', 'goal'), ids = []
  for (const title of titles) ids.push((await store.createDraft({ title, description: `${title} d`, type: 'feature', parent: epic })).id)
  await store.approve(ids)
  await h.board.update(b => ({ ...b, epic, tasks: ids.map(id => ({ id, title: id, type: 'feature', kind: 'code', merges: true, state: 'todo', step: '', phaseSince: 0, deps: [], flags: [] })) }))
  return { h, mk, store, file, ids, epic, config, files, dir, runs, repo, advance: ms => { t += ms }, now: () => t }
}
const remote = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
const edit = (file, fn) => { const s = remote(file); fn(s); writeFileSync(file, JSON.stringify(s)) }
const rt = h => h.store.get('sync.rt:trk'), state = async h => (await h.board.read()).sync[0]?.state
const metaOf = async (store, id) => (await store.get(id)).meta['cadre.sync.trk']
const starts = runs => runs.filter(a => a.some(x => x.endsWith('sync.mjs'))).length
// a plugin folder whose modules/sync.mjs is `body`: a module that crashes, floods or hangs
const plugin = body => { const d = mkdtempSync(join(tmpdir(), 'cadre-plug-')); mkdirSync(join(d, 'modules')); writeFileSync(join(d, 'modules/sync.mjs'), body); return d }
const WRITE = x => `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.CADRE_RESULT, ${x})`

test('(1) push: two tasks -> two remote ids, the sync meta written, actor +sync, a second pass creates nothing', async () => {
  const { h, store, file, ids, advance } = await world()
  await S.syncTick(h); const r = remote(file); assert.equal(Object.keys(r.tasks).length, 2)
  for (const id of ids) assert.ok(JSON.parse(await metaOf(store, id)).rid)
  assert.ok((await store.get(ids[0])).externalRef.startsWith('trk:'))
  const ev = (await store.events(undefined, 100)).events.filter(e => e.op !== 'create'); assert.ok(ev.some(e => e.actor === 'cadre/fake+sync') && ev.every(e => !e.actor.endsWith('+sync') || e.actor === 'cadre/fake+sync'))
  const pushes = () => Object.values(remote(file).tasks).map(t => t.pushes); assert.deepEqual(pushes(), [1, 1])
  advance(40_000); await S.syncTick(h); assert.deepEqual(pushes(), [1, 1], 'no change, no push'); assert.equal(await state(h), 'ok')
  await store.update(ids[0], { title: 'one!' }, 'cadre/x'); advance(40_000); await S.syncTick(h)
  assert.deepEqual(pushes(), [2, 1]); assert.ok((await store.control()).doc['sync.trk'].cursor)
})

test('(2) pull: a remote edit of a human field -> edit applied, edited flag, delta to the bound agent; a workflow field is not pulled', async () => {
  const { h, store, file, ids, advance } = await world()
  await S.syncTick(h); const rid = i => Object.keys(remote(file).tasks)[i]
  await h.bind.update(() => ({ ag1: { taskId: ids[0], role: 'worker', step: 'worker', worktree: '/w', sessionId: 's', ctxTokens: 0, startedAt: 1 } }))
  edit(file, s => { Object.assign(s.tasks[rid(0)].fields, { title: 'remote title', type: 'Bug' }); s.tasks[rid(0)].etag = '9'; s.tasks[rid(0)].seq = ++s.seq })
  advance(40_000); await S.syncTick(h)
  const t = await store.get(ids[0]); assert.equal(t.title, 'remote title'); assert.equal(t.type, 'feature', 'type is workflow: never pulled'); assert.ok((await h.board.read()).tasks[0].flags.includes('edited'))
  assert.match(await drainDelta(h, 'ag1'), /edited on the tracker: title = "remote title"/); assert.equal(remote(file).tasks[rid(0)].pushes, 1, 'the pulled value is not pushed back')
  edit(file, s => { s.tasks[rid(1)].fields.status = 'Closed'; s.tasks[rid(1)].etag = '10'; s.tasks[rid(1)].seq = ++s.seq }); advance(40_000); await S.syncTick(h)
  assert.ok((await h.board.read()).tasks[1].flags.includes('drift')); assert.equal((await store.get(ids[1])).category, 'todo'); assert.equal(remote(file).tasks[rid(1)].fields.status, 'todo', 'local wins: status pushed back')
})

test('(3) conflict: both sides change one field -> local wins, remote comment, conflict flag; non-overlapping changes both kept', async () => {
  const { h, store, file, ids, advance } = await world()
  await S.syncTick(h); const rid = i => Object.keys(remote(file).tasks)[i]
  await store.update(ids[0], { title: 'local one' }, 'cadre/x'); edit(file, s => { s.tasks[rid(0)].fields.title = 'remote one'; s.tasks[rid(0)].etag = '8'; s.tasks[rid(0)].seq = ++s.seq })
  advance(40_000); await S.syncTick(h); const t1 = remote(file).tasks[rid(0)]
  assert.equal((await store.get(ids[0])).title, 'local one'); assert.equal(t1.fields.title, 'local one'); assert.match(t1.comments[0], /local value was kept/)
  assert.ok((await h.board.read()).tasks[0].flags.includes('conflict')); assert.equal((await store.get(ids[0])).meta['cadre.remote.title'], 'remote one')
  await store.update(ids[1], { title: 'local two' }, 'cadre/x'); edit(file, s => { s.tasks[rid(1)].fields.description = 'remote desc'; s.tasks[rid(1)].etag = '7'; s.tasks[rid(1)].seq = ++s.seq })
  advance(40_000); await S.syncTick(h); const t2 = await store.get(ids[1])
  assert.deepEqual([t2.title, t2.description], ['local two', 'remote desc']); assert.equal(remote(file).tasks[rid(1)].fields.title, 'local two')
})

test('(4) lease: 120 s, a live lease of another session starts no module, expiry takes over; a late result is dropped; a stale op is dropped and the others apply', async () => {
  const w = await world(), { h, store, file, ids, advance, runs } = w
  await S.syncTick(h); const l = (await store.control()).doc['sync.trk'].lease; assert.equal(l.until - w.now(), LEASE)
  const h2 = w.mk('other'); await store.setControl({ 'sync.trk': { cursor: '0', lease: { session: 'other', until: w.now() + 60_000 } } })
  await store.update(ids[0], { title: 'changed' }, 'cadre/x'); advance(40_000); const n = starts(runs); await S.syncTick(h)
  assert.equal(starts(runs), n, 'no module starts while the lease is live'); assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'one')
  advance(30_000); await S.syncTick(h); assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'changed', 'after expiry it takes over'); void h2
  // a result that arrives after the lease lapsed and another session holds it: dropped at the guard, nothing written
  const late = await world(), run0 = late.h.run
  late.h.run = async (argv, init) => { const r = await run0(argv, init); if (argv.some(x => x.endsWith('sync.mjs'))) { late.advance(LEASE + 1000); await late.store.setControl({ 'sync.trk': { cursor: '0', lease: { session: 'other', until: late.now() + 60_000 } } }) } return r }
  await S.syncTick(late.h); assert.equal(Object.keys(remote(late.file).tasks).length, 2, 'the module did push')
  for (const id of late.ids) assert.equal(await metaOf(late.store, id), undefined, 'nothing written locally'); assert.equal(await state(late.h), 'offline'); assert.match((await rt(late.h)).message, /lease/)
  // an op whose base no longer matches is dropped, the others apply
  const st = await world(), run1 = st.h.run
  st.h.run = async (argv, init) => { const r = await run1(argv, init); if (argv.some(x => x.endsWith('sync.mjs'))) await st.store.update(st.ids[0], { title: 'edited while it ran' }, 'cadre/x'); return r }
  await S.syncTick(st.h); assert.equal(await metaOf(st.store, st.ids[0]), undefined, 'stale: dropped'); assert.ok(JSON.parse(await metaOf(st.store, st.ids[1])).rid, 'the other applies'); assert.equal((await rt(st.h)).stale, 2, 'its meta and ref ops')
})

test('(5) crash: exit 1, an invalid result, an oversized result and a hang each -> offline, backoff set, nothing applied from an invalid result', async () => {
  const cases = { exit: ['process.exit(1)', 1000], invalid: [WRITE(`JSON.stringify({ state: 'ok', ops: [{ op: 'meta', id: ID, key: 'cadre.sync.trk', value: 'x' }, { op: 'delete' }] })`), 1000],
    big: [WRITE(`JSON.stringify({ state: 'ok', message: 'x'.repeat(1.2e6) })`), 1000], hang: ['setTimeout(() => {}, 60000)', 1000] }
  for (const [name, [body, wall]] of Object.entries(cases)) {
    const w = await world({ plugin: '' }); const id = w.ids[0], d = plugin(`const ID = ${JSON.stringify(id)}\n${body}`); w.h.root = async () => d
    await S.syncTick(w.h, false, { ...S.LIM, wall }); const r = await rt(w.h)
    assert.equal(r.state, 'offline', name); assert.equal(r.backoff, 30_000, name); assert.equal(r.next, w.now() + 30_000, name)
    assert.equal(await state(w.h), 'offline', name); assert.equal(await metaOf(w.store, id), undefined, `${name}: nothing applied`); assert.equal((await w.store.get(id)).title, 'one')
    assert.equal((await w.h.board.read()).tasks.length, 2, 'the board is untouched')
  }
})

test('(5) partial: a module stopped at its deadline after pushing 2 of 4 records them, the cursor stays, the next cycle pushes the other 2 (no duplicate), also when it was killed', async () => {
  for (const kill of [false, true]) {
    const w = await world({ titles: ['a', 'b', 'c', 'd'] }); edit(w.file, s => { s.slow = 400 })
    const lim = kill ? { ...S.LIM, wall: 700, batch: 2 } : { ...S.LIM, deadline: 300, batch: 2 }
    await S.syncTick(w.h, false, lim)
    const done = []; for (const id of w.ids) if (await metaOf(w.store, id)) done.push(id)
    assert.equal(done.length, 2, `kill=${kill}: the first batch is recorded`); assert.equal((await w.store.control()).doc['sync.trk'].cursor, undefined, 'the cursor did not advance')
    if (!kill) assert.equal((await rt(w.h)).state, 'ok'); else assert.equal((await rt(w.h)).state, 'offline')
    edit(w.file, s => { delete s.slow }); w.advance(400_000); await S.syncTick(w.h)
    assert.equal(Object.keys(remote(w.file).tasks).length, 4, 'no duplicate remote ids'); for (const id of w.ids) assert.ok(JSON.parse(await metaOf(w.store, id)).rid)
    assert.equal(await state(w.h), 'ok')
  }
})

test('(6) credential hygiene: the module run and its adapter get REDMINE_API_KEY; the input file, hooks, providers and another unit do not; Doctor reads set or missing', async () => {
  const dump = join(mkdtempSync(join(tmpdir(), 'cadre-dump-')), 'adapter.mjs'), out = join(dirname(dump), 'env.json')
  writeFileSync(dump, `import { appendFileSync } from 'node:fs'; let s = ''; for await (const c of process.stdin) s += c; const m = JSON.parse(s).method; appendFileSync(${JSON.stringify(out)}, JSON.stringify({ m, env: process.env }) + '\\n')
process.stdout.write(JSON.stringify({ v: 1, ok: true, result: m === 'pull' ? { tasks: [], next: '1' } : { results: [] } }))`)
  const w = await world({ adapters: { fake: { command: ['node', dump], credentialEnv: 'REDMINE_API_KEY', grants: ['sync'] }, other: { command: ['node', dump], credentialEnv: 'GH_TOKEN', grants: ['sync'] } },
    sync: { trk: { adapter: 'fake', project: 'p1', direction: 'both' } } }), writes = []
  const w0 = w.h.write; w.h.write = async (p, x) => { writes.push(x); return w0(p, x) }
  await S.syncTick(w.h); const seen = readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.ok(seen.length >= 1 && seen.every(x => x.env.REDMINE_API_KEY === 'tok-redmine'), 'the adapter gets its credential'); assert.ok(seen.every(x => !('GH_TOKEN' in x.env) && !('CADRE_INPUT' in x.env) && !('POISON' in x.env)))
  assert.ok(writes.length && writes.every(x => !String(x).includes('tok-redmine')), 'the input file carries the name, never the value'); assert.ok(writes.some(x => String(x).includes('REDMINE_API_KEY')))
  // the same runner: a hook, a provider and another unit's module run declare no credential and get none; an envPass name reaches only its caller
  const DUMP = "require('fs').writeFileSync(process.env.CADRE_RESULT, JSON.stringify({ env: process.env }))", go = (name, o = {}) => modrun(w.h, { argv: ['node', '-e', DUMP], cwd: w.repo, input: {}, scratch: join(w.dir, name), ...o })
  const hook = await go('hook'), prov = await go('prov', { envPass: ['GH_TOKEN'] }), unit = await go('unit', { credentialEnv: 'GH_TOKEN' }), mine = await go('mine', { credentialEnv: 'REDMINE_API_KEY' })
  assert.ok(!('REDMINE_API_KEY' in hook.result.env) && !('GH_TOKEN' in hook.result.env)); assert.ok(!('REDMINE_API_KEY' in prov.result.env) && prov.result.env.GH_TOKEN === 'tok-gh')
  assert.ok(!('REDMINE_API_KEY' in unit.result.env) && unit.result.env.GH_TOKEN === 'tok-gh'); assert.equal(mine.result.env.REDMINE_API_KEY, 'tok-redmine')
  assert.equal(await envSet(w.h, 'REDMINE_API_KEY'), true); assert.equal(await envSet(w.h, 'NOT_SET_ANYWHERE'), false)
  // a repo file naming a credential or a command in a sync target is refused at load
  const user = { name: 'u', trust: 'user', value: { adapters: { fake: { command: ['x'], credentialEnv: 'REDMINE_API_KEY', url: 'http://pinned', grants: ['sync'] } } } }
  const repo = v => resolve([user, { name: '.cadre/config.json', trust: 'repo', value: { sync: { t: v } } }])
  for (const bad of [{ adapter: 'fake', credentialEnv: 'GH_TOKEN' }, { adapter: 'fake', command: ['evil'] }]) { const r = repo(bad); assert.equal(r.config.sync.t, undefined); assert.match(r.diagnostics.join('\n'), /sync\.t: only adapter/) }
  assert.equal(resolve([user, { name: '.cadre/config.json', trust: 'repo', value: { adapters: { fake: { credentialEnv: 'GH_TOKEN' } } } }]).config.adapters.fake.credentialEnv, 'REDMINE_API_KEY', 'a repo file cannot set credentialEnv')
})

test('(7) apply rules: no sync grant, an op outside the set, another target\'s meta key, another target -> refused, state unchanged; all or nothing; no sync.* command', async () => {
  const { h, store, ids } = await world(), u = (grants = ['sync']) => ({ id: 'trk', kind: 'target', adapter: 'fake', a: { grants }, target: 'trk' })
  const t0 = await store.get(ids[0]), edit1 = { op: 'edit', id: ids[0], fields: { title: 'new' } }
  const no = async (r, why, unit = u()) => { await assert.rejects(S.applySync(h, unit, r), why); assert.equal((await store.get(ids[0])).title, 'one'); assert.deepEqual((await store.get(ids[0])).meta, t0.meta) }
  await no({ state: 'ok', ops: [edit1] }, /no sync grant/, u(['events']))
  await no({ state: 'ok', ops: [edit1, { op: 'merge', id: ids[0] }] }, /outside the closed set/)   // the first op is valid: nothing applied (all or nothing)
  await no({ state: 'ok', ops: [edit1, { op: 'meta', id: ids[0], key: 'cadre.sync.other', value: 'x' }] }, /outside what a pull may set/)
  await no({ state: 'ok', ops: [edit1, { op: 'meta', id: ids[0], key: 'cadre.step', value: 'x' }] }, /outside what a pull may set/)
  await no({ state: 'ok', ops: [edit1, { op: 'edit', id: ids[0], fields: { type: 'bug' } }] }, /outside what a pull may set/)
  await no({ state: 'ok', ops: [edit1, { op: 'ref', id: ids[0], ref: 'other:1' }] }, /outside what a pull may set/)
  await no({ state: 'ok', target: 'other', ops: [edit1] }, /not trk/); await no({ state: 'ok', ops: [edit1, { op: 'flag', id: 'nope', flag: 'edited' }] }, /no task nope/)
  await no({ state: 'ok', ops: [edit1], who: 'me' }, /unknown key/); await no({ state: 'ok', ops: [edit1], actor: 'cadre/evil+sync' }, /unknown key/)   // the actor is core's: a result cannot name one
  assert.deepEqual(Object.keys(ROUTES).filter(k => k.startsWith('sync.')), [], 'no sync.* command'); assert.ok(isHuman({ kind: 'adapter', name: 'sync' }), 'origin adapter:sync stays refused')
  assert.equal((await S.applySync(h, u(), { state: 'ok', ops: [edit1] })).stale, 0); assert.equal((await store.get(ids[0])).title, 'new')
  assert.ok((await store.events(undefined, 100)).events.some(e => e.id === ids[0] && e.actor === 'cadre/fake+sync'), 'stamped by core')
})

test('(8) events: an events adapter gets the snapshot and the events; reset:true after the blob delete; returned commands are refused with the old line', async () => {
  const { h, file, advance } = await world({ adapters: { ui: adapter(['events']) }, sync: {} })
  await emit(h, 'drive.status', { state: 'on' }); await S.syncTick(h)
  const d = () => remote(file).delivered; assert.equal(d().length, 1); assert.equal(d()[0].reset, true); assert.ok(d()[0].events.length >= 1 && d()[0].snapshot.tasks)
  advance(40_000); await S.syncTick(h); assert.equal(d().length, 1, 'unchanged state sends nothing')
  await h.store.del('mod:sync:events:ui'); advance(40_000); await S.syncTick(h); assert.equal(d().length, 2); assert.equal(d()[1].reset, true, 'reset after the blob delete')
  edit(file, s => { s.commands.push({ cmd: 'approve', args: ['p1'] }) }); await emit(h, 'drive.status', { state: 'off' }); advance(40_000); await S.syncTick(h)
  assert.ok(h.logs.some(l => l.includes('refused: adapter ui cannot send commands; decisions are buttons in the pane'))); assert.equal(d()[2].reset, false)
})

test('(9) wizard: a proposal, nothing written before the confirm, a wrong code is a no-op, the confirm writes only the closed sync keys', async () => {
  const { h, file, store } = await world({ sync: {} }), A = (...a) => S.syncAdd(h, 'fake', a), cfgPath = join(await h.cwd(), '.cadre/config.json'), cfg = () => JSON.parse(readFileSync(cfgPath, 'utf8')).sync.fake
  assert.match(await A(), /1\/5 connection/)
  assert.match(await A('url=http://trk'), /step 1\/5: proposed changes[^]*sync\.fake[^]*url/); assert.equal(existsSync(cfgPath), false, 'nothing written before the confirm')
  assert.match(await A('confirm'), /step 1\/5 done/); assert.deepEqual(cfg(), { adapter: 'fake', url: 'http://trk' }); assert.match(await A('confirm'), /nothing pending/)
  assert.match(await A(), /2\/5 project[^]*never creates[^]*p1 \(Demo\)/); assert.match(await A('project=nope'), /2\/5 project/); assert.equal(remote(file).projects?.length ?? 1, 1)
  await A('project=p1'); await A('confirm'); const m3 = await A(); assert.match(m3, /"active":"In Progress"/); await A('confirm')
  const m5 = await A(); assert.match(m5, /5\/5 initial direction/); assert.equal(remote(file).writes ?? 0, 0, 'steps 1-4 never write remotely')
  assert.match(await A('direction=push'), /sync cursor init \(push\)/); assert.deepEqual(Object.keys(cfg()).sort(), ['adapter', 'mapping', 'project', 'url'])
  assert.match(await A('confirm'), /done/); const c = cfg()
  assert.deepEqual(Object.keys(c).sort(), ['adapter', 'direction', 'mapping', 'project', 'url']); assert.equal(c.direction, 'both'); assert.equal(c.mapping.status.done, 'Closed')
  assert.equal((await store.control()).doc['sync.fake'].lastHeal, 0)
  // an import proposes drafts, a held proposal naming a key outside the target writes nothing
  const w = await world({ sync: {} }); await w.h.store.set('sync.add:fake', { n: 1, d: {}, pending: { n: 1, args: [], text: 't', proposal: { lines: ['x'], set: { credentialEnv: 'X' } } } })
  await initPropose(w.h, 9, 'd', { title: 't', lines: [], sub: 'sync add fake' }); assert.match(await S.syncAdd(w.h, 'fake', ['confirm']), /outside the sync target/); assert.equal(existsSync(join(await w.h.cwd(), '.cadre/config.json')), false)
})

test('(9) wizard blocks: no permission, a required custom field without a default, an unknown adapter, a pinned URL', async () => {
  const w = await world({ sync: {}, adapters: { fake: adapter(['sync', 'events'], { url: 'http://pinned' }) } }), A = (...a) => S.syncAdd(w.h, 'fake', a)
  assert.match(await S.syncAdd(w.h, 'zzz'), /no adapters\.zzz/); assert.match(await A('url=http://other'), /pins the tracker URL to http:\/\/pinned/)
  await A(); await A('confirm'); await A('project=p1'); await A('confirm'); edit(w.file, s => { s.customFields = [{ name: 'Severity', required: true }] })
  assert.match(await A(), /blocked[^]*Severity/); edit(w.file, s => { s.customFields = []; s.perms = { view: true, add: false, edit: true } }); await A(); await A('confirm')
  assert.match(await A(), /4\/5 validate: blocked: no add permission/)
})

test('(10) a repo-shipped adapter runs only when the user bound it by name and file; an unbound one, or a bad file, does not; a pinned URL refuses a differing repo url', async () => {
  const w = await world({ adapters: { fake: { repo: { module: 'tracker.mjs' }, envPass: ['FAKE_ADAPTER_STATE'], grants: ['sync'] } } }); mkdirSync(join(w.repo, '.cadre/modules'), { recursive: true })
  await S.syncTick(w.h); assert.match((await rt(w.h)).message, /not a module of this repository/); assert.equal(Object.keys(remote(w.file).tasks ?? {}).length, 0)
  writeFileSync(join(w.repo, '.cadre/modules/tracker.mjs'), readFileSync(FAKE, 'utf8')); w.advance(400_000); await S.syncTick(w.h); assert.equal(Object.keys(remote(w.file).tasks).length, 2, 'bound by name and file: it runs')
  const free = await world({ adapters: { fake: adapter() }, sync: { trk: { adapter: 'unbound', project: 'p1' } } }); await S.syncTick(free.h); assert.equal(await rt(free.h), undefined, 'a target naming no user adapter starts nothing')
  const user = { name: 'u', trust: 'user', value: { adapters: { fake: { command: ['x'], url: 'http://pinned', grants: ['sync'] } } } }, repo = url => resolve([user, { name: '.cadre/config.json', trust: 'repo', value: { sync: { t: { adapter: 'fake', ...(url ? { url } : {}) } } } }])
  assert.equal(repo('http://evil').config.sync.t, undefined); assert.match(repo('http://evil').diagnostics.join(), /url differs from the user's adapters\.fake\.url/)
  assert.ok(repo('http://pinned').config.sync.t); assert.ok(repo().config.sync.t); assert.ok(resolve([{ name: 'u', trust: 'user', value: { adapters: { fake: { command: ['x'], grants: ['sync'] } } } }, { name: 'r', trust: 'repo', value: { sync: { t: { adapter: 'fake', url: 'http://any' } } } }]).config.sync.t)
})

test('backoff 30 s -> 5 min, sync.state_changed, recovery heals; an auth failure waits the longest', async () => {
  const { h, file, advance } = await world()
  await S.syncTick(h); edit(file, s => { s.mode = 'offline' })
  advance(40_000); await S.syncTick(h); assert.equal(await state(h), 'offline'); assert.equal((await rt(h)).backoff, 30_000)
  advance(31_000); await S.syncTick(h); assert.equal((await rt(h)).backoff, 60_000)
  for (let i = 0; i < 6; i++) { advance(310_000); await S.syncTick(h) } assert.equal((await rt(h)).backoff, 300_000)
  edit(file, s => { delete s.mode }); advance(310_000); await S.syncTick(h); assert.equal(await state(h), 'ok')
  const evs = Object.values((await h.events.read()).epics).flat().filter(e => e.type === 'sync.state_changed').map(e => e.data.state); assert.deepEqual(evs.slice(0, 2), ['offline', 'ok'])
  edit(file, s => { s.mode = 'auth' }); advance(400_000); await S.syncTick(h); assert.equal((await rt(h)).state, 'auth'); assert.equal((await rt(h)).backoff, 300_000)
  edit(file, s => { s.mode = 'ratelimited' }); advance(400_000); await S.syncTick(h); assert.equal((await rt(h)).next, (await h.now()) + 45_000, 'a rate limit says how long')
})

test('the cursor survives compaction; without a journal every cycle scans (heal), still level-triggered', async () => {
  const { h, store, file, ids, advance } = await world()
  await S.syncTick(h); const c0 = (await store.control()).doc['sync.trk'].cursor
  for (const x of ['a', 'b', 'c']) await store.update(ids[0], { title: x }, 'cadre/x')
  await store.compact(0); advance(40_000); await S.syncTick(h)
  assert.equal(Object.values(remote(file).tasks)[0].fields.title, 'c'); assert.equal(await state(h), 'ok'); assert.ok(Number((await store.control()).doc['sync.trk'].cursor) > Number(c0))
  const nj = await world({ journal: false }); await S.syncTick(nj.h); await nj.store.update(nj.ids[1], { title: 'two!' }, 'cadre/x'); nj.advance(40_000); await S.syncTick(nj.h)
  assert.equal(Object.values(remote(nj.file).tasks)[1].fields.title, 'two!')
})

test('external = a status or assignee change by a foreign actor only; mission -> version and decision -> comment are push-only records', async () => {
  const { h, store, file, ids, advance } = await world()
  await S.syncTick(h); advance(40_000); await S.syncTick(h)
  await store.update(ids[0], { title: 'foreign title' }, 'jira'); advance(40_000); await S.syncTick(h); assert.ok(!(await h.board.read()).tasks[0].flags.includes('external'), 'a title edit is not external')
  await store.claim(ids[1], 'jira'); advance(40_000); await S.syncTick(h); assert.ok((await h.board.read()).tasks[1].flags.includes('external'))
  await store.record('mission', 'Ship v1', 'mission body'); await store.record('decision', 'Chose X', 'because', ids[0]); advance(40_000); await S.syncTick(h); advance(40_000); await S.syncTick(h)
  const sent = Object.values(remote(file).tasks), ver = sent.find(t => t.fields.title === 'Ship v1'), dec = sent.find(t => t.fields.title === 'Chose X')
  assert.ok(ver && dec); assert.deepEqual(Object.keys(ver.fields), ['title', 'description']); assert.equal(ver.kind, 'version'); assert.equal(dec.kind, 'comment'); assert.equal(dec.on, Object.keys(remote(file).tasks).find(r => remote(file).tasks[r].localId === ids[0]))
})

test('the module needs no cadre code: it runs from a bare folder with only the input file', () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-bare-')); chmodSync(d, 0o700)
  writeFileSync(join(d, 'in.json'), JSON.stringify({ unit: 'u', kind: 'events', adapter: { name: 'x', argv: ['node', FAKE], grants: ['events'] }, events: { epic: '', seq: 0, events: [], snapshot: {}, hash: 'h' }, force: false }))
  return new Promise((res, rej) => execFile('node', [`${PLUGIN}/modules/sync.mjs`], { cwd: d, env: { CADRE_INPUT: join(d, 'in.json'), CADRE_RESULT: join(d, 'out.json'), PATH: process.env.PATH, TMPDIR: d, FAKE_ADAPTER_STATE: join(d, 'r.json') } }, e => e ? rej(e) : res()))
    .then(() => assert.equal(JSON.parse(readFileSync(join(d, 'out.json'), 'utf8')).state, 'ok'))
})

test('the adapter protocol as the module speaks it: a wrong version, a non-JSON reply, a non-zero exit, an unset credential, an unknown error code and a rate limit each end the run offline with a reason', async () => {
  const say = js => ({ command: ['node', '-e', js], grants: ['sync'] }), cases = [
    [say(`process.stdout.write('{"v":2,"ok":true,"result":1}')`), 'offline', /protocol version 2/], [say(`process.stdout.write('not json')`), 'offline', /not JSON/],
    [say('process.exit(3)'), 'offline', /exit 3/], [say(`process.stdout.write('{"v":1,"ok":false,"error":{"code":"Weird","message":"m"}}')`), 'offline', /^m$/],
    [{ ...say('0'), credentialEnv: 'CREDENTIAL_NOBODY_SET' }, 'auth', /CREDENTIAL_NOBODY_SET is not set/], [say(`process.stdout.write('{"v":1,"ok":false,"error":{"code":"Auth","message":"nope"}}')`), 'auth', /nope/]]
  for (const [a, st, why] of cases) { const w = await world({ adapters: { fake: a } }); await S.syncTick(w.h); const r = await rt(w.h); assert.equal(r.state, st, why); assert.match(r.message, why); assert.equal(Object.keys(remote(w.file).tasks ?? {}).length, 0) }
  const w = await world({ adapters: { fake: say(`process.stdout.write('{"v":1,"ok":false,"error":{"code":"RateLimited","message":"slow","retryAfterMs":7000}}')`) } }); await S.syncTick(w.h); assert.equal((await rt(w.h)).next, w.now() + 7000)
  const g = await world({ adapters: { fake: adapter(['events']) } }); await S.syncTick(g.h); assert.equal(await rt(g.h), undefined, 'a target whose adapter lacks the sync grant starts nothing')
})
