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
  const cfg = { ...defaults(), units: [pkg], worktrees: { root: join(b, 'wt') }, jail: 'auto', ...over.cfg }
  if (!over.cover) cfg.review = { ...cfg.review, coverage: { enforce: false } }   // the fixtures name tests 'a', 'login ok'; the coverage rule has its own test
  const meta = {}, comments = [], ctl = { revision: '0', doc: {} }, store = { async setMeta(id, kv) { Object.assign(meta, kv) }, async update(id, p) { if (p.acceptance !== undefined) over.acceptance = p.acceptance },  async control() { return ctl }, async setControl(p) { Object.assign(ctl.doc, p); return ctl }, async move() {}, async resume() {}, async get(id) { return { id, title: 't', type: over.type ?? 'feature', meta: { ...meta }, acceptance: over.acceptance ?? 'S1: Given a When b Then c', description: 'page 1 skips the first page', design: over.design ?? JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: 'u', returns: 'bool', status: 'new' }] }) } } }
  const h = fakeHost(); Object.assign(h, { run, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, cwd: async () => root, home: async () => b, config: async () => cfg, taskStore: async () => store })
  const d = { store, cfg, reg: cfg.types, root, home: b, wtRoot: cfg.worktrees.root, key: repoKeyOf(root), actor: 'a', session: 's' }
  return { b, root, h, d, meta, comments, store, pkg, acceptance: () => over.acceptance }
}
const mkTask = async w => w.store.get('m-1')
const worktree = async w => { const wt = join(w.d.wtRoot, 'wt1'); mkdirSync(w.d.wtRoot, { recursive: true }); await G.worktreeAdd(run, w.root, wt, 'feat/m-1-x', await G.tip(run, w.root, 'epic/e1-x')); return wt }

test('spec view golden: no source bodies, no symlinks, tdd.paths + viewInclude + rendered docs, a hash per file; audit lists writes outside tdd.paths', async () => {
  const w = world(), wt = await worktree(w), view = await V.buildView(w.h, w.d, await mkTask(w), wt)
  assert.deepEqual(readdirSync(view).sort(), ['FILES.md', 'INTERFACE.md', 'SCENARIOS.md', 'docs', 'test'])
  assert.equal(existsSync(join(view, 'src')), false); assert.equal(existsSync(join(view, 'test/link.ts')), false)   // symlink skipped, source body absent
  for (const f of ['test/old.json', 'docs/guide.md', 'SCENARIOS.md', 'INTERFACE.md']) assert.ok(lstatSync(join(view, f)).isFile())
  assert.match(readFileSync(join(view, 'INTERFACE.md'), 'utf8'), /\[new\] function login/)
  const lite = world({ acceptance: '' }), v2 = await V.buildView(lite.h, lite.d, await mkTask(lite), await worktree(lite))   // a lite bug (no scenarios): the bug report is the tester's spec
  assert.match(readFileSync(join(v2, 'SCENARIOS.md'), 'utf8'), /reproduces the bug described below[\s\S]*page 1 skips the first page/)
  const man = JSON.parse(w.meta['cadre.view']); assert.deepEqual(Object.keys(man).sort(), ['FILES.md', 'INTERFACE.md', 'SCENARIOS.md', 'docs/guide.md', 'test/old.json'])
  assert.equal(man['docs/guide.md'], sh(w.root, 'rev-parse', 'HEAD:docs/guide.md'))   // content hash == git blob hash
  await V.logCall(w.h, 'ag1', { tool: 'Read', path: 'test/old.json', outcome: 'ok' }); await V.logCall(w.h, 'ag1', { tool: 'Read', path: '../x', outcome: 'denied' })
  writeFileSync(join(view, 'test/new.json'), '{}'); writeFileSync(join(view, 'notes.txt'), 'x'); writeFileSync(join(view, 'SCENARIOS.md'), 'tampered')
  const a = await V.auditView(w.h, w.d, { ...(await mkTask(w)), meta: { ...w.meta } }, view, 'ag1')
  assert.deepEqual(a.changed, ['SCENARIOS.md', 'notes.txt', 'test/new.json']); assert.deepEqual(a.outside, ['SCENARIOS.md', 'notes.txt'])
  assert.equal(a.calls, 2); assert.equal(a.denied, 1); assert.match(a.text, /^tester audit: 3 file\(s\) changed, 2 outside tdd.paths/)
})

