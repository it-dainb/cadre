// Dev-only: epic integration + release against real git. node --experimental-transform-types --test tests/git/*.test.mjs
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
const { insert, skeleton } = await import('../../modules/changelog.mjs')
const PL = await import('../../core/pipeline.ts'), { sessionProfile } = await import('../dev/register.mjs')
const landing = x => PL.setProfile({ ...sessionProfile, landing: { ...sessionProfile.landing, ...x } })   // a case's landing section; world() resets it
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

function world(check = ['test', '-f', 'c.txt'], jail = 'off', units) {
  PL.setProfile(sessionProfile)   // every case starts on the default profile
  const d = mkdtempSync(join(tmpdir(), 'cadre-int-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p3-auth', 'dev')
  sh(d, 'checkout', '-q', 'epic/p3-auth'); commit(d, 'c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.units = units ?? [{ root: '.', checks: { setup: ['true'], test: check } }]; cfg.jail = jail
  const h = fakeHost()
  Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t),
    taskStore: async () => ({ list: async () => [{ id: 'm-2', category: 'done', meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'Login' }) } }] }) })
  const task = (id, state = 'done') => ({ id, title: id, type: 'feature', kind: 'code', merges: true, state, step: '', phaseSince: 0, deps: [], flags: [] })
  return h.board.update(b => ({ ...b, epic: 'p3', plan: { id: 'p3', slug: 'auth', state: 'approved', epicBranch: 'epic/p3-auth' }, tasks: [task('m-2')] })).then(() => ({ d, h, task }))
}

