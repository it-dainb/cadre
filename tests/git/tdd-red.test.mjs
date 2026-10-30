// Dev-only: TDD red gate against real git (split from tdd.test.mjs to stay under the 60 s wall; helpers in tests/dev/tdd-world.mjs).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { G, V, T, snap, fakeHost, defaults, repoKeyOf, policyOf, run, sh, base, RUN, world, mkTask, worktree, tc, tester } = await import('../dev/tdd-world.mjs')

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

test('review.coverage.enforce: a tester report with no test declaring a scenario id is refused and the copy-in undone; declaring it passes (the name carries nothing)', async () => {
  let w = world({ cover: true, acceptance: 'S1: Given a When b Then c\nS2: Given a When b Then d' }), r = await tester(w, { 'test/s.json': tc('S1 login ok', 'failure') }, [{ name: 'S1 login ok', ids: ['S1'] }])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /no test declares S2: write a test for every scenario/); assert.equal(w.meta['cadre.specCommit'], undefined); assert.equal(existsSync(join(r.wt, 'test/s.json')), false)
  w = world({ cover: true, acceptance: 'S1: Given a When b Then c\nS2: Given a When b Then d' }); r = await tester(w, { 'test/s.json': tc('S1 login ok', 'failure'), 'test/t.json': tc('test_s2_rejects', 'failure') }, [{ name: 'S1 login ok', ids: ['S1'] }, { name: 'test_s2_rejects', ids: ['S2'] }])
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

test('red refused: tests pass; a declared test missing from the results; skips alone are no red', async () => {
  for (const [files, tests, why] of [
    [{ 'test/s.json': tc('a', 'passed') }, ['a'], /pass at the spec commit/],
    [{ 'test/s.json': tc('a', 'failure') }, ['a', 'ghost'], /not run: ghost/],
    [{ 'test/s.json': tc('a', 'passed'), 'test/t.json': tc('b', 'skipped') }, ['a', 'b'], /no test failed/],
  ]) { const w = world(), { res } = await tester(w, files, tests); assert.equal(res.ok, false); assert.match(res.why, why); assert.equal((await w.h.board.read()).tasks[0].step, 'tester') }
})

test('a skipped test is ignored for the verdict and listed in the card (the verdict table: skip is neither red nor green)', async () => {
  const w = world(), { res } = await tester(w, { 'test/s.json': tc('a', 'failure', 'x'), 'test/t.json': tc('b', 'skipped') }, ['a'])
  assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/); assert.match(res.card, /skipped: s\.b/)
})
test('B1: an <error> result is bad ("make it compile and run"), even for an import of a new contract symbol; a skeleton changes nothing', async () => {
  const d = JSON.stringify({ symbols: [{ name: 'login', status: 'new' }, { name: 'logout', status: 'unchanged' }] })
  for (const [over, text] of [[{ design: d }, 'ReferenceError: login is not defined'], [{ design: d }, 'ReferenceError: logout is not defined'], [{ design: d, pkg: { tdd: { paths: ['test/**'], skeleton: ['true'] } } }, 'SyntaxError: unexpected token']]) {
    const w = world(over), r = (await tester(w, { 'test/s.json': tc('a', 'error', text), 'test/t.json': tc('b', 'failure') }, ['a', 'b'])).res
    assert.equal(r.ok, false); assert.equal(r.setup, undefined); assert.match(r.why, /errored instead of failing: s\.a; make it compile and run/); assert.equal(w.meta['cadre.specCommit'], undefined)   // a tester round, copy-in undone
  }
})

test('test type has no red: its tests must pass instead; copy-in sets sourceCommit', async () => {
  let w = world({ type: 'test' }); let r = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a'])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /the check fails \(exit=1\)/)
  w = world({ type: 'test' }); r = await tester(w, { 'test/s.json': tc('a', 'passed') }, ['a'])
  assert.ok(r.res.ok, r.res.why); assert.equal(w.meta['cadre.sourceCommit'], w.meta['cadre.specCommit']); assert.equal((await w.h.board.read()).tasks[0].step, 'reviewer')
})

