// Dev-only (ADR 0003): epic cut, integration (--no-ff), dev CAS, release + tag against real git. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const B = await import('../../core/branches.ts')
const run = argv => new Promise(res => execFile(argv[0], argv.slice(1), (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })
const world = () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-br-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'a.txt'), '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev')
  return { d, h: { cwd: async () => d, run, git: cell({ busy: false, epoch: 0 }), board: cell({ plan: { id: 'p3', epicBranch: 'epic/p3-auth' } }) } }
}

test('cutEpic: branch from dev at first approval; idempotent; refuses a plan that is not on the board', async () => {
  const { d, h } = world(), tip = sh(d, 'rev-parse', 'dev')
  assert.equal(await B.cutEpic(h, 'p3'), tip); assert.equal(sh(d, 'rev-parse', 'epic/p3-auth'), tip)
  writeFileSync(join(d, 'b.txt'), '2\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'later'); sh(d, 'branch', '-f', 'dev', 'HEAD')
  assert.equal(await B.cutEpic(h, 'p3'), tip)   // kept, not re-cut
  await assert.rejects(B.cutEpic(h, 'p9'), /no draft plan p9/); assert.equal((await h.git.read()).busy, false)
})
test('integration: --no-ff merge in a throwaway worktree, dev moves by CAS, epic branch dropped; a stale CAS leaves dev alone', async () => {
  const { d, h } = world(); await B.cutEpic(h, 'p3')
  const wt = `${d}-e`; sh(d, 'worktree', 'add', wt, 'epic/p3-auth'); writeFileSync(join(wt, 'c.txt'), '3\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'feat: c'); sh(d, 'worktree', 'remove', '--force', wt)
  const tmp = `${d}-int`, { sha, devTip } = await B.mergeEpic(h, { dev: 'dev', epic: 'epic/p3-auth', tmp, msg: 'merge epic p3' })
  assert.equal(sh(tmp, 'rev-list', '--parents', '-n1', sha).split(' ').length, 3)   // a real merge commit: two parents
  assert.equal(sh(d, 'rev-parse', 'dev'), devTip)                                   // dev untouched until landed
  assert.equal(await B.landDev(h, { dev: 'dev', sha, old: 'a'.repeat(40), tmp, epic: 'epic/p3-auth' }), false); assert.equal(sh(d, 'rev-parse', 'dev'), devTip)
  assert.equal(await B.landDev(h, { dev: 'dev', sha, old: devTip, tmp, epic: 'epic/p3-auth' }), true); assert.equal(sh(d, 'rev-parse', 'dev'), sha)
  assert.equal(sh(d, 'branch', '--list', 'epic/p3-auth'), '')
})
test('integration conflict: the throwaway worktree is removed and the error surfaces', async () => {
  const { d, h } = world(); await B.cutEpic(h, 'p3')
  const wt = `${d}-e`; sh(d, 'worktree', 'add', wt, 'epic/p3-auth'); writeFileSync(join(wt, 'a.txt'), 'epic\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'e'); sh(d, 'worktree', 'remove', '--force', wt)
  writeFileSync(join(d, 'a.txt'), 'dev\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'd'); sh(d, 'branch', '-f', 'dev', 'HEAD')
  await assert.rejects(B.mergeEpic(h, { dev: 'dev', epic: 'epic/p3-auth', tmp: `${d}-int`, msg: 'm' })); assert.equal(sh(d, 'worktree', 'list').includes('-int'), false)
})
test('release: dev --no-ff into main, annotated tag, main moved by CAS, temp branch gone', async () => {
  const { d, h } = world(); writeFileSync(join(d, 'r.txt'), 'r\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'chore(release): v0.1.0'); sh(d, 'branch', '-f', 'dev', 'HEAD'); sh(d, 'reset', '-q', '--hard', 'HEAD~1'); sh(d, 'checkout', '-q', '--detach')   // main checked out nowhere (else it waits: tests/git/devmoved)
  const sha = await B.release(h, { dev: 'dev', main: 'main', version: '0.1.0', tmp: `${d}-rel`, msg: 'release v0.1.0' })
  assert.equal(sh(d, 'rev-parse', 'main'), sha); assert.equal(sh(d, 'cat-file', '-t', 'v0.1.0'), 'tag'); assert.equal(sh(d, 'branch', '--list', 'release-tmp-*'), '')
  assert.equal(await B.lastTag(h), 'v0.1.0')
})
