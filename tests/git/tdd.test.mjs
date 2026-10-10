// Dev-only (ADR 0003): REAL bwrap copy-jail + spec view + TDD gates against real git. node --experimental-transform-types --test tests/git/*.test.mjs
// Skip-free by design: no usable bwrap fails loudly (the copy-jail is the A19 fallback and must be proven where it runs).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const G = await import('../../core/git.ts')
const V = await import('../../core/specview.ts')
const T = await import('../../core/tdd.ts')
const { fakeHost, task: snap } = await import('../support.ts')
const { defaults } = await import('../../config/defaults.ts')
const { repoKeyOf } = await import('../../commands/init.ts')
const { policyOf } = await import('../../policy/guards.ts')

const run = (argv, init = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: init.env ? { ...process.env, ...init.env } : undefined }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })).stdin?.end(init.stdin))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
// scratch is bound AT /tmp; the worktree is bound on top of it, so it may live under /tmp too
const base = () => { const r = join(homedir(), '.cache', 'cadre-test'); mkdirSync(r, { recursive: true }); return mkdtempSync(join(r, 't-')) }

test('copy-jail (real bwrap): writes die with the copy, /tmp is the scratch, network is off, HOME scratch audit lists what setup wrote', async () => {
  const mode = await G.jailMode(run)
  assert.notEqual(mode, 'none', 'bwrap must work here (A19 fallback is proven on this host)')
  const b = base(), wt = join(b, 'wt'), scratch = join(b, 'scratch'); mkdirSync(wt); mkdirSync(scratch); writeFileSync(join(wt, 'a.txt'), 'orig')
  const script = 'echo changed > a.txt; echo new > b.txt; mkdir -p /tmp/cadre; echo ok > /tmp/cadre/report.xml; tail -n +3 /proc/net/dev | cut -d: -f1 | sed s/\\ //g > /tmp/cadre/net'
  const r = await G.checkRun(run, 'copy', { wt, scratch, pkgRoot: wt, argv: ['sh', '-c', script] })
  assert.equal(r.exitCode, 0, r.stderr)
  assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'orig'); assert.equal(existsSync(join(wt, 'b.txt')), false)   // discarded with the copy
  assert.equal(readFileSync(join(scratch, 'cadre/report.xml'), 'utf8'), 'ok\n'); assert.equal(readFileSync(join(scratch, 'cadre/net'), 'utf8').trim(), 'lo')   // --unshare-net
  assert.equal(existsSync(join(scratch, 'cp')), false)   // the copy is removed
  const home = join(scratch, 'home'); mkdirSync(home)
  const a = await run(G.homeScratchJail({ wt, scratch, pkgRoot: wt, scratchHome: home, argv: ['sh', '-c', 'mkdir -p "$HOME/.cache/pnpm" "$XDG_CACHE_HOME/x"; echo $HOME > $HOME/.cache/pnpm/h'] }))
  assert.equal(a.exitCode, 0, a.stderr); assert.equal(readFileSync(join(home, '.cache/pnpm/h'), 'utf8').trim(), home)
})

test('writable jail (real bwrap): a worktree under /tmp stays visible when scratch is bound at /tmp (eval sandboxes)', async () => {
  const t = mkdtempSync(join(tmpdir(), 'cadre-wt-')), wt = join(t, 'wt'), b = base(), scratch = join(b, 'scratch'); mkdirSync(wt); mkdirSync(scratch); writeFileSync(join(wt, 'a.txt'), 'x')
  const r = await run(G.writableJail({ wt, scratch, pkgRoot: wt, argv: ['sh', '-c', 'cat a.txt && echo y > w.txt && test "$TMPDIR" = /tmp && mkdir "$TMPDIR/ok"'] }), { env: { TMPDIR: join(t, 'gone') } })   // the caller's TMPDIR does not exist in the jail (go: creating work dir)
  assert.equal(r.exitCode, 0, r.stderr); assert.equal(readFileSync(join(wt, 'w.txt'), 'utf8'), 'y\n')
})

