// The file store against real sh/ln/mv/sync: the TaskStore contract, two stores (= two sessions) racing on one directory, a writer killed mid-op,
// a late `ln` after a timeout, and a writer suspended across a compaction. The kit twin (tests/store-crash.test.ts) enumerates Host-call interleavings.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const { FileStore, SCRIPTS } = await import('../../task-management/adapters/file/store.ts')
const { contract } = await import('../store-contract.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { timeout: o.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const host = (o = {}) => ({ run, now: async () => Date.now(), rand: (n = 16) => randomBytes(n).toString('hex'), write: async (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t) }, ...o })
const fresh = () => join(mkdtempSync(join(tmpdir(), 'cadre-store-')), 'state')
const reg = {}

contract('file (real sh)', () => new FileStore(host(), fresh(), 's1'))

test('two sessions race 20 writes each on one task: every write lands once, revisions never fork', async () => {
  const dir = fresh(), a = new FileStore(host(), dir, 'A'), b = new FileStore(host(), dir, 'B')
  await a.init({ types: reg, journal: true }); const e = await a.createEpic('E', 'g')
  const go = (s, who) => Promise.all(Array.from({ length: 20 }, async (_, i) => { for (;;) { try { return await s.setMeta(e, { [`${who}${i}`]: '1' }, who) } catch (x) { if (x.code !== 'Busy') throw x } } }))
  await Promise.all([go(a, 'a'), go(b, 'b')])
  const t = await new FileStore(host(), dir, 'C').get(e)
  assert.equal(Object.keys(t.meta).length, 40); assert.equal(t.revision, String(1 + 40))
  const seqs = readdirSync(join(dir, 'j')).filter(n => /^\d+$/.test(n)).map(Number).sort((x, y) => x - y)
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1))   // one entry per seq, no gap
})

test('a writer killed mid-commit (SIGKILL in the commit sh) leaves the store at its last committed revision; the next session writes on', async () => {
  const dir = fresh(), a = new FileStore(host(), dir, 'A'); await a.init({ types: reg, journal: true }); const e = await a.createEpic('E', 'g')
  const killer = host({ run: (argv, o) => argv[2]?.includes('ln "$1"') ? new Promise(res => { const c = execFile(argv[0], argv.slice(1), () => res({ exitCode: 137, stdout: '', stderr: 'killed' })); c.kill('SIGKILL') }) : run(argv, o) })
  const k = new FileStore(killer, dir, 'K')
  await assert.rejects(k.setMeta(e, { x: '1' }, 'k'), x => x.code === 'Timeout')
  const b = new FileStore(host(), dir, 'B'); assert.equal((await b.get(e)).revision, '1')
  assert.equal((await b.setMeta(e, { y: '1' }, 'b')).revision, '2')
})

test('a late ln after a timeout: the same call returns the committed result, no second entry', async () => {
  const dir = fresh(), a = new FileStore(host(), dir, 'A'); await a.init({ types: reg, journal: true }); const e = await a.createEpic('E', 'g')
  let late   // the first commit run reports a timeout at once while its sh still runs and links 50 ms later
  const slow = host({ run: async (argv, o) => argv[2]?.includes('ln "$1"') && !late ? (late = new Promise(r => setTimeout(r, 50)).then(() => run(argv, o)), { exitCode: 1, stdout: '', stderr: 'aborted: still running after 120000ms' }) : run(argv, o) })
  const s = new FileStore(slow, dir, 'S')
  await assert.rejects(s.setMeta(e, { x: '1' }, 's'), x => x.code === 'Timeout'); await late
  const t = await s.setMeta(e, { x: '1' }, 's'); assert.equal(t.revision, '2')
  assert.equal((await a.get(e)).revision, '2'); assert.equal((await a.events()).events.filter(v => v.op === 'meta').length, 1)
})

test('a writer suspended across a compaction: its ln lands in a folded slot, is removed, and the op redoes on the head', async () => {
  const dir = fresh(), a = new FileStore(host(), dir, 'A'); await a.init({ types: reg, journal: true }); const e = await a.createEpic('E', 'g')
  let gate, release = new Promise(r => (gate = r))
  const sus = host({ run: async (argv, o) => { if (argv[2]?.includes('ln "$1"') && gate) { const g = gate; gate = null; g(); await release } return run(argv, o) } })
  const s = new FileStore(sus, dir, 'S'); await s.get(e)
  let resume; const parked = new Promise(r => (resume = r)); release = parked
  const p = s.setMeta(e, { s: '1' }, 's')
  await new Promise(r => setTimeout(r, 30))
  for (let i = 0; i < 5; i++) await a.setMeta(e, { [`a${i}`]: '1' }, 'a')
  assert.equal(await a.compact(0), 7); resume()
  const t = await p; assert.equal(t.revision, '7'); assert.equal(t.meta.s, '1'); assert.equal(t.meta.a4, '1')
  const c = new FileStore(host(), dir, 'C'); assert.deepEqual(await c.get(e), t)
  assert.deepEqual((await c.events('6')).events.map(v => v.op), ['meta']); await assert.rejects(c.events('5'), x => x.code === 'TooOld')   // events 1..6 were folded
})

test('probe: ln + sync work here; a directory where they fail is not ok', async () => {
  assert.equal((await new FileStore(host(), fresh(), 'P').probe()).ok, true)
  const ro = host({ run: (argv, o) => run(argv[2]?.includes('probe.') ? ['sh', '-c', 'exit 1'] : argv, o) })
  const p = await new FileStore(ro, fresh(), 'P').probe(); assert.equal(p.ok, false); assert.match(p.detail, /hard links/)
})