const tc = (name, status, text = '') => JSON.stringify({ name, status, text })
const tester = async (w, files, tests, over = {}) => {   // build the view, let the "tester" write files, then testerDone
  const wt = await worktree(w), task = await mkTask(w), view = await V.buildView(w.h, w.d, task, wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: task.type, state: 'active', step: 'tester' })] }))
  w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  return { wt, view, task: await mkTask(w), res: await T.testerDone(w.h, w.d, await mkTask(w), wt, view, tests.map(n => ({ path: 'test/s.json', name: n })), over.agent) }
}

test('review.coverage.enforce: a tester report with no test named after a scenario is refused and the copy-in undone; naming it passes', async () => {
  let w = world({ cover: true, acceptance: 'S1: Given a When b Then c\nS2: Given a When b Then d' }), r = await tester(w, { 'test/s.json': tc('S1 login ok', 'failure') }, ['S1 login ok'])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /no test is named after S2: write a test for every scenario/); assert.equal(w.meta['cadre.specCommit'], undefined); assert.equal(existsSync(join(r.wt, 'test/s.json')), false)
  w = world({ cover: true, acceptance: 'S1: Given a When b Then c\nS2: Given a When b Then d' }); r = await tester(w, { 'test/s.json': tc('S1 login ok', 'failure'), 'test/t.json': tc('test_s2_rejects', 'failure') }, ['S1 login ok', 'test_s2_rejects'])
  assert.ok(r.res.ok, r.res.why)
})

test('copy-in by path only, red passes on <failure>, specCommit + lock + advance to worker; fence locks are absolute', async () => {
  const w = world(), { wt, res } = await tester(w, { 'test/s.json': tc('login ok', 'failure', 'expected true'), 'notes.txt': 'outside', 'SCENARIOS.md': 'x' }, ['login ok'])
  assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/)
  assert.equal(existsSync(join(wt, 'test/s.json')), true); assert.equal(existsSync(join(wt, 'notes.txt')), false); assert.equal(existsSync(join(wt, 'SCENARIOS.md')), false)
  assert.equal(sh(wt, 'log', '-1', '--format=%s'), 'wip(m-1): spec tests'); assert.equal(w.meta['cadre.specCommit'], sh(wt, 'rev-parse', 'HEAD'))
  assert.deepEqual(JSON.parse(w.meta['cadre.locked']), ['test/s.json']); assert.deepEqual((await policyOf(w.h)).locks['m-1'], [`${wt}/test/s.json`])
  assert.equal((await w.h.board.read()).tasks[0].step, 'worker')   // tester -> red -> worker
  assert.equal(w.meta['cadre.step'], 'worker')   // persisted in the store too: the board is rebuilt from it after /clear
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

test('failure baseline: a test red when the plan started does not fail the green gate; a NEW failing test does; measured once per plan', async () => {
  const w = world(); writeFileSync(join(w.root, 'test/old.json'), tc('old', 'failure')); sh(w.root, 'commit', '-qam', 'old is red'); sh(w.root, 'branch', '-f', 'epic/e1-x', 'dev')
  await w.h.board.update(s => ({ ...s, epic: 'e1', plan: { id: 'e1', slug: 'x', state: 'approved', epicBranch: 'epic/e1-x' } }))
  const wt = await worktree(w)
  let g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /test fails only where it failed before the plan/)
  assert.deepEqual(JSON.parse(w.meta['cadre.baseline']), { '.:test': { exit: 1, fails: ['s.old'] } })
  writeFileSync(join(wt, 'test/new.json'), tc('new', 'failure')); g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false); assert.match(g.why, /test fails/)
  const n = w.meta['cadre.baseline']; await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(w.meta['cadre.baseline'], n)   // kept: not measured again
})
test('spec_change: owner report blocks; reject resumes the worker, accept rewinds to the tester; both leave a decision', async () => {
  for (const how of ['reject', 'accept']) {
    const w = world(), r = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); assert.ok(r.res.ok, r.res.why); w.meta['cadre.worktree'] = r.wt
    await T.specChange(w.h, w.d, 'm-1', 'the contract needs a second param')
    assert.equal((await w.h.board.read()).tasks[0].state, 'blocked'); assert.equal(w.meta['cadre.blocked'], 'spec_change')
    assert.match((await T.resolveSpec(w.h, 'm-1', 'maybe')).text, /accept\|reject/)
    const out = await T.resolveSpec(w.h, 'm-1', how), t = (await w.h.board.read()).tasks[0]
    assert.match(out.text, how === 'accept' ? /accepted/ : /rejected/); assert.equal(t.state, 'active'); assert.equal(t.step, how === 'accept' ? 'tester' : 'worker')
    assert.match(w.meta['cadre.decision'], how === 'accept' ? /accepted: the contract/ : /rejected/); assert.equal(w.meta['cadre.blocked'], '')
    assert.match((await T.resolveSpec(w.h, 'm-1', how)).text, /not waiting/)
  }
})