// ---- a repo with a package whose "tests" are json cases run by run.mjs, which writes JUnit to /tmp/cadre/r.xml ----
const RUN = `import {readdirSync,readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs'
const dir='test', cs=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(dir+'/'+f,'utf8'))):[]
const tag=c=>c.status==='failure'?'<failure message="'+c.text+'"/>':c.status==='error'?'<error message="'+c.text+'"/>':c.status==='skipped'?'<skipped/>':''
mkdirSync('/tmp/cadre',{recursive:true}); writeFileSync('/tmp/cadre/r.xml','<testsuite>'+cs.map(c=>'<testcase classname="s" name="'+c.name+'">'+tag(c)+'</testcase>').join('')+'</testsuite>')
process.exit(cs.some(c=>c.status!=='passed')?1:0)
`
function world(over = {}) {
  const b = base(), root = join(b, 'repo'); mkdirSync(root); execFileSync('git', ['init', '-q', '-b', 'dev', root]); sh(root, 'config', 'user.name', 't'); sh(root, 'config', 'user.email', 't@t')
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test')); mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'src/login.ts'), 'export const SECRET_IMPL = 1\n'); writeFileSync(join(root, 'docs/guide.md'), '# guide\n'); writeFileSync(join(root, 'run.mjs'), RUN)
  writeFileSync(join(root, 'test/old.json'), JSON.stringify({ name: 'old', status: 'passed' })); symlinkSync('../src/login.ts', join(root, 'test/link.ts'))
  sh(root, 'add', '-A'); sh(root, 'commit', '-qm', 'init'); sh(root, 'branch', 'epic/e1-x')
  const pkg = { root: '.', setup: [], checks: { test: ['node', 'run.mjs'], knownbad: ['false'] }, verify: ['test'], viewInclude: ['docs/**'], tdd: { paths: ['test/**'], report: '/tmp/cadre/r.xml' }, ...over.pkg }
  const cfg = { ...defaults(), packages: [pkg], worktrees: { root: join(b, 'wt') }, jail: 'auto', ...over.cfg }
  const meta = {}, comments = [], store = { async setMeta(id, kv) { Object.assign(meta, kv) }, async comment(id, t) { comments.push(t) }, async move() {}, async get(id) { return { id, title: 't', type: over.type ?? 'feature', meta: { ...meta }, acceptance: 'S1: Given a When b Then c', design: over.design ?? JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: 'u', returns: 'bool', status: 'new' }] }) } } }
  const h = fakeHost(); Object.assign(h, { run, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, cwd: async () => root, home: async () => b, config: async () => cfg, taskStore: async () => store })
  const d = { store, cfg, reg: cfg.types, root, home: b, wtRoot: cfg.worktrees.root, key: repoKeyOf(root), actor: 'a', session: 's' }
  return { b, root, h, d, meta, comments, store, pkg }
}
const mkTask = async w => w.store.get('m-1')
const worktree = async w => { const wt = join(w.d.wtRoot, 'wt1'); mkdirSync(w.d.wtRoot, { recursive: true }); await G.worktreeAdd(run, w.root, wt, 'feat/m-1-x', await G.tip(run, w.root, 'epic/e1-x')); return wt }

test('spec view golden: no source bodies, no symlinks, tdd.paths + viewInclude + rendered docs, a hash per file; audit lists writes outside tdd.paths', async () => {
  const w = world(), wt = await worktree(w), view = await V.buildView(w.h, w.d, await mkTask(w), wt)
  assert.deepEqual(readdirSync(view).sort(), ['FILES.md', 'INTERFACE.md', 'SCENARIOS.md', 'docs', 'test'])
  assert.equal(existsSync(join(view, 'src')), false); assert.equal(existsSync(join(view, 'test/link.ts')), false)   // symlink skipped, source body absent
  for (const f of ['test/old.json', 'docs/guide.md', 'SCENARIOS.md', 'INTERFACE.md']) assert.ok(lstatSync(join(view, f)).isFile())
  assert.match(readFileSync(join(view, 'INTERFACE.md'), 'utf8'), /\[new\] function login/)
  const man = JSON.parse(w.meta['cadre.view']); assert.deepEqual(Object.keys(man).sort(), ['FILES.md', 'INTERFACE.md', 'SCENARIOS.md', 'docs/guide.md', 'test/old.json'])
  assert.equal(man['docs/guide.md'], sh(w.root, 'rev-parse', 'HEAD:docs/guide.md'))   // content hash == git blob hash
  await V.logCall(w.h, 'ag1', { tool: 'Read', path: 'test/old.json', outcome: 'ok' }); await V.logCall(w.h, 'ag1', { tool: 'Read', path: '../x', outcome: 'denied' })
  writeFileSync(join(view, 'test/new.json'), '{}'); writeFileSync(join(view, 'notes.txt'), 'x'); writeFileSync(join(view, 'SCENARIOS.md'), 'tampered')
  const a = await V.auditView(w.h, w.d, { ...(await mkTask(w)), meta: { ...w.meta } }, view, 'ag1')
  assert.deepEqual(a.changed, ['SCENARIOS.md', 'notes.txt', 'test/new.json']); assert.deepEqual(a.outside, ['SCENARIOS.md', 'notes.txt'])
  assert.equal(a.calls, 2); assert.equal(a.denied, 1); assert.match(w.comments.at(-1), /^\[cadre:tester-log v1\]/)
})

