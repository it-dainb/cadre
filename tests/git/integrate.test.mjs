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
const { skeleton } = await import('../../core/changelog.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

function world(check = ['test', '-f', 'c.txt']) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-int-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p3-auth', 'dev')
  sh(d, 'checkout', '-q', 'epic/p3-auth'); commit(d, 'c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.packages = [{ root: '.', setup: ['true'], checks: { test: check } }]; cfg.jail = 'off'
  const comments = [], h = fakeHost()
  Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t),
    taskStore: async () => ({ list: async () => [{ id: 'm-2', category: 'done', meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'Login' }) } }], comment: async (...a) => { comments.push(a) } }) })
  const task = (id, state = 'done') => ({ id, title: id, type: 'feature', kind: 'code', merges: true, state, step: '', phaseSince: 0, deps: [], flags: [] })
  return h.board.update(b => ({ ...b, epic: 'p3', plan: { id: 'p3', slug: 'auth', state: 'approved', epicBranch: 'epic/p3-auth' }, tasks: [task('m-2')] })).then(() => ({ d, h, comments, task }))
}

test('integration: --no-ff merge, changelog amended in, suites green -> dev moves, landed, epic branch gone, release proposed', async () => {
  const { d, h } = await world(), old = sh(d, 'rev-parse', 'dev')
  assert.equal(await integrateEpic(h, 'p3'), null)
  const dev = sh(d, 'rev-parse', 'dev'); assert.notEqual(dev, old)
  assert.equal(sh(d, 'rev-list', '--parents', '-n1', dev).split(' ').length, 3)
  assert.match(sh(d, 'show', 'dev:CHANGELOG.md'), /### Added\n\n- Login \(m-2\)/)
  const b = await h.board.read(); assert.equal(b.plan.state, 'done-on-dev'); assert.equal(b.plan.landed.sha, dev)
  assert.equal(sh(d, 'branch', '--list', 'epic/p3-auth'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1)
  assert.equal((await h.ui.read()).rel, '0.1.0')
  assert.deepEqual(Object.values((await h.events.read()).epics).flat().map(e => e.type).filter(t => t.startsWith('plan') || t.startsWith('release')), ['plan.landed', 'release.proposed'])
})
test('integration red: dev untouched, plan back to approved, integration-failed flag, comment left, throwaway gone', async () => {
  const { d, h, comments } = await world(['false']), old = sh(d, 'rev-parse', 'dev')
  assert.match(await integrateEpic(h, 'p3'), /root|\.:test failed/); assert.equal(sh(d, 'rev-parse', 'dev'), old)
  const b = await h.board.read(); assert.equal(b.plan.state, 'approved'); assert.deepEqual(b.plan.flags, ['integration-failed']); assert.equal(comments.length, 1)
  assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.equal(sh(d, 'branch', '--list', 'epic/p3-auth').trim(), 'epic/p3-auth')
})
test('integration refuses: open child, git:dev flag (human commit on dev), non-approved plan', async () => {
  const { h, task } = await world()
  await h.board.update(b => ({ ...b, tasks: [task('m-2', 'active')] })); assert.match(await integrateEpic(h, 'p3'), /children still open: m-2/)
  await h.board.update(b => ({ ...b, tasks: [task('m-2')] })); await h.git.update(g => ({ ...g, flags: { 'git:dev': {} } }))
  assert.match(await integrateEpic(h, 'p3'), /git flag git:dev/); assert.equal((await h.board.read()).plan.state, 'approved')
})
test('release: version inferred, [Unreleased] cut in a chore(release) commit on dev, --no-ff into main, annotated tag, plan released', async () => {
  const { d, h } = await world(); assert.equal(await integrateEpic(h, 'p3'), null)
  const text = await releaseDev(h); assert.match(text, /Released v0\.1\.0/)
  assert.equal(sh(d, 'cat-file', '-t', 'v0.1.0'), 'tag'); assert.equal(sh(d, 'rev-parse', 'main'), sh(d, 'rev-list', '-n1', 'v0.1.0'))
  assert.equal(sh(d, 'log', '-1', '--format=%s', 'dev'), 'chore(release): v0.1.0')
  assert.match(sh(d, 'show', 'main:CHANGELOG.md'), /## \[0\.1\.0\] - \d{4}-\d\d-\d\d\n\n### Added\n\n- Login \(m-2\)/)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(readFileSync(join(d, 'CHANGELOG.md'), 'utf8').includes('## [0.1.0]'), true)
  const b = await h.board.read(); assert.equal(b.plan.state, 'released'); assert.equal(b.plan.released.version, '0.1.0'); assert.equal('rel' in (await h.ui.read()), false)
  assert.match(await releaseDev(h), /nothing to release/)   // [Unreleased] is empty now
})
test('release refuses: empty [Unreleased], bad version, open flag, existing tag; dev stays put', async () => {
  const { d, h } = await world(), dev = sh(d, 'rev-parse', 'dev')
  assert.match(await releaseDev(h), /nothing to release/); assert.match(await releaseDev(h, '1.x'), /expected x\.y\.z/)
  await h.git.update(g => ({ ...g, flags: { 'git:dev': {} } })); assert.match(await releaseDev(h), /git:dev is open/)
  assert.equal(sh(d, 'rev-parse', 'dev'), dev); assert.equal(sh(d, 'tag', '--list'), '')
})