test('spec_change accept: red rounds restart quietly; the scenario is amended; the tester hears only the decider, once', async () => {
  const { brief } = await import('../../core/briefs.ts'), { budgetOf, charge } = await import('../../core/lifecycle.ts')
  const w = world({ acceptance: 'S5: Given npm test When run Then it passes\nS6: other' }), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  await charge(w.h, 'm-1', 'red'); await charge(w.h, 'm-1', 'red'); 
  await T.specChange(w.h, w.d, 'm-1', 'the helper in src/impl.ts cannot do it', 'S5: Given a missing file When run Then it throws')
  const dlg = (await w.h.board.read()).decisions.map(x => x.lines.join(' ')).join(' '); assert.match(dlg, /new scenario wording: S5: Given a missing file/)
  await T.resolveSpec(w.h, 'm-1', 'accept', 'main', 'agreed, the file case matters')
  assert.equal((await budgetOf(w.h, 'm-1')).red, 0)
  assert.equal(w.acceptance(), 'S5: Given a missing file When run Then it throws\nS6: other')   // the amended scenario is in the spec; S6 untouched
  const d = w.meta['cadre.specDecision']; assert.match(d, /^The spec change was accepted and the scenarios above are the amended ones: agreed, the file case matters\./)
  assert.doesNotMatch(d, /impl\.ts/)   // the worker's reason never reaches the tester
  assert.match(brief('tester', { id: 'm-1', title: 't', type: 'test', decisions: [d] }), /Decided \(apply it to the tests\)\nThe spec change was accepted/)
})
test('a spec_change scenario must be one "S<n>: …" line, refused at report time; a malformed one that got stored is never written into the spec', async () => {
  const w = world({ acceptance: 'S5: Given a When b Then c' }), { wt, view } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  await w.h.board.update(s => ({ ...s, tasks: s.tasks.map(t => ({ ...t, state: 'active', step: 'worker' })) }))
  await w.h.bind.update(b => ({ ...b, ag1: { taskId: 'm-1', role: 'worker', step: 'worker', worktree: wt, sessionId: 's', ctxTokens: 0, startedAt: 0 } }))
  const rep = scenario => ({ role: 'worker', outcome: 'spec_change', summary: 's', reason: 'r', scenario })
  for (const bad of ['foo: bar', 'Given x: when y', 'S5: Given a\nS6: Given injected', 'S5:']) {
    await assert.rejects(CL.report(w.h, w.d, 'ag1', rep(bad)), /scenario: expected one line "S<n>: Given … When … Then …"/)
    assert.equal((await w.h.board.read()).tasks[0].state, 'active'); assert.equal(w.meta['cadre.specScenario'], undefined)   // nothing was written
  }
  await CL.report(w.h, w.d, 'ag1', rep('S5: Given a When b Then d')); assert.equal(w.meta['cadre.specScenario'], 'S5: Given a When b Then d')
  w.meta['cadre.specScenario'] = 'foo: bar\nS9: injected'; await T.resolveSpec(w.h, 'm-1', 'accept')   // the guard in resolveSpec: no write
  assert.equal(w.acceptance(), 'S5: Given a When b Then c')
})
test('spec_change accept keeps the install commit (chore(deps)) and drops the worker\'s own commits', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'wip(m-1): checkpoint')
  writeFileSync(join(wt, 'package.txt'), 'six==1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'chore(deps): add six')
  writeFileSync(join(wt, 'src/more.ts'), 'export const M = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'feat: more')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(existsSync(join(wt, 'package.txt')), true); assert.equal(existsSync(join(wt, 'src/impl.ts')), false); assert.equal(existsSync(join(wt, 'src/more.ts')), false)
  assert.match(sh(wt, 'log', '--format=%s', `${spec}..HEAD`), /^chore\(deps\): add six$/); assert.equal(sh(wt, 'status', '--porcelain'), '')
})
test('spec_change accept with two install commits keeps both, in order', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  for (const [f, m] of [['package.txt', 'chore(deps): add six'], ['src/impl.ts', 'feat: impl'], ['lock.txt', 'chore(deps): lock six']]) { writeFileSync(join(wt, f), `${f}\n`); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', m) }
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(sh(wt, 'log', '--reverse', '--format=%s', `${spec}..HEAD`), 'chore(deps): add six\nchore(deps): lock six'); assert.equal(existsSync(join(wt, 'src/impl.ts')), false)
})
test('spec_change accept whose install commit conflicts puts the worktree back exactly: the task stays blocked, "try again"', async () => {
  const w = world(); sh(w.root, 'checkout', '-q', 'epic/e1-x'); writeFileSync(join(w.root, 'package.txt'), 'x\n'); sh(w.root, 'add', '-A'); sh(w.root, 'commit', '-qm', 'manifest'); sh(w.root, 'checkout', '-q', 'dev')
  const { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  writeFileSync(join(wt, 'package.txt'), 'six\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'chore(deps): add six')
  sh(w.root, 'checkout', '-q', 'epic/e1-x'); writeFileSync(join(w.root, 'package.txt'), 'tip\n'); sh(w.root, 'add', '-A'); sh(w.root, 'commit', '-qm', 'plan tip'); const tip = sh(w.root, 'rev-parse', 'HEAD'); sh(w.root, 'checkout', '-q', 'dev')
  try { sh(wt, 'merge', '--no-ff', '--no-edit', '-q', tip) } catch {}; writeFileSync(join(wt, 'package.txt'), 'six+tip\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'merge the plan tip'); w.meta['cadre.base'] = tip
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'feat: impl'); const pre = sh(wt, 'rev-parse', 'HEAD')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); const r = await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.match(r.text, /answer again/); assert.doesNotMatch(r.text, /accepted/)
  assert.equal(sh(wt, 'rev-parse', 'HEAD'), pre); assert.equal(sh(wt, 'status', '--porcelain'), ''); assert.equal(existsSync(join(wt, 'src/impl.ts')), true)
  assert.equal((await w.h.board.read()).tasks[0].state, 'blocked'); assert.equal(w.meta['cadre.blocked'], 'spec_change')
})
test('spec_change accept: the worker commits are dropped, so the amended red is measured on the spec commit tree', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'worker')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(sh(wt, 'rev-parse', 'HEAD'), spec); assert.equal(existsSync(join(wt, 'src/impl.ts')), false)
})