test('green: spec tests must be passed (skipped != passed); knownRed runs but never gates; a failing verify refuses', async () => {
  const w = world({ pkg: { knownRed: ['knownbad'] } }), { wt } = await tester(w, { 'test/s.json': tc('login ok', 'failure') }, ['login ok'])
  let g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false); assert.match(g.why, /the check fails/)   // still red
  writeFileSync(join(wt, 'test/s.json'), tc('login ok', 'skipped')); writeFileSync(join(wt, 'test/old.json'), tc('old', 'passed'))
  g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false); assert.match(g.why, /the check fails/)   // the fake check exits 1 on a skipped case: not passed
  writeFileSync(join(wt, 'test/s.json'), tc('login ok', 'passed'))
  g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /knownRed knownbad=1/)   // knownRed exit 1 does not gate
  const ran = Object.values((await w.h.events.read()).epics).flat().filter(x => x.type === 'check.ran')   // UI log: phase / failing / secs
  assert.ok(ran.some(x => x.data.phase === 'red' && x.data.ok === true && x.data.failing === 1 && typeof x.data.secs === 'number'), JSON.stringify(ran)); assert.ok(ran.some(x => x.data.phase === 'green' && x.data.ok === true))
  // a spec test absent from the report is not passed either
  const w2 = world({ pkg: { verify: ['v2'], checks: { test: ['node', 'run.mjs'], v2: ['true'] }, tdd: { check: 'test', paths: ['test/**'] } } }); const t2 = await tester(w2, { 'test/s.json': tc('login ok', 'failure') }, ['login ok'])
  const g2 = await T.green(w2.h, w2.d, await mkTask(w2), t2.wt); assert.equal(g2.ok, false); assert.match(g2.why, /spec test\(s\) not passed: login ok/)
})

test('failure baseline: a test red when the plan started does not fail the green gate; a NEW failing test does; measured once per plan', async () => {
  const w = world(); writeFileSync(join(w.root, 'test/old.json'), tc('old', 'failure')); sh(w.root, 'commit', '-qam', 'old is red'); sh(w.root, 'branch', '-f', 'epic/e1-x', 'dev')
  await w.h.board.update(s => ({ ...s, epic: 'e1', plan: { id: 'e1', slug: 'x', state: 'approved', epicBranch: 'epic/e1-x' } }))
  const wt = await worktree(w)
  let g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /test fails only where it failed before the plan/)
  assert.deepEqual(JSON.parse(w.meta['cadre.baseline']), { '.:test': { exit: 1, fails: ['s.old'] } })
  writeFileSync(join(wt, 'test/new.json'), tc('new', 'failure')); g = await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(g.ok, false); assert.match(g.why, /the check fails/)
  const n = w.meta['cadre.baseline']; await T.green(w.h, w.d, await mkTask(w), wt); assert.equal(w.meta['cadre.baseline'], n)   // kept: not measured again
})
// ---- the red loop (live 0.12.1, generic names): a refused red never traps the tester; the task blocks once with one dialog naming the check ----
const CL = await import('../../core/close.ts')
const { budgetOf } = await import('../../core/lifecycle.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
const bindTester = async (w, wt, view) => { w.meta['cadre.worktree'] = wt; await w.h.bind.update(b => ({ ...b, ag1: { taskId: 'm-1', role: 'tester', step: 'tester', worktree: view, sessionId: 's', ctxTokens: 0, startedAt: 0 } })) }
const rep = { role: 'tester', outcome: 'done', summary: 's', tests: [{ path: 'test/s.json', name: 'a', ids: [] }] }

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
  const s = await w.h.board.read(); assert.equal(s.tasks[0].state, 'blocked'); assert.deepEqual(s.tasks[0].flags, ['gate-error'])
  assert.equal(s.decisions.length, 1); assert.equal(s.decisions[0].id, 'flag:m-1:gate-error'); assert.match(s.decisions[0].lines.join('\n'), /no test check[\s\S]*compile/)
})

test('onFail.retry 2 on the red step: the 2nd refused red blocks the task with one dialog naming the check; Retry sends it back to the tester with fresh rounds', async () => {
  const w = world(), P = await import('../../core/pipeline.ts'), D = await import('../../profiles/default.ts')
  P.setProfile({ ...P.active(), steps: { ...D.profile.steps, red: { ...D.profile.steps.red, onFail: { retry: 2, then: 'human' } } } })
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
const JUNIT = { command: ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=$CADRE_JUNIT', 'test/login.test.mjs'] }
const noCheck = over => { const w = world({ pkg: { checks: { compile: ['true'] }, verify: undefined, tdd: { paths: ['test/**'] } }, ...over }); w.store.record = async () => 'd-0'; return w }
const testerRun = async (w, files, run, names = ['S1 login ok']) => {
  const wt = await worktree(w), task = await mkTask(w), view = await V.buildView(w.h, w.d, task, wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: task.type, state: 'active', step: 'tester' })] }))
  w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  return { wt, view, res: await T.testerDone(w.h, w.d, await mkTask(w), wt, view, names.map(n => ({ path: 'test/login.test.mjs', name: n, ids: [] })), undefined, run) }
}
const recorded = w => { w.records = []; w.store.record = async (kind, title, body, link) => { w.records.push({ kind, title, body, link }); return 'd-1' } }

