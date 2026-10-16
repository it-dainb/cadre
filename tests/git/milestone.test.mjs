// Dev-only: the milestone lane against real git (ADR 0015): epics land on the milestone branch (checks on the merged result, --no-ff, footer), the milestone
// takes dev's news after each landing, the last landing lands the milestone on dev, the release names it. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { integrateEpic, releaseDev } = await import('../../core/integrate.ts')
const { mirror } = await import('../../core/dispatch.ts')
const { skeleton } = await import('../../core/changelog.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { defaults: types } = await import('../../task-management/registry.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

// dev + milestone/<m>-accounts + two epic branches (a.txt, b.txt), each epic with one done task; the board holds the approved milestone
async function world(check = ['true'], drive = false) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-ms-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const store = new MemoryStore(() => 1000); await store.init({ types: types(), journal: false })
  const m = await store.createEpic('accounts', 'g'), ms = `milestone/${m}-accounts`; sh(d, 'branch', ms, 'dev')
  const ep = []
  for (const [name, f] of [['signup', 'a.txt'], ['login', 'b.txt']]) {
    const e = (await store.createDraft({ title: name, description: name, type: 'epic', parent: m, meta: { 'cadre.size': '1', 'cadre.branch': `epic/${name}` } })).id
    await store.approve([e]); sh(d, 'branch', `epic/${name}`, ms); sh(d, 'checkout', '-q', `epic/${name}`); commit(d, f, `${name}\n`, `feat: ${name}`); sh(d, 'checkout', '-q', 'main')
    const t = (await store.createDraft({ title: `do ${name}`, description: 'x', type: 'feature', parent: e, meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: name }) } })).id
    await store.approve([t]); await store.claim(t, 'a'); await store.close(t, { outcome: 'done' }); ep.push(e)
  }
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.packages = [{ root: '.', setup: ['true'], checks: { test: check } }]; cfg.jail = 'off'
  const h = fakeHost()
  Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, taskStore: async () => store, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  await h.board.update(b => ({ ...b, epic: m, plan: { id: m, slug: 'accounts', state: 'approved', epicBranch: ms, lane: 'milestone', mode: 'auto' }, ...(drive ? { drive: { ...b.drive, on: true, mode: 'auto', epicId: m } } : {}) }))
  await mirror(h, store, types())
  return { d, h, store, m, ms, ep }
}
const states = async h => (await h.board.read()).plan.epics.map(e => e.state)