test('a full scan paused between its doc and journal passes while another session folds: the scan rescans, the folded writes survive', async () => {
  const dir = fresh(), b = new FileStore(host(), dir, 'B'); await b.init({ types: reg, journal: true }); const e = await b.createEpic('E', 'g')
  for (let i = 1; i <= 5; i++) await b.setMeta(e, { c: String(i) }, 'b')
  await b.compact(0); for (let i = 6; i <= 25; i++) await b.setMeta(e, { c: String(i) }, 'b')   // docs hold c=5, entries c=6..25
  const at = join(dir, '..', 'at'), go = join(dir, '..', 'go')   // the first full scan touches `at` after its doc pass and waits for `go`
  let once = false
  const paused = host({ run: (argv, o) => { if (!once && argv[2]?.includes("printf 'D %s") && argv[6] === '1') { once = true; argv = [...argv]; argv[2] = argv[2].replace('done; fi\n', `done; fi\n: > "${at}"; while [ ! -e "${go}" ]; do sleep 0.01; done\n`) } return run(argv, o) } })
  const p = new FileStore(paused, dir, 'A').setMeta(e, { r: 'a' }, 'a')
  while (!readdirSync(join(dir, '..')).includes('at')) await new Promise(r => setTimeout(r, 10))
  await b.compact(0); writeFileSync(go, ''); await p
  assert.deepEqual((await new FileStore(host(), dir, 'C').get(e)).meta, { c: '25', r: 'a' })
})

test('a warm store whose dir is removed (git clean -xdf) and regrown by another session: no write onto the stale cache, nothing resurrected', async () => {
  for (const regrow of [false, true]) {
    const dir = fresh(), a = FileStore.of(host(), dir, 'A'); await a.init({ types: reg, journal: true })
    const e = (await a.createDraft({ title: 't', description: '', type: 'feature', parent: await a.createEpic('E', 'g') })).id   // c-3-1: not an id the regrown store mints
    for (let i = 1; i <= 5; i++) await a.setMeta(e, { c: String(i) }, 'a')
    rmSync(dir, { recursive: true, force: true })
    if (regrow) { const b = new FileStore(host(), dir, 'B'); await b.init({ types: reg, journal: true }); const o = await b.createEpic('other', 'g'); for (let i = 0; i < 10; i++) await b.setMeta(o, { k: String(i) }, 'b') }
    await assert.rejects(a.setMeta(e, { after: 'wipe' }, 'a'), x => x.code === (regrow ? 'NotFound' : 'NotInitialized'))
    if (regrow) assert.deepEqual((await new FileStore(host(), dir, 'C').list({})).map(t => t.title), ['other'])
    else assert.throws(() => readdirSync(join(dir, 'j')))
  }
})

// review r3 N16: a warm store reads only the journal tail on every op; the scan prints the entry it has seen (-ge), else each op pays a second, full scan
test('a warm store scans incrementally on every write: no full scan after the first', async () => {
  const dir = fresh(), full = []; await new FileStore(host(), dir, 'I').init({ types: reg, journal: true })
  const s = new FileStore(host({ run: (argv, o) => { if (argv[2]?.endsWith(SCRIPTS.scan)) full.push(argv[6]); return run(argv, o) } }), dir, 'S'), e = await s.createEpic('E', 'g')
  for (let i = 0; i < 10; i++) await s.setMeta(e, { [`k${i}`]: '1' }, 's')
  assert.equal(full.filter(f => f === '1').length, 1, `scans (1 = full): ${full.join(' ')}`)
})

// live 2.0.0 (CC 2.1.310): a 20 KB control doc per entry; the host cuts stdout at 4 MiB, so a 256-entry tail (~10 MB) lost its scan end marker, every cold scan failed, and each fold's scan failed with it.
test('big docs: the journal stays under the host stdout cap, compaction keeps succeeding, a cold session reads on; a failed fold leaves a log line', async () => {
  const dir = fresh(), logs = [], cap = 4193619
  const capped = host({ log: t => logs.push(t), run: (argv, o) => new Promise(res => execFile(argv[0], argv.slice(1), { timeout: o.timeoutMs, maxBuffer: 1 << 28 }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout.slice(0, cap), stderr }))) })
  const a = new FileStore(capped, dir, 'A'); await a.init({ types: reg, journal: true })
  const big = 'x'.repeat(20_000), live = () => readdirSync(join(dir, 'j')).filter(n => /^\d+$/.test(n)).length
  for (let i = 0; i < 200; i++) { await a.setControl({ [`k${i % 5}`]: big + i }); assert.ok(live() < 120, `journal ${live()} entries at write ${i}`) }
  assert.deepEqual(logs, [])
  assert.equal((await new FileStore(capped, dir, 'B').control()).doc.k4.slice(-3), "199")
  const bad = host({ log: t => logs.push(t), run: (argv, o) => run(argv[2]?.includes('shift 3') ? ['sh', '-c', 'echo boom >&2; exit 1'] : argv, o) })
  const c = new FileStore(bad, fresh(), 'C'); await c.init({ types: reg, journal: true }); for (let i = 0; i < 300; i++) await c.setControl({ k: String(i) })
  assert.match(logs[0], /store compaction failed.*boom/)
})
