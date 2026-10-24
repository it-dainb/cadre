// core/helpers on real git: a change outside manifests and lockfiles is discarded once and then fails; the probe tree and branch are gone on every end path, an orphan is swept, landing ignores probe/.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = await import('../../core/helpers.ts'), G = await import('../../core/git.ts'), B = await import('../../core/branches.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : undefined }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = async (cwd, ...a) => { const r = await run(a, { cwd }); assert.equal(r.exitCode, 0, `${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }

async function fix(runner = run) {
  const d = mkdtempSync(join('/var/tmp', 'cadre-helpers-')), root = join(d, 'repo'), wt = join(d, 'wt'), base = join(d, 'wts'), home = join(d, 'home')   // not under /tmp: the jail binds its scratch there
  for (const p of [root, home, base]) mkdirSync(p, { recursive: true })
  await sh(root, 'git', 'init', '-q', '-b', 'main'); await sh(root, 'git', 'config', 'user.email', 't@e.x'); await sh(root, 'git', 'config', 'user.name', 't')
  writeFileSync(join(root, 'package.json'), '{"name":"app"}\n'); writeFileSync(join(root, 'a.txt'), 'a\n'); await sh(root, 'git', 'add', '-A'); await sh(root, 'git', 'commit', '-qm', 'init'); await sh(root, 'git', 'worktree', 'add', '-q', '-b', 'feat/t-1', wt)
  const h = { run: runner, home: async () => home, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) } }
  return { d, root, wt, base, h, done: () => rmSync(d, { recursive: true, force: true }) }
}
// the install step does not run npm: it changes a tracked file, writes a new one and edits the manifest, the way a misbehaving install would
const stray = (wt) => (a, o) => { const i = a.indexOf('--'); return run(a[0] === 'bwrap' && a.includes('--chdir') && !a.includes('--unshare-net') ? [...a.slice(0, i + 1), 'sh', '-c', `echo changed > ${wt}/a.txt; echo x > ${wt}/stray.txt; echo '{"name":"app","dependencies":{"d":"1"}}' > ${wt}/package.json`] : a, o) }

test('a change outside manifests and lockfiles is discarded once; the next time the run fails and nothing stays', async () => {
  const f = await fix(); f.h.run = stray(f.wt); try {
    const inp = o => ({ root: f.root, wt: f.wt, scratch: join(f.d, 'scratch'), ask: 'add d', argv: ['npm', 'install', 'd'], auto: true, strays: 0, checkpoint: async () => {}, ...o }), mark = await sh(f.wt, 'git', 'rev-parse', 'HEAD')
    await P.approve(f.h, f.root)
    const first = await P.setup(f.h, inp()); assert.ok(first.stray, first.text); assert.match(first.text, /^Installed/)
    assert.equal(readFileSync(join(f.wt, 'a.txt'), 'utf8'), 'a\n'); assert.ok(!existsSync(join(f.wt, 'stray.txt'))); assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n'), ['package.json'])
    const head = await sh(f.wt, 'git', 'rev-parse', 'HEAD'); assert.notEqual(head, mark)
    await sh(f.wt, 'git', 'reset', '-q', '--hard', mark)
    const second = await P.setup(f.h, inp({ strays: 1 })); assert.match(second.text, /^The install changed nothing: it changed files besides the manifest and lockfile, again/)
    assert.equal(await sh(f.wt, 'git', 'rev-parse', 'HEAD'), mark); assert.equal(await sh(f.wt, 'git', 'status', '--porcelain'), ''); assert.ok(!existsSync(join(f.wt, 'stray.txt')))
  } finally { f.done() }
})

test('the probe tree and its probe/ branch are gone after done, failed or killed (the end is idempotent); an orphan is swept; a live one is kept', async () => {
  const f = await fix(); try {
    const gone = async n => { assert.ok(!existsSync(P.probePath(f.base, n)), 'tree'); assert.equal(await sh(f.root, 'git', 'branch', '--list', 'probe/*'), '', 'branch') }
    const n1 = { task: 'c-6-1', needId: 'n1' }, path = await P.probeAdd(f.h, f.root, f.base, n1)
    assert.equal(path, P.probePath(f.base, n1)); assert.ok(existsSync(join(path, 'package.json'))); assert.match(await sh(f.root, 'git', 'branch', '--list', 'probe/*'), /probe\/c-6-1-n1/)
    await P.probeEnd(f.h, f.root, f.base, n1); await gone(n1)   // done
    await P.probeEnd(f.h, f.root, f.base, n1); await gone(n1)   // failed or killed after it: nothing left to do, no throw
    await P.probeAdd(f.h, f.root, f.base, n1); await P.probeAdd(f.h, f.root, f.base, n1)   // a respawn starts from a fresh tree
    assert.equal((await sh(f.root, 'git', 'worktree', 'list')).split('\n').length, 3)   // repo, wt, one probe
    await P.probeEnd(f.h, f.root, f.base, n1)
    const n2 = { task: 'c-6-2', needId: 'n2' }; await P.probeAdd(f.h, f.root, f.base, n1); await P.probeAdd(f.h, f.root, f.base, n2)
    await P.probeSweep(f.h, f.root, f.base, ['c-6-1-n1']); assert.ok(existsSync(P.probePath(f.base, n1)), 'live kept'); assert.ok(!existsSync(P.probePath(f.base, n2)), 'orphan swept')
    assert.equal(await sh(f.root, 'git', 'branch', '--list', 'probe/*', '--format=%(refname:short)'), 'probe/c-6-1-n1')
    await run(['rm', '-rf', P.probePath(f.base, n1)]); await P.probeSweep(f.h, f.root, f.base, []); await gone(n1)   // an orphan whose folder is gone too (a killed process)
    assert.equal(await sh(f.root, 'git', 'rev-parse', 'main'), await sh(f.root, 'git', 'rev-parse', 'HEAD')); assert.equal(await sh(f.root, 'git', 'branch', '--list', 'feat/*', '--format=%(refname:short)'), 'feat/t-1')   // the task branch is untouched
  } finally { f.done() }
})

test('landing and push ignore probe/: it is no protected ref, and no landing rule names it', async () => {
  const o = { main: 'main', dev: 'dev', epicPrefix: 'epic/' }
  assert.equal(B.protectedRef('probe/c-6-1-n1', o), false); assert.equal(B.protectedRef('epic/c-6', o), true); assert.ok(P.PROBE.endsWith('/') && P.PROBE !== o.epicPrefix && !P.PROBE.startsWith('milestone'))
})