test('spec_change accept keeps a rework merge, drops the worker commit; a failed reset leaves the task blocked', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  sh(w.root, 'checkout', '-q', 'epic/e1-x'); writeFileSync(join(w.root, 'landed.txt'), 'x'); sh(w.root, 'add', '-A'); sh(w.root, 'commit', '-qm', 'landed'); const tip = sh(w.root, 'rev-parse', 'HEAD')
  sh(wt, 'merge', '--no-ff', '--no-edit', '-q', tip); w.meta['cadre.base'] = tip   // core/rebase's rework merge, after the spec
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'worker')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec')
  w.meta['cadre.worktree'] = join(wt, 'nope'); const bad = await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.doesNotMatch(bad.text, /accepted/); assert.equal((await w.h.board.read()).tasks[0].state, 'blocked')
  w.meta['cadre.worktree'] = wt; await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(existsSync(join(wt, 'src/impl.ts')), false); assert.equal(existsSync(join(wt, 'landed.txt')), true)
  sh(wt, 'merge-base', '--is-ancestor', tip, 'HEAD'); sh(wt, 'merge-base', '--is-ancestor', spec, 'HEAD')
})

test('a refused red leaves no copy-in commit; the identical retry reaches the gate again', async () => {
  const w = world(), files = { 'test/s.json': tc('a', 'passed') }, { wt, view, res } = await tester(w, files, ['a']), pre = sh(wt, 'rev-parse', 'HEAD')
  assert.equal(res.ok, false); assert.match(res.why, /pass at the spec commit/); assert.equal(sh(wt, 'rev-parse', 'HEAD'), pre); assert.equal(existsSync(join(wt, 'test/s.json')), false); assert.equal(sh(wt, 'status', '--porcelain'), '')
  const again = await T.testerDone(w.h, w.d, await mkTask(w), wt, view, [{ path: 'test/s.json', name: 'a' }])
  assert.match(again.why, /pass at the spec commit/)   // not "identical to the base; nothing to lock"
})