test('red via the tester command + JUnit (every named test failed); no test check: the command, minus its own file, becomes the test check once, recorded; green runs it', async () => {
  const w = noCheck(); recorded(w)
  const { wt, res } = await testerRun(w, { 'test/login.test.mjs': LOGIN }, JUNIT)
  assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/); assert.deepEqual(JSON.parse(w.meta['cadre.specTests']), [{ name: 'S1 login ok', ids: [] }]); assert.equal(w.meta['cadre.coverVia'], 'results')
  assert.deepEqual(JSON.parse(w.meta['cadre.testRun']), JUNIT)
  const cfg = JSON.parse(readFileSync(join(w.root, '.cadre/config.json'), 'utf8')), p = cfg.units[0]
  assert.deepEqual(p.checks.test, ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=$CADRE_JUNIT']); assert.equal(p.tdd.report, undefined); assert.equal(p.testBy, 'tester')   // B19: the literal $CADRE_JUNIT, no report path
  assert.deepEqual(w.records.map(r => [r.kind, r.title, r.link]), [['decision', 'test check set from the tester: node --test --test-reporter=junit --test-reporter-destination=$CADRE_JUNIT', 'm-1']])
  assert.deepEqual(await w.h.store.get(`cadre:${repoKeyOf(w.root)}:junit:.`), { ok: true, argv: p.checks.test })   // the probe is re-recorded yes
  const ev = Object.values((await w.h.events.read()).epics).flat().find(e => e.type === 'drive.decided'); assert.equal(ev.data.kind, 'setting'); assert.equal(ev.actor, 'mod')
  assert.match((await T.green(w.h, w.d, await mkTask(w), wt)).why, /spec tests fail/)   // nothing implemented yet
  writeFileSync(join(wt, 'src/login.ts'), 'export const LOGIN_OK = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'impl')
  const g = await T.green(w.h, w.d, await mkTask(w), wt); assert.ok(g.ok, g.why); assert.match(g.card, /green ✓ spec tests\+test/)
  // a second task of the package: the check exists now, nothing is adopted again
  const w2 = noCheck(); recorded(w2); w2.d.cfg.units[0].checks.test = p.checks.test
  assert.ok((await testerRun(w2, { 'test/login.test.mjs': LOGIN }, JUNIT)).res.ok); assert.equal(w2.records.length, 0); assert.equal(existsSync(join(w2.root, '.cadre/config.json')), false)
})

test('B2/B19: a tester command that writes no JUnit is a gate error (a human block, not a red) with the fix line, and nothing is adopted', async () => {
  const w = noCheck(); recorded(w); const r = (await testerRun(w, { 'test/login.test.mjs': LOGIN }, { command: ['node', '--test', 'test/login.test.mjs'] }, ['S1 login ok'])).res
  assert.equal(r.ok, false); assert.equal(r.setup, true); assert.match(r.why, /make the runner write JUnit XML to \$CADRE_JUNIT/)
  assert.equal(w.records.length, 0); assert.equal(existsSync(join(w.root, '.cadre/config.json')), false)
})

test('B19: exit-only is never adopted: a command that names $CADRE_JUNIT but writes no report (a test task with no declared tests) is accepted by its exit and the unit gets no test check', async () => {
  const w = noCheck({ type: 'test' }); recorded(w)
  const r = (await testerRun(w, { 'test/login.test.mjs': NT('assert.ok(true)') }, { command: ['node', '-e', '0', '$CADRE_JUNIT'] }, [])).res
  assert.ok(r.ok, r.why); assert.equal(r.structural, undefined); assert.equal(w.records.length, 0); assert.equal(existsSync(join(w.root, '.cadre/config.json')), false); assert.equal(w.meta['cadre.coverVia'], 'report')
})

test('B1/B3: an import failure with JUnit is "not run" (a tester round, copy-in undone, no host path); without a report it is a gate error; passing tests are refused', async () => {
  const imp = f => NT('assert.ok(x)', `import { x } from '../src/${f}.mjs'`), w = noCheck()
  const { wt, view, res } = await testerRun(w, { 'test/login.test.mjs': imp('nope') }, JUNIT)
  assert.equal(res.ok, false); assert.equal(res.setup, undefined); assert.match(res.why, /not run: S1 login ok/); assert.doesNotMatch(res.why, /\/home\/|\/tmp\//)
  assert.equal(w.meta['cadre.specCommit'], undefined)   // copy-in undone
  await bindTester(w, wt, view)   // through the report: a refusal the tester may retry, bounded by limits.testerRounds
  await assert.rejects(CL.report(w.h, w.d, 'ag1', { ...rep, tests: [{ path: 'test/login.test.mjs', name: 'S1 login ok', ids: [] }], run: JUNIT }), /red gate refused: tests? not run/)
  const nj = (await testerRun(noCheck(), { 'test/login.test.mjs': imp('nope') }, { command: ['node', '--test', 'test/login.test.mjs'] })).res
  assert.equal(nj.ok, false); assert.equal(nj.setup, true)   // exit 1 with declared tests and no results: the check is broken, not the work
  const p = noCheck(), r = (await testerRun(p, { 'test/login.test.mjs': NT('assert.ok(true)') }, JUNIT)).res
  assert.equal(r.ok, false); assert.match(r.why, /pass at the spec commit/); assert.equal(existsSync(join(p.root, '.cadre/config.json')), false)   // nothing adopted from a refused red
})