test('integration: --no-ff merge, suites green -> dev moves, landed, epic branch gone, release proposed; the changelog is no part of it (B6)', async () => {
  const { d, h } = await world(), old = sh(d, 'rev-parse', 'dev')
  assert.equal(await integrateEpic(h, 'p3'), null)
  const dev = sh(d, 'rev-parse', 'dev'); assert.notEqual(dev, old)
  assert.equal(sh(d, 'rev-list', '--parents', '-n1', dev).split(' ').length, 3)
  assert.equal(sh(d, 'show', 'dev:CHANGELOG.md'), skeleton().trim())   // the entry is the task.closed hook's commit on the epic branch, not an amend of the merge
  assert.equal(sh(d, 'rev-list', '--count', `${old}..${dev}`), '2', 'the merge and the one epic commit: nothing is added at landing')
  const b = await h.board.read(); assert.equal(b.plan.state, 'done-on-dev'); assert.equal(b.plan.landed.sha, dev)
  assert.equal(sh(d, 'branch', '--list', 'epic/p3-auth'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1)
  assert.equal((await h.ui.read()).rel, '0.1.0')
  assert.deepEqual(Object.values((await h.events.read()).epics).flat().map(e => e.type).filter(t => t.startsWith('plan') || t.startsWith('release')), ['plan.landed', 'release.proposed'])
})
const hook = (code, commit) => ({ run: ['node', '-e', code], commit })
test('epic.landed: the hook commit lands on dev by CAS after the merge; one that loses the CAS is not landed, dev stays as the other side left it, hook-failed', async () => {
  const w = await world(); PL.setProfile({ ...sessionProfile, hooks: { 'epic.landed': [hook("require('fs').writeFileSync('landed.txt', 'x')", 'docs: landed ${id}')] } })
  assert.equal(await integrateEpic(w.h, 'p3'), null); const p = await w.h.board.read()
  assert.equal(sh(w.d, 'log', '-1', '--format=%s', 'dev'), 'docs: landed p3'); assert.equal(sh(w.d, 'show', 'dev:landed.txt'), 'x'); assert.equal(sh(w.d, 'rev-parse', 'dev^'), p.plan.landed.sha)
  assert.deepEqual(p.plan.flags ?? [], []); assert.equal(sh(w.d, 'worktree', 'list').split('\n').length, 1)
  const l = await world(), D = JSON.stringify(l.d)   // the hook's own repository work moves dev before core's CAS: a competing landing
  PL.setProfile({ ...sessionProfile, hooks: { 'epic.landed': [hook(`const x = require('child_process').execFileSync, t = x('git', ['-C', ${D}, 'commit-tree', '-p', 'dev', '-m', 'other', 'dev^{tree}'], { encoding: 'utf8' }).trim(); x('git', ['-C', ${D}, 'update-ref', 'refs/heads/dev', t]); require('fs').writeFileSync('n.txt', 'x')`, 'docs: lost')] } })
  assert.equal(await integrateEpic(l.h, 'p3'), null)   // the plan did land
  assert.equal(sh(l.d, 'log', '-1', '--format=%s', 'dev'), 'other'); assert.throws(() => sh(l.d, 'show', 'dev:n.txt')); assert.deepEqual((await l.h.board.read()).plan.flags, ['hook-failed'])
  assert.equal(sh(l.d, 'worktree', 'list').split('\n').length, 1)
})
test('integration red: dev untouched, plan back to approved, integration-failed flag, throwaway gone', async () => {
  const { d, h } = await world(['false']), old = sh(d, 'rev-parse', 'dev')
  assert.match(await integrateEpic(h, 'p3'), /root|\.:test failed/); assert.equal(sh(d, 'rev-parse', 'dev'), old)
  const b = await h.board.read(); assert.equal(b.plan.state, 'approved'); assert.deepEqual(b.plan.flags, ['integration-failed'])
  assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.equal(sh(d, 'branch', '--list', 'epic/p3-auth').trim(), 'epic/p3-auth')
})
test('integration refuses: open child, git:dev flag (human commit on dev), non-approved plan', async () => {
  const { h, task } = await world()
  await h.board.update(b => ({ ...b, tasks: [task('m-2', 'active')] })); assert.match(await integrateEpic(h, 'p3'), /children still open: m-2/)
  await h.board.update(b => ({ ...b, tasks: [task('m-2')] })); await h.git.update(g => ({ ...g, flags: { 'git:dev': {} } }))
  assert.match(await integrateEpic(h, 'p3'), /git flag git:dev/); assert.equal((await h.board.read()).plan.state, 'approved')
})
// what the task.closed hook leaves on the epic branch: the closed task's entry, one docs(changelog) commit (B6; the hook itself: tests/git/hooks.test.mjs)
const entry = d => { sh(d, 'checkout', '-q', 'epic/p3-auth'); commit(d, 'CHANGELOG.md', insert(skeleton(), 'Added', 'Login', 'm-2'), 'docs(changelog): m-2'); sh(d, 'checkout', '-q', 'main') }
test('release: version from the release hook, [Unreleased] cut in a chore(release) commit on dev, --no-ff into main, annotated tag, plan released', async () => {
  const { d, h } = await world(); entry(d); assert.equal(await integrateEpic(h, 'p3'), null)
  sh(d, 'checkout', '-q', '--detach')   // main checked out nowhere: it moves at once (a checked-out main waits: tests/git/devmoved)
  const text = await releaseDev(h); assert.match(text, /Released v0\.1\.0/); sh(d, 'checkout', '-q', 'main')
  assert.equal(sh(d, 'cat-file', '-t', 'v0.1.0'), 'tag'); assert.equal(sh(d, 'rev-parse', 'main'), sh(d, 'rev-list', '-n1', 'v0.1.0'))
  assert.equal(sh(d, 'log', '-1', '--format=%s', 'dev'), 'chore(release): v0.1.0')
  assert.match(sh(d, 'show', 'main:CHANGELOG.md'), /## \[0\.1\.0\] - \d{4}-\d\d-\d\d\n\n### Added\n\n- Login \(m-2\)/)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(readFileSync(join(d, 'CHANGELOG.md'), 'utf8').includes('## [0.1.0]'), true)
  const b = await h.board.read(); assert.equal(b.plan.state, 'released'); assert.equal(b.plan.released.version, '0.1.0'); assert.equal('rel' in (await h.ui.read()), false)
  assert.match(await releaseDev(h), /nothing to release/)   // [Unreleased] is empty now
})
test('release refuses: empty [Unreleased], bad version, open flag; dev stays put. Without a release hook a version must be named', async () => {
  const { d, h } = await world(), dev = sh(d, 'rev-parse', 'dev')
  assert.match(await releaseDev(h), /nothing to release/); assert.match(await releaseDev(h, '1.x'), /expected x\.y\.z/)
  await h.git.update(g => ({ ...g, flags: { 'git:dev': {} } })); assert.match(await releaseDev(h), /git:dev is open/)
  assert.equal(sh(d, 'rev-parse', 'dev'), dev); assert.equal(sh(d, 'tag', '--list'), '')
  await h.git.update(g => ({ ...g, flags: {} })); PL.setProfile({ ...sessionProfile, hooks: {}, landing: { ...sessionProfile.landing, suites: [] } })
  assert.match(await releaseDev(h), /no version: name one/)   // no hook to say; the person names it
  sh(d, 'tag', '-a', 'v2.0.0', '-m', 'x', 'dev'); assert.match(await releaseDev(h, '2.0.0'), /tag v2\.0\.0 already exists/)
  sh(d, 'checkout', '-q', '--detach'); assert.match(await releaseDev(h, '2.1.0'), /Released v2\.1\.0/); assert.equal(sh(d, 'rev-parse', 'dev'), dev)   // no hook: no commit on dev, the tag only
})

test('integration on bwrap < 0.11 (no --overlay-src): suites run in the copy jail, never an overlay', async () => {
  const { d, h } = await world(['test', '-f', 'c.txt'], 'auto'), seen = []
  const ok = { exitCode: 0, stdout: '', stderr: '' }
  h.run = async (argv, o = {}) => {
    if (argv[0] !== 'bwrap') return run(argv, o)
    seen.push(argv); if (argv.includes('--help')) return { ...ok, stdout: 'Usage: bwrap [OPTION...] COMMAND\n  --unshare-net\n' }
    if (argv.includes('--overlay-src')) return { exitCode: 1, stdout: '', stderr: 'bwrap: Unknown option --overlay-src' }
    const i = argv.indexOf('--'); return i < 0 ? ok : run(argv.slice(i + 1), { cwd: argv[argv.indexOf('--chdir') + 1] })
  }
  assert.equal(await integrateEpic(h, 'p3'), null); assert.ok(seen.length > 2 && !seen.some(a => a.includes('--overlay-src') && !a.includes('--help')))
  assert.equal(sh(d, 'show', 'dev:c.txt'), 'c')
})
// a dev checkout is never moved by a landing now: tests/git/devmoved.test.mjs

// ---- drive (ADR 0013): release is never automatic under yolo; integration red gets one fix task, then auto asks and yolo stops ----
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { types: dt } = await import('../../profiles/default.ts'), types = () => dt
async function driven(mode, check, extra = {}, units) {
  const w = await world(check, 'off', units), store = new MemoryStore(() => 1000); await store.init({ types: types(), journal: false })
  const epic = await store.createEpic('auth', 'g'); 
  Object.assign(w.h, { taskStore: async () => store })
  await w.h.board.update(b => ({ ...b, epic, plan: { ...b.plan, id: epic }, tasks: [], drive: { ...b.drive, on: true, mode, epicId: epic, ...extra } }))
  return { ...w, store, epic }
}
test('yolo: the plan lands on dev and no release is proposed; auto proposes it (a dialog)', async () => {
  const y = await driven('yolo'); assert.equal(await integrateEpic(y.h, y.epic), null)
  const ty = Object.values((await y.h.events.read()).epics).flat().map(e => e.type); assert.ok(ty.includes('plan.landed')); assert.ok(!ty.includes('release.proposed'))
  assert.equal(((await y.h.board.read()).decisions ?? []).length, 0)
  const a = await driven('auto'); assert.equal(await integrateEpic(a.h, a.epic), null)
  assert.deepEqual(((await a.h.board.read()).decisions ?? []).map(d => d.kind), ['release'])

  for (const extra of [{ stopped: 'stopped by you' }, { epicId: 'other' }]) {   // a stopped yolo run (the human finishes it) or another epic's mode: the release is proposed
    const x = await driven('yolo', undefined, extra); assert.equal(await integrateEpic(x.h, x.epic), null)
    assert.deepEqual(((await x.h.board.read()).decisions ?? []).map(d => d.kind), ['release'])
  }
})
test('a merge conflict with dev: a resolve task in the plan (no flag); past 2 attempts the flag asks the human', async () => {
  const w = await driven('auto'); sh(w.d, 'checkout', '-q', 'dev'); commit(w.d, 'c.txt', 'other\n', 'feat: other'); sh(w.d, 'checkout', '-q', 'main')
  assert.match(await integrateEpic(w.h, w.epic), /does not merge into dev \(conflicts in c\.txt\)\. Resolve task \S+ was added/); assert.deepEqual((await w.h.board.read()).plan.flags ?? [], [])
  assert.ok((await w.h.board.read()).tasks.some(t => t.type === 'refactor' && t.state === 'todo')); assert.equal((await w.h.board.read()).plan.state, 'approved')
  const { d, h, epic, store } = await driven('auto')
  sh(d, 'checkout', '-q', 'dev'); commit(d, 'c.txt', 'other\n', 'feat: other'); sh(d, 'checkout', '-q', 'main'); await store.setMeta(epic, { 'cadre.resolves': '2' }, 'x')
  assert.match(await integrateEpic(h, epic), /merge of epic\/p3-auth into dev failed/)
  const b = await h.board.read(); assert.deepEqual(b.plan.flags, ['integration-failed']); assert.equal(b.tasks.filter(t => t.type === 'bug').length, 0)
  assert.deepEqual((b.decisions ?? []).map(x => x.id), [`flag:${epic}:integration-failed`])
})
test('integration red while driving: ONE fix task (approved, recorded), no flag; the 2nd red stops yolo, asks in auto', async () => {
  for (const mode of ['yolo', 'auto']) {
    const { h, store, epic } = await driven(mode, ['false'])
    assert.match(await integrateEpic(h, epic), /failed/)
    let b = await h.board.read(); assert.deepEqual(b.plan.flags ?? [], []); assert.equal((b.decisions ?? []).length, 0)
    const fix = b.tasks.find(t => t.type === 'bug'); assert.equal(fix.state, 'todo'); assert.equal(fix.lane, 'lite')
    assert.ok((await store.list({})).some(t => t.title.includes('fix task')))   // the decision record
    assert.ok(Object.values((await h.events.read()).epics).flat().some(e => e.type === 'drive.decided' && e.data.kind === 'integration'))
    await h.board.update(x => ({ ...x, tasks: x.tasks.map(t => ({ ...t, state: 'done' })) }))
    assert.match(await integrateEpic(h, epic), /failed/); b = await h.board.read()
    assert.deepEqual(b.plan.flags, ['integration-failed']); assert.equal(b.tasks.filter(t => t.type === 'bug').length, 1)
    assert.equal(b.drive.stopped, mode === 'yolo' ? 'integration failed twice' : undefined)
  }
})

// the landing section of the profile (plan 2.6): onEpicDone, suites, prepare, knownRed, baseline; each changes the integration
test('landing.onEpicDone off lands without proposing a release; landing.suites runs only the named checks', async () => {
  const { h } = await world(); landing({ onEpicDone: 'off' })
  assert.equal(await integrateEpic(h, 'p3'), null); assert.ok(!Object.values((await h.events.read()).epics).flat().some(e => e.type === 'release.proposed'))
  const red = await world(['true'], 'off', [{ root: '.', checks: { setup: ['true'], test: ['true'], lint: ['false'] } }])
  assert.notEqual(await integrateEpic(red.h, 'p3'), null)   // absent suites = every check of the unit: the red lint gates
  const only = await world(['true'], 'off', [{ root: '.', checks: { setup: ['true'], test: ['true'], lint: ['false'] } }]); landing({ suites: ['test'] })
  assert.equal(await integrateEpic(only.h, 'p3'), null)
})
test('landing.prepare runs once per touched unit before the suites, in its own jail; it is no suite itself; a failing one stops the landing', async () => {
  const w = await world(['test', '-f', 'prepared.txt'], 'off', [{ root: '.', checks: { setup: ['sh', '-c', 'echo ok > prepared.txt'], test: ['test', '-f', 'prepared.txt'] } }])
  assert.equal(await integrateEpic(w.h, 'p3'), null)   // the test check passes only because setup ran first in the same folder
  const bad = await world(['true'], 'off', [{ root: '.', checks: { setup: ['false'], test: ['true'] } }]), old = sh(bad.d, 'rev-parse', 'dev')
  assert.match(await integrateEpic(bad.h, 'p3'), /^\.: setup failed/); assert.equal(sh(bad.d, 'rev-parse', 'dev'), old)
  const slot = await world(['true'], 'off', [{ root: '.', checks: { setup: ['false'], test: ['true'] } }]); landing({ prepare: undefined, suites: ['test'] })
  assert.equal(await integrateEpic(slot.h, 'p3'), null)   // with no prepare slot named, `setup` is just a check nobody asked to run
})
test('knownRed runs and never gates; baseline tolerate keeps a check that was red when the plan started out of the way, strict does not', async () => {
  const U = [{ root: '.', knownRed: ['lint'], checks: { setup: ['true'], test: ['true'], lint: ['false'] } }]
  const k = await world(['true'], 'off', U); assert.equal(await integrateEpic(k.h, 'p3'), null)
  const ran = Object.values((await k.h.events.read()).epics).flat().filter(e => e.type === 'check.ran').map(e => [e.data.name, e.data.ok]); assert.deepEqual(ran.sort(), [['.:lint', false], ['.:test', true]])
  const base = { '.:lint': { exit: 1 } }, red = [{ root: '.', checks: { setup: ['true'], test: ['true'], lint: ['false'] } }]
  for (const [baseline, want] of [['tolerate', null], ['strict', 'lint failed']]) {
    const w = await driven('auto', ['true'], {}, red); await w.store.setMeta(w.epic, { 'cadre.baseline': JSON.stringify(base) }, 'x'); landing({ baseline })
    const out = await integrateEpic(w.h, w.epic); want ? assert.match(out, new RegExp(want)) : assert.equal(out, null)
  }
})
test('a unit that is its own repository is refused at integration with one line, and nothing moves (B7)', async () => {
  const { d, h } = await world(['true'], 'off', [{ root: '.', checks: { test: ['true'] } }, { root: 'lib', kind: 'submodule', ownGit: true, checks: { test: ['true'] } }]), old = sh(d, 'rev-parse', 'dev')
  assert.equal(await integrateEpic(h, 'p3'), 'lib is its own repository: landing a submodule is not supported'); assert.equal(sh(d, 'rev-parse', 'dev'), old); assert.equal((await h.board.read()).plan.state, 'approved')
})

test('integration: a unit setup may write the folders settings.jailWritable names (a package cache), as at admission', async () => {
  const { d, h } = await world(['true'], 'auto'), cfg = await h.config(), w = mkdtempSync(join(tmpdir(), 'cadre-cache-'))
  cfg.jailWritable = [w]; cfg.units[0].checks.setup = ['sh', '-c', `echo ok > ${w}/marker`]
  assert.equal(await integrateEpic(h, 'p3'), null); assert.equal(readFileSync(join(w, 'marker'), 'utf8').trim(), 'ok')
})