// ---- the red loop (live 0.12.1, generic names): a refused red never traps the tester; the task blocks once with one dialog naming the check ----
const CL = await import('../../core/close.ts')
const { budgetOf } = await import('../../core/lifecycle.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
const bindTester = async (w, wt, view) => { w.meta['cadre.worktree'] = wt; await w.h.bind.update(b => ({ ...b, ag1: { taskId: 'm-1', role: 'tester', step: 'tester', worktree: view, sessionId: 's', ctxTokens: 0, startedAt: 0 } })) }
const rep = { role: 'tester', outcome: 'done', summary: 's', tests: [{ path: 'test/s.json', name: 'a' }] }

test('a test task (tester -> reviewer): after the accepted tests no owner is left, so the reviewer is spawnable', async () => {
  const { spawnable } = await import('../../core/render.ts')
  const w = world({ type: 'test' }), wt = await worktree(w), view = await V.buildView(w.h, w.d, await mkTask(w), wt)
  mkdirSync(join(view, 'test'), { recursive: true }); writeFileSync(join(view, 'test/s.json'), tc('a', 'passed')); w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: 'test', state: 'active', step: 'tester', owner: 'a' })] }))   // as the claim left it
  await bindTester(w, wt, view); await CL.report(w.h, w.d, 'ag1', rep)
  const t = (await w.h.board.read()).tasks[0]; assert.equal(t.state, 'review'); assert.equal(t.step, 'reviewer'); assert.equal(t.owner, undefined); assert.match(t.card, /tester → reviewer.*NEW agent for the reviewer step/)   // the card main reads names the real next step
  assert.deepEqual(spawnable(await w.h.board.read(), {}).map(x => x.role), ['reviewer'])
})
test('a package with no test check: red would run only "compile" and call it green; the first tester report blocks the task with one dialog naming the missing check', async () => {
  const w = world({ pkg: { checks: { compile: ['true'] }, verify: undefined, tdd: { paths: ['test/**'] } } }), { wt, view, res } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a'])
  assert.equal(res.ok, false); assert.equal(res.setup, true); assert.match(res.why, /no test check/)
  await bindTester(w, wt, view)
  assert.match(await CL.report(w.h, w.d, 'ag1', rep), /waits for the user/)   // not thrown: the agent may end
  const s = await w.h.board.read(); assert.equal(s.tasks[0].state, 'blocked'); assert.deepEqual(s.tasks[0].flags, ['red'])
  assert.equal(s.decisions.length, 1); assert.equal(s.decisions[0].id, 'flag:m-1:red'); assert.match(s.decisions[0].lines.join('\n'), /no test check[\s\S]*compile/)
})

