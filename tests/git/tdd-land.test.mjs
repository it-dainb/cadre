// Dev-only: spec_change and the amended red against real git (split from tdd.test.mjs; helpers in tests/dev/tdd-world.mjs).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { G, V, T, snap, fakeHost, defaults, repoKeyOf, policyOf, run, sh, base, RUN, world, mkTask, worktree, tc, tester } = await import('../dev/tdd-world.mjs')
const CL = await import('../../core/close.ts'); const { LIFECYCLE } = await import('../../core/plantools.ts')

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
const rec = (w, wt) => { w.meta['cadre.depsCommits'] = [...(w.meta['cadre.depsCommits'] ?? '').split(' ').filter(Boolean), sh(wt, 'rev-parse', 'HEAD')].join(' ') }   // what core/needs does when cadre's own install commits
test('spec_change accept keeps cadre\'s install commit (on record) and drops the worker\'s own commits, even one titled chore(deps)', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'wip(m-1): checkpoint')
  writeFileSync(join(wt, 'package.txt'), 'six==1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'chore(deps): add six'); rec(w, wt)
  writeFileSync(join(wt, 'worker.txt'), 'w\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'chore(deps): the worker names its own commit like this')   // not on record: not carried
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(existsSync(join(wt, 'package.txt')), true); assert.equal(existsSync(join(wt, 'src/impl.ts')), false); assert.equal(existsSync(join(wt, 'worker.txt')), false)
  assert.match(sh(wt, 'log', '--format=%s', `${spec}..HEAD`), /^chore\(deps\): add six$/); assert.equal(sh(wt, 'status', '--porcelain'), '')
  assert.equal(w.meta['cadre.depsCommits'], sh(wt, 'rev-parse', 'HEAD'))   // the record follows the re-applied commit
})
test('spec_change accept with two install commits keeps both, in order', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']), spec = w.meta['cadre.specCommit']; w.meta['cadre.worktree'] = wt
  for (const [f, m, r] of [['package.txt', 'chore(deps): add six', 1], ['src/impl.ts', 'feat: impl', 0], ['lock.txt', 'chore(deps): lock six', 1]]) { writeFileSync(join(wt, f), `${f}\n`); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', m); if (r) rec(w, wt) }
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(sh(wt, 'log', '--reverse', '--format=%s', `${spec}..HEAD`), 'chore(deps): add six\nchore(deps): lock six'); assert.equal(existsSync(join(wt, 'src/impl.ts')), false)
})
test('spec_change accept: an install commit that conflicts with the plan tip is dropped, never forced: the tip\'s dependency A is kept, the install is asked again', async () => {
  const w = world(), put = (d, f, c) => { writeFileSync(join(d, f), c); sh(d, 'add', '-A') }
  sh(w.root, 'checkout', '-q', 'epic/e1-x'); put(w.root, 'uv.lock', 'lock0\n'); put(w.root, 'pyproject.toml', 'deps=[]\n'); sh(w.root, 'commit', '-qm', 'manifest'); sh(w.root, 'checkout', '-q', 'dev')
  const { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  put(wt, 'uv.lock', 'lock0+B\n'); put(wt, 'pyproject.toml', 'deps=["B"]\n'); sh(wt, 'commit', '-qm', 'chore(deps): add B'); rec(w, wt)
  sh(w.root, 'checkout', '-q', 'epic/e1-x'); put(w.root, 'uv.lock', 'lock0+A\n'); put(w.root, 'pyproject.toml', 'deps=["A"]\n'); sh(w.root, 'commit', '-qm', 'plan tip adds A'); w.meta['cadre.base'] = sh(w.root, 'rev-parse', 'HEAD'); sh(w.root, 'checkout', '-q', 'dev')
  put(wt, 'src/impl.ts', 'export const IMPL = 1\n'); sh(wt, 'commit', '-qm', 'feat: impl')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); const r = await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.match(r.text, /accepted/); assert.equal(readFileSync(join(wt, 'pyproject.toml'), 'utf8'), 'deps=["A"]\n'); assert.equal(readFileSync(join(wt, 'uv.lock'), 'utf8'), 'lock0+A\n')
  assert.equal(sh(wt, 'status', '--porcelain'), ''); assert.equal(existsSync(join(wt, 'src/impl.ts')), false); assert.equal(w.meta['cadre.depsCommits'], '')   // B's commit dropped and off the record; nothing blocks a new setup request
})
test('spec_change accept whose reset conflicts (the plan tip rewrote the spec file) puts the worktree back and asks once more with no Accept; Reject clears it; yolo main cannot loop it', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  sh(w.root, 'checkout', '-q', 'epic/e1-x'); mkdirSync(join(w.root, 'test'), { recursive: true }); writeFileSync(join(w.root, 'test/s.json'), 'other\n'); sh(w.root, 'add', '-A'); sh(w.root, 'commit', '-qm', 'plan tip owns the file'); w.meta['cadre.base'] = sh(w.root, 'rev-parse', 'HEAD'); sh(w.root, 'checkout', '-q', 'dev')
  writeFileSync(join(wt, 'src/impl.ts'), 'export const IMPL = 1\n'); sh(wt, 'add', '-A'); sh(wt, 'commit', '-qm', 'feat: impl'); const pre = sh(wt, 'rev-parse', 'HEAD')
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec')
  const card = async () => ((await w.h.board.read()).decisions ?? []).find(x => x.id === 'flag:m-1:spec_change')
  assert.deepEqual((await card()).options.map(o => o.verb), ['accept', 'reject'])   // before: Accept offered
  const r = await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.match(r.text, /reject, or cancel/); assert.doesNotMatch(r.text, /answer again|accepted/)
  assert.equal(sh(wt, 'rev-parse', 'HEAD'), pre); assert.equal(sh(wt, 'status', '--porcelain'), '')
  assert.equal((await w.h.board.read()).tasks[0].state, 'blocked'); assert.equal(w.meta['cadre.blocked'], 'spec_change'); assert.equal(w.meta['cadre.specReset'], 'conflict')
  assert.deepEqual((await card()).options.map(o => o.verb), ['reject', 'cancel'])   // no Accept on the new card
  assert.match((await T.resolveSpec(w.h, 'm-1', 'accept')).text, /reject instead/)   // a second Accept is refused without touching git
  await w.h.board.update(b => ({ ...b, drive: { ...b.drive, on: true, stopped: false, mode: 'yolo' } }))
  assert.match(await LIFECYCLE.decision(w.h, 'm-1', { metadata: { decision: 'accept: again' } }), /awaits a spec change decision/)   // yolo main is sent to the human
  await w.h.board.update(b => ({ ...b, drive: { ...b.drive, on: false } }))
  assert.match((await T.resolveSpec(w.h, 'm-1', 'reject')).text, /rejected/); assert.equal(w.meta['cadre.specReset'], '')
})
test('spec_change accept while git is busy is the transient case: "answer again", no marker, the card still offers Accept', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await w.h.git.update(g => ({ ...g, busy: true }))
  const r = await T.resolveSpec(w.h, 'm-1', 'accept'); assert.match(r.text, /answer again/); assert.equal(w.meta['cadre.specReset'] ?? '', '')
  assert.deepEqual((((await w.h.board.read()).decisions ?? []).find(x => x.id === 'flag:m-1:spec_change')).options.map(o => o.verb), ['accept', 'reject'])
})
const reTester = async (w, wt, files, names) => {
  const view = await V.buildView(w.h, w.d, await mkTask(w), wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  return T.testerDone(w.h, w.d, await mkTask(w), wt, view, names.map(n => ({ path: 'test/s2.json', name: n })))
}
// ---- the amended red: after a spec_change Accept only the tests named after the amended scenario must fail; the others must run and may pass ----
const amended = async (files, names, wrote = { 'test/s.json': tc('S1 dep declared', 'failure') }) => {
  const w = world({ acceptance: 'S1: Given a When b Then c\nS4: Given x When y Then z' }), { wt } = await tester(w, wrote, Object.values(wrote).map(c => JSON.parse(c).name)); w.meta['cadre.worktree'] = wt
  await T.specChange(w.h, w.d, 'm-1', 'S4 was missing', 'S4: Given soon When parsed Then NaN'); await T.resolveSpec(w.h, 'm-1', 'accept'); assert.equal(w.meta['cadre.redOnly'], 'S4')
  return { w, wt, g: await reTester(w, wt, files, names) }
}
test('amended red: an unchanged test that passes and an amended S4 that fails is accepted, and the next red is strict again', async () => {
  const { w, g } = await amended({ 'test/s.json': tc('S1 dep declared', 'passed'), 'test/s2.json': tc('S4 soon is NaN', 'failure') }, ['S1 dep declared', 'S4 soon is NaN'])
  assert.ok(g.ok, g.why); assert.match(g.card, /red ✓ 1 failing/); assert.equal(w.meta['cadre.redOnly'], '')
  const strict = world({ acceptance: 'S1: Given a When b Then c\nS4: Given x When y Then z' }), r = await tester(strict, { 'test/s.json': tc('S1 dep declared', 'passed'), 'test/s2.json': tc('S4 soon is NaN', 'failure') }, ['S1 dep declared', 'S4 soon is NaN'])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /passed at red; it must fail/)   // no amended marker: every test must fail
})
test('a plan amendment flag (cadre.amended = 1) is not the amended scenario: the red stays strict', async () => {
  const w = world({ acceptance: 'S1: Given a When b Then c' }); w.meta['cadre.amended'] = '1'
  const r = await tester(w, { 'test/s.json': tc('S1 dep declared', 'passed'), 'test/s2.json': tc('S4 soon', 'failure') }, ['S1 dep declared', 'S4 soon'])
  assert.equal(r.res.ok, false); assert.match(r.res.why, /passed at red; it must fail/); assert.equal(w.meta['cadre.amended'], '1')   // untouched
})
test('an Accept without a valid scenario leaves the red strict and the tester\'s note without the "may pass" sentence', async () => {
  const w = world(), { wt } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a']); w.meta['cadre.worktree'] = wt
  await T.specChange(w.h, w.d, 'm-1', 'wrong spec'); await T.resolveSpec(w.h, 'm-1', 'accept')
  assert.equal(w.meta['cadre.redOnly'], ''); assert.doesNotMatch(w.meta['cadre.specDecision'], /may pass/)
})
test('amended red: the amended S4 test passing is refused', async () => {
  const { g } = await amended({ 'test/s.json': tc('S1 dep declared', 'failure'), 'test/s2.json': tc('S4 soon is NaN', 'passed') }, ['S1 dep declared', 'S4 soon is NaN'])
  assert.equal(g.ok, false); assert.match(g.why, /S4 soon is NaN" passed at red; it must fail/)
})
test('amended red: no test named after S4 is refused, naming S4', async () => {
  const { g } = await amended({ 'test/s.json': tc('S1 dep declared', 'passed'), 'test/s2.json': tc('S2 other', 'failure') }, ['S1 dep declared', 'S2 other'])
  assert.equal(g.ok, false); assert.match(g.why, /no test is named after S4, the scenario that was amended/)
})
test('amended red: an unchanged test that errors is refused (it must still run)', async () => {
  const { g } = await amended({ 'test/s.json': tc('S1 dep declared', 'error', 'boom'), 'test/s2.json': tc('S4 soon is NaN', 'failure') }, ['S1 dep declared', 'S4 soon is NaN'])
  assert.equal(g.ok, false); assert.match(g.why, /errors, not failures/)
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