const tc = (name, status, text = '') => JSON.stringify({ name, status, text })
const tester = async (w, files, tests, over = {}) => {   // build the view, let the "tester" write files, then testerDone
  const wt = await worktree(w), task = await mkTask(w), view = await V.buildView(w.h, w.d, task, wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: task.type, state: 'active', step: 'tester' })] }))
  w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  return { wt, view, task: await mkTask(w), res: await T.testerDone(w.h, w.d, await mkTask(w), wt, view, tests.map(n => ({ path: 'test/s.json', name: n })), over.agent) }
}

test('copy-in by path only, red passes on <failure>, specCommit + lock + advance to worker; fence locks are absolute', async () => {
  const w = world(), { wt, res } = await tester(w, { 'test/s.json': tc('login ok', 'failure', 'expected true'), 'notes.txt': 'outside', 'SCENARIOS.md': 'x' }, ['login ok'])
  assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/)
  assert.equal(existsSync(join(wt, 'test/s.json')), true); assert.equal(existsSync(join(wt, 'notes.txt')), false); assert.equal(existsSync(join(wt, 'SCENARIOS.md')), false)
  assert.equal(sh(wt, 'log', '-1', '--format=%s'), 'wip(m-1): spec tests'); assert.equal(w.meta['cadre.specCommit'], sh(wt, 'rev-parse', 'HEAD'))
  assert.deepEqual(JSON.parse(w.meta['cadre.locked']), ['test/s.json']); assert.deepEqual((await policyOf(w.h)).locks['m-1'], [`${wt}/test/s.json`])
  assert.equal((await w.h.board.read()).tasks[0].step, 'worker')   // tester -> red -> worker
  // close: M/D/R of a locked file since specCommit is refused, an add is not
  const spec = w.meta['cadre.specCommit']; writeFileSync(join(wt, 'src/extra.ts'), 'x'); writeFileSync(join(wt, 'test/s.json'), tc('login ok', 'passed')); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'w')
  assert.deepEqual(await T.lockedViolations(run, wt, spec, ['test/s.json']), ['test/s.json']); assert.deepEqual(await T.lockedViolations(run, wt, spec, ['src/extra.ts']), [])
})

test('red refused: tests pass; test missing from the report; a test that passed or skipped', async () => {
  for (const [files, tests, why] of [
    [{ 'test/s.json': tc('a', 'passed') }, ['a'], /pass at the spec commit/],
    [{ 'test/s.json': tc('a', 'failure') }, ['a', 'ghost'], /"ghost" is not in the report/],
    [{ 'test/s.json': tc('a', 'failure'), 'test/t.json': tc('b', 'skipped') }, ['a', 'b'], /"b" skipped at red/],
  ]) { const w = world(), { res } = await tester(w, files, tests); assert.equal(res.ok, false); assert.match(res.why, why); assert.equal((await w.h.board.read()).tasks[0].step, 'tester') }
})

test('<error> rule: accepted only for status:new symbols with no skeleton; non-new or unrelated errors refused', async () => {
  const d = JSON.stringify({ symbols: [{ name: 'login', status: 'new' }, { name: 'logout', status: 'unchanged' }] })
  let w = world({ design: d }), r = (await tester(w, { 'test/s.json': tc('a', 'error', 'ReferenceError: login is not defined') }, ['a'])).res
  assert.ok(r.ok, r.why)
  w = world({ design: d }); r = (await tester(w, { 'test/s.json': tc('a', 'error', 'ReferenceError: logout is not defined') }, ['a'])).res
  assert.equal(r.ok, false); assert.match(r.why, /errors, not failures/)
  w = world({ design: d }); r = (await tester(w, { 'test/s.json': tc('a', 'error', 'SyntaxError: unexpected token') }, ['a'])).res
  assert.equal(r.ok, false); assert.match(r.why, /errors, not failures/)
  w = world({ design: d, pkg: { tdd: { paths: ['test/**'], report: '/tmp/cadre/r.xml', skeleton: ['true'] } } }); r = (await tester(w, { 'test/s.json': tc('a', 'error', 'ReferenceError: login is not defined') }, ['a'])).res
  assert.equal(r.ok, false); assert.match(r.why, /errors, not failures/)   // a skeleton exists: its stubs must make names resolve
  assert.equal(T.errorOk('login is not defined', T.symbolsOf(d), false), true); assert.equal(T.errorOk('login and logout', T.symbolsOf(d), false), false)
})