test('settings: limits.testerRounds 2: the 2nd refused red blocks the task with one dialog naming the check; Retry sends it back to the tester with fresh rounds', async () => {
  const w = world(); w.d.cfg.limits.testerRounds = 2
  const { wt, view } = await tester(w, { 'test/s.json': tc('a', 'passed') }, ['a']); await bindTester(w, wt, view)
  await assert.rejects(CL.report(w.h, w.d, 'ag1', rep), /red gate refused: the tests pass at the spec commit/)
  assert.equal((await w.h.board.read()).tasks[0].state, 'active')
  assert.match(await CL.report(w.h, w.d, 'ag1', rep), /waits for the user/)
  const s = await w.h.board.read(); assert.equal(s.tasks[0].state, 'blocked'); assert.equal(s.decisions.length, 1)
  assert.match(s.decisions[0].lines.join('\n'), /check "test"[\s\S]*pass at the spec commit/); assert.deepEqual(s.decisions[0].options.map(o => o.label), ['Retry', 'Cancel task'])
  assert.match((await ROUTES.resolve(w.h, { args: ['m-1', 'retry'] })).text, /back to the tester/)
  const t = (await w.h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step, t.flags], ['active', 'tester', []]); assert.equal((await budgetOf(w.h, 'm-1')).red, 0)
})

// ---- the tester proposes its test command, cadre runs it (ADR 0023): a node:test fixture, real git, the same sandbox as checks ----
delete process.env.NODE_TEST_CONTEXT   // this file runs under node --test; a nested node --test would report to it and exit 0
const NT = (body, imp = '') => `import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { readFileSync } from 'node:fs'\n${imp}\ntest('S1 login ok', () => { ${body} })\n`
const LOGIN = NT(`assert.equal(readFileSync(new URL('../src/login.ts', import.meta.url), 'utf8').includes('LOGIN_OK'), true)`)
const JUNIT = { command: ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=$CADRE_JUNIT', 'test/login.test.mjs'], junit: '$CADRE_JUNIT' }
const noCheck = over => { const w = world({ pkg: { checks: { compile: ['true'] }, verify: undefined, tdd: { paths: ['test/**'] } }, ...over }); w.store.record = async () => 'd-0'; return w }
const testerRun = async (w, files, run, names = ['S1 login ok']) => {
  const wt = await worktree(w), task = await mkTask(w), view = await V.buildView(w.h, w.d, task, wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: task.type, state: 'active', step: 'tester' })] }))
  w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  return { wt, view, res: await T.testerDone(w.h, w.d, await mkTask(w), wt, view, names.map(n => ({ path: 'test/login.test.mjs', name: n })), undefined, run) }
}
const recorded = w => { w.records = []; w.store.record = async (kind, title, body, link) => { w.records.push({ kind, title, body, link }); return 'd-1' } }

