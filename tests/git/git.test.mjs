// Dev-only (ADR 0003): real git over the pure core/git helpers. node --experimental-transform-types --test tests/git/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as G from '../../core/git.ts'

const run = (argv, init = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: init.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-git-')); execFileSync('git', ['init', '-q', '-b', 'dev', d])
  sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t'); writeFileSync(join(d, 'a.txt'), '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'epic/e1-x'); return d
}
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })

test('git.op: busy CAS, epoch++ after, busy refuses re-entry, released on throw', async () => {
  const h = { git: cell({ busy: false, epoch: 0 }) }
  await G.op(h, async () => { await assert.rejects(G.op(h, async () => 1), /git busy/) })
  assert.deepEqual(await h.git.read(), { busy: false, epoch: 1 })
  await assert.rejects(G.op(h, async () => { throw new Error('boom') }), /boom/)
  assert.deepEqual(await h.git.read(), { busy: false, epoch: 2 })
})
test('worktree add -b from the epic tip, commitAll (clean tree -> null), diff facts, remove + branch -D', async () => {
  const d = repo(), wt = `${d}-wt`, base = await G.tip(run, d, 'epic/e1-x')
  await G.worktreeAdd(run, d, wt, 'feat/a1-x', base)
  assert.equal(await G.commitAll(run, wt, 'wip(a1): none'), null)
  writeFileSync(join(wt, 'b.txt'), 'x\n'); const c = await G.commitAll(run, wt, 'wip(a1): checkpoint')
  assert.equal(c, sh(wt, 'rev-parse', 'HEAD')); assert.match(await G.diffStat(run, wt, `${base}..${c}`), /b\.txt/); assert.match(await G.diffPatch(run, wt, `${base}..${c}`, 50), /^diff --git/)
  await G.worktreeRemove(run, d, wt, 'feat/a1-x')
  assert.equal(existsSync(wt), false); assert.equal(await G.exists(run, d, 'feat/a1-x'), false)
})
test('recovery: a deleted worktree dir is re-added from its branch', async () => {
  const d = repo(), wt = `${d}-wt`; await G.worktreeAdd(run, d, wt, 'feat/a1-x', 'epic/e1-x')
  execFileSync('rm', ['-rf', wt]); await G.worktreeReadd(run, d, wt, 'feat/a1-x'); assert.equal(existsSync(join(wt, 'a.txt')), true)
})
test('squash: detached at the epic tip, one commit with the message; epic ref moves by CAS; a lost CAS returns false', async () => {
  const d = repo(), wt = `${d}-wt`, base = await G.tip(run, d, 'epic/e1-x')
  await G.worktreeAdd(run, d, wt, 'feat/a1-x', base)
  writeFileSync(join(wt, 'b.txt'), 'x\n'); await G.commitAll(run, wt, 'wip(a1): one'); writeFileSync(join(wt, 'b.txt'), 'y\n'); const src = await G.commitAll(run, wt, 'wip(a1): two')
  const sq = await G.squash(run, wt, base, src, 'feat: add b\n\nRefs: a1')
  assert.equal(sh(wt, 'rev-list', '--count', `${base}..${sq}`), '1'); assert.equal(sh(wt, 'log', '-1', '--format=%s', sq), 'feat: add b')
  assert.equal(await G.casRef(run, d, 'refs/heads/epic/e1-x', sq, base), true); assert.equal(sh(d, 'rev-parse', 'epic/e1-x'), sq)
  assert.equal(await G.casRef(run, d, 'refs/heads/epic/e1-x', base, base), false)   // stale old value
})
test('squash conflict: throws and leaves the worktree clean at the epic tip', async () => {
  const d = repo(), wt = `${d}-wt`, base = await G.tip(run, d, 'epic/e1-x')
  await G.worktreeAdd(run, d, wt, 'feat/a1-x', base); writeFileSync(join(wt, 'a.txt'), 'mine\n'); const src = await G.commitAll(run, wt, 'wip(a1): mine')
  const d2 = `${d}-e`; await G.worktreeAdd(run, d, d2, 'tmp-e', 'epic/e1-x'); writeFileSync(join(d2, 'a.txt'), 'theirs\n'); const moved = await G.commitAll(run, d2, 'other')
  await assert.rejects(G.squash(run, wt, moved, src, 'feat: x'), /conflict/); assert.equal(sh(wt, 'status', '--porcelain'), '')
})
test('jail argv, exactly per 3.10', () => {
  const j = { wt: '/w/t', scratch: '/s', pkgRoot: '/w/t/pkg', argv: ['npm', 'test'], writable: ['/c'] }
  assert.deepEqual(G.overlayJail(j), ['bwrap', '--unshare-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/s', '/tmp', '--overlay-src', '/w/t', '--tmp-overlay', '/w/t', '--bind', '/c', '/c', '--chdir', '/w/t/pkg', '--', 'npm', 'test'])
  assert.deepEqual(G.writableJail(j), ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/s', '/tmp', '--bind', '/w/t', '/w/t', '--bind', '/c', '/c', '--chdir', '/w/t/pkg', '--', 'npm', 'test'])
  assert.ok(!G.writableJail(j).includes('--unshare-net'))
  const hj = G.homeJail({ ...j, home: '/home/u' })
  assert.deepEqual(hj.slice(0, 17), ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/s', '/tmp', '--bind', '/w/t', '/w/t', '--overlay-src', '/home/u', '--overlay'])
  assert.deepEqual(hj.slice(17, 21), ['/s/home-up', '/s/home-work', '/home/u', '--bind'])
})