test('test type has no red: its tests must pass instead; copy-in sets sourceCommit', async () => {
  let w = world({ type: 'test' }); let r = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a'])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /must pass/)
  w = world({ type: 'test' }); r = await tester(w, { 'test/s.json': tc('a', 'passed') }, ['a'])
  assert.ok(r.res.ok, r.res.why); assert.equal(w.meta['cadre.sourceCommit'], w.meta['cadre.specCommit']); assert.equal((await w.h.board.read()).tasks[0].step, 'reviewer')
})

test('green: spec tests must be passed (skipped != passed); knownRed runs but never gates; a failing verify refuses', async () => {
  const w = world({ pkg: { knownRed: ['knownbad'] } }), { wt } = await tester(w, { 'test/s.json': tc('login ok', 'failure') }, ['login ok'])
  let g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false); assert.match(g.why, /test fails/)   // still red
  writeFileSync(join(wt, 'test/s.json'), tc('login ok', 'skipped')); writeFileSync(join(wt, 'test/old.json'), tc('old', 'passed'))
  g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false)   // skipped: verify fails and, were it exit 0, the spec test still is not passed
  writeFileSync(join(wt, 'test/s.json'), tc('login ok', 'passed'))
  g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /knownRed knownbad=1/)   // knownRed exit 1 does not gate
  const ran = Object.values((await w.h.events.read()).epics).flat().filter(x => x.type === 'check.ran')   // UI log: phase / failing / secs
  assert.ok(ran.some(x => x.data.phase === 'red' && x.data.ok === true && x.data.failing === 1 && typeof x.data.secs === 'number'), JSON.stringify(ran)); assert.ok(ran.some(x => x.data.phase === 'green' && x.data.ok === true))
  // a spec test absent from the report is not passed either
  const w2 = world({ pkg: { verify: ['v2'], checks: { test: ['node', 'run.mjs'], v2: ['true'] }, tdd: { check: 'test', paths: ['test/**'], report: '/tmp/cadre/r.xml' } } }); const t2 = await tester(w2, { 'test/s.json': tc('login ok', 'failure') }, ['login ok'])
  const g2 = await T.green(w2.h, w2.d, await mkTask(w2), t2.wt); assert.equal(g2.ok, false); assert.match(g2.why, /spec test\(s\) not passed: s\.login ok/)
})

test('spec_change: owner report blocks; reject resumes the worker, accept rewinds to the tester; both leave a decision', async () => {
  for (const how of ['reject', 'accept']) {
    const w = world(), r = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); assert.ok(r.res.ok, r.res.why)
    await T.specChange(w.h, w.d, 'm-1', 'the contract needs a second param')
    assert.equal((await w.h.board.read()).tasks[0].state, 'blocked'); assert.equal(w.meta['cadre.blocked'], 'spec_change')
    assert.match((await T.resolveSpec(w.h, 'm-1', 'maybe')).text, /accept\|reject/)
    const out = await T.resolveSpec(w.h, 'm-1', how), t = (await w.h.board.read()).tasks[0]
    assert.match(out.text, how === 'accept' ? /accepted/ : /rejected/); assert.equal(t.state, 'active'); assert.equal(t.step, how === 'accept' ? 'tester' : 'worker')
    assert.match(w.meta['cadre.decision'], how === 'accept' ? /accepted: the contract/ : /rejected/); assert.equal(w.meta['cadre.blocked'], '')
    assert.match((await T.resolveSpec(w.h, 'm-1', how)).text, /not waiting/)
  }
})

test('a refused red leaves no copy-in commit; the identical retry reaches the gate again', async () => {
  const w = world(), files = { 'test/s.json': tc('a', 'passed') }, { wt, view, res } = await tester(w, files, ['a']), pre = sh(wt, 'rev-parse', 'HEAD')
  assert.equal(res.ok, false); assert.match(res.why, /pass at the spec commit/); assert.equal(sh(wt, 'rev-parse', 'HEAD'), pre); assert.equal(existsSync(join(wt, 'test/s.json')), false); assert.equal(sh(wt, 'status', '--porcelain'), '')
  const again = await T.testerDone(w.h, w.d, await mkTask(w), wt, view, [{ path: 'test/s.json', name: 'a' }])
  assert.match(again.why, /pass at the spec commit/)   // not "identical to the base; nothing to lock"
})