test('red via the tester command + JUnit (every named test failed); no test check: the command, minus its own file, becomes the test check once, recorded; green runs it', async () => {
  const w = noCheck(); recorded(w)
  const { wt, res } = await testerRun(w, { 'test/login.test.mjs': LOGIN }, JUNIT)
  assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/); assert.deepEqual(JSON.parse(w.meta['cadre.specTests']), ['test.S1 login ok'])
  assert.deepEqual(JSON.parse(w.meta['cadre.testRun']), JUNIT)
  const cfg = JSON.parse(readFileSync(join(w.root, '.cadre/config.json'), 'utf8')), p = cfg.units[0]
  assert.deepEqual(p.checks.test, ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=/tmp/cadre/junit.xml']); assert.equal(p.tdd.report, '/tmp/cadre/junit.xml'); assert.equal(p.testBy, 'tester')
  assert.deepEqual(w.records.map(r => [r.kind, r.title, r.link]), [['decision', 'test check set from the tester: node --test --test-reporter=junit --test-reporter-destination=/tmp/cadre/junit.xml', 'm-1']])
  const ev = Object.values((await w.h.events.read()).epics).flat().find(e => e.type === 'drive.decided'); assert.equal(ev.data.kind, 'setting'); assert.equal(ev.actor, 'mod')
  assert.match((await T.green(w.h, w.d, await mkTask(w), wt)).why, /spec tests fail/)   // nothing implemented yet
  writeFileSync(join(wt, 'src/login.ts'), 'export const LOGIN_OK = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'impl')
  const g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /green ✓ spec tests\+test/)
  // a second task of the package: the check exists now, nothing is adopted again
  const w2 = noCheck(); recorded(w2); w2.d.cfg.units[0].checks.test = p.checks.test
  assert.ok((await testerRun(w2, { 'test/login.test.mjs': LOGIN }, JUNIT)).res.ok); assert.equal(w2.records.length, 0); assert.equal(existsSync(join(w2.root, '.cadre/config.json')), false)
})

test('red via the tester command without JUnit: the output must name each test failing', async () => {
  let w = noCheck(), r = (await testerRun(w, { 'test/login.test.mjs': LOGIN }, { command: ['node', '--test', 'test/login.test.mjs'] })).res
  assert.ok(r.ok, r.why); assert.match(r.card, /red ✓ exit=1, 1 failing/)
  w = noCheck(); r = (await testerRun(w, { 'test/login.test.mjs': LOGIN }, { command: ['node', '--test', 'test/login.test.mjs'] }, ['S1 login ok', 'S2 ghost'])).res
  assert.equal(r.ok, false); assert.match(r.why, /does not show test "S2 ghost" failing/)
})