test('an epic lands on the milestone branch: merged result checked, --no-ff with the milestone footer, epic branch gone, dev untouched', async () => {
  const { d, h, store, m, ms, ep } = await world(), dev = sh(d, 'rev-parse', 'dev')
  assert.deepEqual(await states(h), ['running', 'running'])
  assert.equal(await integrateEpic(h, ep[0]), null)
  const tipMs = sh(d, 'rev-parse', ms); assert.equal(sh(d, 'rev-list', '--parents', '-n1', tipMs).split(' ').length, 3)
  assert.match(sh(d, 'log', '-1', '--format=%B', ms), new RegExp(`merge epic/signup \\(${ep[0]}\\)\\n\\nMilestone: ${m} accounts`))
  assert.match(sh(d, 'show', `${ms}:CHANGELOG.md`), /- signup \(m-\d+\)/)
  assert.equal(sh(d, 'branch', '--list', 'epic/signup'), ''); assert.equal(sh(d, 'rev-parse', 'dev'), dev)
  assert.equal((await store.get(ep[0])).category, 'done'); assert.deepEqual(await states(h), ['landed', 'running'])
  const b = await h.board.read(); assert.equal(b.plan.state, 'approved'); assert.equal(b.plan.landed, undefined)
  assert.ok(Object.values((await h.events.read()).epics).flat().some(e => e.type === 'plan.landed' && e.data.planId === ep[0] && e.data.on === ms))
})
test('the milestone takes dev\'s news after a landing; the last epic lands the milestone on dev; the release is proposed once and names the milestone', async () => {
  const { d, h, m, ms, ep } = await world()
  assert.equal(await integrateEpic(h, ep[0]), null)
  sh(d, 'checkout', '-q', 'dev'); commit(d, 'd.txt', 'hotfix\n', 'fix: hotfix on dev'); sh(d, 'checkout', '-q', 'main')
  assert.equal(await integrateEpic(h, ep[1]), null)
  const b = await h.board.read(); assert.equal(b.plan.state, 'done-on-dev'); assert.deepEqual(await states(h), ['landed', 'landed'])
  assert.ok(sh(d, 'log', '--format=%s', 'dev').split('\n').includes(`merge dev into ${ms}`))   // freshened after the landing, before the milestone merged into dev
  for (const f of ['a.txt', 'b.txt', 'd.txt']) assert.ok(sh(d, 'ls-tree', '--name-only', 'dev').split('\n').includes(f))
  assert.match(sh(d, 'log', '-1', '--format=%s', 'dev'), new RegExp(`merge ${ms.replace('/', '\\/')} \\(${m}\\)`))
  assert.equal(sh(d, 'rev-list', '--parents', '-n1', 'dev').split(' ').length, 3); assert.equal(sh(d, 'branch', '--list', ms), '')
  assert.deepEqual((b.decisions ?? []).map(x => x.kind), ['release'])
  assert.match(await releaseDev(h), /Released v0\.1\.0/); assert.equal(sh(d, 'log', '-1', '--format=%s', 'dev'), `chore(release): v0.1.0 — milestone ${m} accounts`)
})
test('one landing at a time: a second epic waits while one integrates', async () => {
  const { h, ep } = await world()
  await h.board.update(b => ({ ...b, plan: { ...b.plan, state: 'integrating' } }))
  assert.match(await integrateEpic(h, ep[1]), /already running; set it completed again \(status\) after it/)
})
test('red on the merged result while driving: one fix task in that epic; the 2nd red stops that epic only, the other still lands', async () => {
  const { d, h, store, ms, ep } = await world(['sh', '-c', '! test -f a.txt'], true), before = sh(d, 'rev-parse', ms)
  assert.match(await integrateEpic(h, ep[0]), /failed/); assert.equal(sh(d, 'rev-parse', ms), before)
  const fix = (await store.list({ parent: ep[0] })).find(t => t.type === 'bug'); assert.ok(fix); assert.equal((await h.board.read()).tasks.find(t => t.id === fix.id).epic, ep[0])
  await store.claim(fix.id, 'a'); await store.close(fix.id, { outcome: 'done' }); await h.board.update(b => ({ ...b, tasks: b.tasks.map(t => ({ ...t, state: 'done' })) }))
  assert.match(await integrateEpic(h, ep[0]), /failed/)
  assert.deepEqual(await states(h), ['stopped', 'running']); assert.ok((await h.board.read()).decisions.some(x => x.id === `flag:${ep[0]}:stopped`))
  assert.equal(await integrateEpic(h, ep[1]), null); assert.deepEqual(await states(h), ['stopped', 'landed']); assert.equal((await h.board.read()).plan.state, 'approved')
})
test('a merge conflict with the milestone: a resolve task in that epic holds the merge (markers), recorded; once resolved the epic lands; past 2 attempts the epic stops', async () => {
  const { d, h, store, ms, ep } = await world(['true'], true)
  sh(d, 'checkout', '-q', ms); commit(d, 'a.txt', 'other\n', 'feat: other'); sh(d, 'checkout', '-q', 'main')
  assert.match(await integrateEpic(h, ep[0]), /does not merge into milestone\/.* \(conflicts in a\.txt\)\. Resolve task (\S+) was added to .* \(attempt 1\/2\)/)
  const t = (await store.list({ parent: ep[0] })).find(x => x.meta['cadre.resolve']); assert.equal(t.type, 'refactor'); assert.equal(t.meta['cadre.lane'], 'lite'); assert.equal(t.category, 'todo')
  const wt = t.meta['cadre.worktree']; assert.match(readFileSync(join(wt, 'a.txt'), 'utf8'), /<<<<<<<[\s\S]*signup[\s\S]*other|<<<<<<<[\s\S]*other[\s\S]*signup/); assert.match(t.description, /This side: signup/)
  assert.deepEqual(await states(h), ['running', 'running']); assert.equal((await store.get(ep[0])).meta['cadre.resolves'], '1'); assert.ok((await store.list({})).some(x => x.type === 'decision' && /resolve task/.test(x.title + x.description)))
  writeFileSync(join(wt, 'a.txt'), 'signup\nother\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'merge resolved'); sh(d, 'update-ref', 'refs/heads/epic/signup', sh(wt, 'rev-parse', 'HEAD'))   // what the task's gates and squash do
  await store.claim(t.id, 'a'); await store.close(t.id, { outcome: 'done' }); await h.board.update(b => ({ ...b, tasks: b.tasks.map(x => (x.id === t.id ? { ...x, state: 'done' } : x)) }))
  assert.equal(await integrateEpic(h, ep[0]), null); assert.equal(sh(d, 'show', `${ms}:a.txt`), 'signup\nother')
  const w2 = await world(['true'], true); sh(w2.d, 'checkout', '-q', w2.ms); commit(w2.d, 'a.txt', 'other\n', 'feat: other'); sh(w2.d, 'checkout', '-q', 'main'); await w2.store.setMeta(w2.ep[0], { 'cadre.resolves': '2' }, 'x')
  assert.match(await integrateEpic(w2.h, w2.ep[0]), /merge of epic\/signup into milestone\/.* failed: conflicts in a\.txt/); assert.deepEqual(await states(w2.h), ['stopped', 'running'])
})
test('after an epic lands, the other running epic takes the new milestone tip', async () => {
  const { d, h, ms, ep } = await world()
  assert.equal(await integrateEpic(h, ep[1]), null)
  assert.equal(sh(d, 'merge-base', '--is-ancestor', ms, 'epic/signup'), ''); assert.equal(sh(d, 'show', 'epic/signup:b.txt'), 'login')
  const b = await h.board.read(); assert.equal(b.plan.landed, undefined); assert.equal(b.plan.state, 'approved'); assert.notEqual(sh(d, 'rev-parse', 'dev'), sh(d, 'rev-parse', ms))   // one epic of two: the milestone is NOT landed (no early "landed on dev")
  const ev = Object.values((await h.events.read()).epics).flat().filter(e => e.type === 'plan.landed'); assert.deepEqual(ev.map(e => [e.data.planId, e.data.on]), [[ep[1], ms]])
})