test('red refused: a collection error is named back to the tester ("the tests did not run: <line>", no host path); passing tests are refused', async () => {
  const sym = { design: JSON.stringify({ symbols: [{ name: 'signin', kind: 'function', status: 'new' }] }) }, imp = f => NT('assert.ok(x)', `import { x } from '../src/${f}.mjs'`)
  const ok = (await testerRun(noCheck(sym), { 'test/login.test.mjs': imp('signin') }, { command: ['node', '--test', 'test/login.test.mjs'] })).res   // importing a new contract symbol (no skeleton) is the right red
  assert.ok(ok.ok, ok.why); assert.match(ok.card, /red ✓ exit=1: .*signin/)
  const w = noCheck(sym), bad = imp('nope')
  const { wt, view, res } = await testerRun(w, { 'test/login.test.mjs': bad }, { command: ['node', '--test', 'test/login.test.mjs'] })
  assert.equal(res.ok, false); assert.equal(res.setup, undefined); assert.match(res.why, /^the tests did not run: .*Cannot find module 'nope\.mjs'/); assert.doesNotMatch(res.why, /\/home\/|\/tmp\//)
  assert.equal(w.meta['cadre.specCommit'], undefined)   // copy-in undone
  await bindTester(w, wt, view)   // through the report: a refusal the tester may retry, bounded by limits.testerRounds
  await assert.rejects(CL.report(w.h, w.d, 'ag1', { ...rep, tests: [{ path: 'test/login.test.mjs', name: 'S1 login ok' }], run: { command: ['node', '--test', 'test/login.test.mjs'] } }), /red gate refused: the tests did not run/)
  const p = noCheck(), r = (await testerRun(p, { 'test/login.test.mjs': NT('assert.ok(true)') }, JUNIT)).res
  assert.equal(r.ok, false); assert.match(r.why, /pass at the spec commit/); assert.equal(existsSync(join(p.root, '.cadre/config.json')), false)   // nothing adopted from a refused red
})

test('red: a runner that is not installed blocks at once with one dialog naming it; no tester round', async () => {
  const w = noCheck(), { wt, view, res } = await testerRun(w, { 'test/login.test.mjs': LOGIN }, { command: ['node', '-e', 'console.error("sh: my_project_runner: command not found"); process.exit(127)'] })
  assert.equal(res.ok, false); assert.equal(res.setup, true); assert.match(res.why, /missing runner, exit=127/); assert.equal(w.meta['cadre.specCommit'], undefined)
  await bindTester(w, wt, view)
  assert.match(await CL.report(w.h, w.d, 'ag1', { ...rep, tests: [{ path: 'test/login.test.mjs', name: 'S1 login ok' }], run: { command: ['node', '-e', 'process.exit(127)'] } }), /waits for the user/)
  const s = await w.h.board.read(); assert.equal(s.tasks[0].state, 'blocked'); assert.equal(s.decisions.length, 1); assert.match(s.decisions[0].lines.join('\n'), /missing runner/)
})

test('red: a package that is not installed goes back to the tester with the way to ask for it; past the rounds it blocks with one dialog', async () => {
  const cmd = { command: ['node', '-e', 'console.error("Error: Cannot find module \'left-pad\'"); process.exit(1)'] }
  const w = noCheck(); w.d.cfg.limits.testerRounds = 2; const { wt, view, res } = await testerRun(w, { 'test/login.test.mjs': LOGIN }, cmd)
  assert.equal(res.ok, false); assert.equal(res.setup, true); assert.match(res.why, /missing module.*left-pad/)
  await bindTester(w, wt, view); const again = { ...rep, tests: [{ path: 'test/login.test.mjs', name: 'S1 login ok' }], run: cmd }
  await assert.rejects(CL.report(w.h, w.d, 'ag1', again), e => /red gate refused: a module the tests need is not installed[\s\S]*left-pad[\s\S]*report outcome "request" with request \{"helper":"setup"/.test(e.message))
  assert.equal((await w.h.board.read()).tasks[0].state, 'active', 'a tester round, not a block')
  assert.match(await CL.report(w.h, w.d, 'ag1', again), /waits for the user/)
  const s = await w.h.board.read(); assert.equal(s.tasks[0].state, 'blocked'); assert.equal(s.decisions.length, 1); assert.match(s.decisions[0].lines.join('\n'), /missing module/)
})

test('settings: tdd.testerCommand.use off: the command is ignored; with no test check the task blocks with the setup dialog', async () => {
  const w = noCheck(); w.d.cfg.tdd = { ...w.d.cfg.tdd, testerCommand: { use: false, adopt: true } }
  const r = (await testerRun(w, { 'test/login.test.mjs': LOGIN }, JUNIT)).res
  assert.equal(r.ok, false); assert.equal(r.setup, true); assert.match(r.why, /no test check/)
})

test('settings: tdd.testerCommand.adopt off: red runs the command, nothing is written or recorded', async () => {
  const w = noCheck(); recorded(w); w.d.cfg.tdd = { ...w.d.cfg.tdd, testerCommand: { use: true, adopt: false } }
  assert.ok((await testerRun(w, { 'test/login.test.mjs': LOGIN }, JUNIT)).res.ok); assert.equal(w.records.length, 0); assert.equal(existsSync(join(w.root, '.cadre/config.json')), false)
})

test('settings: tdd.collectErrors: a project pattern turns a line into "the tests did not run"', async () => {
  const body = NT("console.log('DB UNREACHABLE'); assert.fail('x')")
  let w = noCheck(), r = (await testerRun(w, { 'test/login.test.mjs': body }, { command: ['node', '--test', 'test/login.test.mjs'] })).res
  assert.ok(r.ok, r.why)
  w = noCheck(); w.d.cfg.tdd = { ...w.d.cfg.tdd, collectErrors: ['DB UNREACHABLE'] }; r = (await testerRun(w, { 'test/login.test.mjs': body }, { command: ['node', '--test', 'test/login.test.mjs'] })).res
  assert.equal(r.ok, false); assert.match(r.why, /the tests did not run: .*DB UNREACHABLE/)
})
