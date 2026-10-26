// Dev-only: the TDD red gate's holds cases against real git (split from tdd-red.test.mjs for the 45 s wall under load; helpers in tests/dev/tdd-world.mjs).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { G, V, T, snap, fakeHost, defaults, repoKeyOf, policyOf, run, sh, base, RUN, world, mkTask, worktree, tc, tester } = await import('../dev/tdd-world.mjs')

// ---- holds (the plan's: scenarios whose behaviour already exists): their tests must PASS at red; every other test fails as always ----
const VAL = await import('../../core/validate.ts')
const ACC = 'S1: Given a When b Then c\nS2: Given x When y Then z'
const held = async (files, names, o = {}) => { const w = world({ acceptance: o.acceptance ?? ACC }); w.meta['cadre.holds'] = JSON.stringify(o.holds ?? ['S2']); return { w, ...(await tester(w, files, names)) } }
test('holds: an unmarked scenario that passes at red is refused; a marked one that passes is accepted with the unmarked one failing', async () => {
  const bad = await held({ 'test/s.json': tc('S1 new', 'passed'), 'test/s2.json': tc('S2 held', 'passed') }, ['S1 new', 'S2 held']); assert.equal(bad.res.ok, false); assert.match(bad.res.why, /pass at the spec commit/)   // S1 is not held: green is not red
  const ok = await held({ 'test/s.json': tc('S1 new', 'failure'), 'test/s2.json': tc('S2 held', 'passed') }, ['S1 new', 'S2 held']); assert.ok(ok.res.ok, ok.res.why); assert.match(ok.res.card, /red ✓ 1 failing/); assert.match(ok.res.card, /S2 held: passed \(S2 holds\)/)
})
test('holds: a marked scenario whose test fails is refused (the plan said it holds); one with no test named after it is refused naming it', async () => {
  const red = await held({ 'test/s.json': tc('S1 new', 'failure'), 'test/s2.json': tc('S2 held', 'failure') }, ['S1 new', 'S2 held']); assert.equal(red.res.ok, false); assert.match(red.res.why, /test "S2 held" fails; S2 already holds, so it must pass now/)
  const none = await held({ 'test/s.json': tc('S1 new', 'failure') }, ['S1 new']); assert.equal(none.res.ok, false); assert.match(none.res.why, /no test is named after S2 alone, which the plan says already holds/)
})
test('holds: one test named after a held and an unheld scenario is an unheld test: it must fail (the combined-name probe), with or without holds set', async () => {
  const probe = await held({ 'test/s.json': tc('S1 and S2 combined', 'passed'), 'test/s2.json': tc('S2 held', 'passed') }, ['S1 and S2 combined', 'S2 held']); assert.equal(probe.res.ok, false); assert.match(probe.res.why, /pass at the spec commit/)   // S1 never fails
  const noHolds = world({ acceptance: ACC }), r = await tester(noHolds, { 'test/s.json': tc('S1 and S2 combined', 'passed') }, ['S1 and S2 combined']); assert.equal(r.res.ok, false)
  const alone = await held({ 'test/s.json': tc('S1 and S2 combined', 'failure'), 'test/s2.json': tc('S2 held', 'passed') }, ['S1 and S2 combined', 'S2 held']); assert.ok(alone.res.ok, alone.res.why)   // the combined one fails, S2 has its own passing test
  const missing = await held({ 'test/s.json': tc('S1 and S2 combined', 'failure') }, ['S1 and S2 combined']); assert.equal(missing.res.ok, false); assert.match(missing.res.why, /no test is named after S2 alone/)
})
test('holds: a task whose scenarios all hold needs no failing test', async () => {
  const all = await held({ 'test/s.json': tc('S2 held', 'passed') }, ['S2 held'], { acceptance: 'S2: Given x When y Then z' }); assert.ok(all.res.ok, all.res.why)
})
test('holds: only the planner sets it: a tester or worker report with the field is refused for its form', () => {
  for (const r of [{ role: 'tester', outcome: 'done', summary: 's', tests: [], holds: ['S1'] }, { role: 'worker', outcome: 'done', summary: 's', holds: ['S1'] }]) { const e = VAL.reportRefusal({ schemaVersion: 1, ...r }); assert.equal(e.code, 'shape'); assert.match(e.msg, /holds: unknown field/) }
})
test('holds: after the base moved, the held tests are re-run on the tree: green stays, red is named', async () => {
  const { w, wt } = await held({ 'test/s.json': tc('S1 new', 'failure'), 'test/s2.json': tc('S2 held', 'passed') }, ['S1 new', 'S2 held']); w.meta['cadre.worktree'] = wt
  assert.deepEqual(await T.holdsRed(w.h, w.d, await mkTask(w), wt), [])
  writeFileSync(join(wt, 'test/s2.json'), tc('S2 held', 'failure')); const red = await T.holdsRed(w.h, w.d, await mkTask(w), wt); assert.equal(red.length, 1); assert.match(red[0], /S2 held$/)
  assert.deepEqual(await T.holdsRed(w.h, w.d, await mkTask(world()), wt), [])   // a task with no holds has nothing to re-run
})
test('holds: a test passing at red names its scenario on the refusal (the dialog offers Already holds); once held, the same tests pass the gate and the others still fail', async () => {
  const files = { 'test/s.json': tc('S1 new', 'failure'), 'test/s2.json': tc('S2 held', 'passed') }, names = ['S1 new', 'S2 held']
  const w = world({ acceptance: ACC }), bad = await tester(w, files, names); assert.equal(bad.res.ok, false); assert.deepEqual(bad.res.passing, ['S2'])
  assert.deepEqual((await tester(world({ acceptance: ACC }), { 'test/s.json': tc('S1 new', 'passed') }, ['S1 new'])).res.passing, ['S1'])
  const none = await tester(world({ acceptance: ACC }), { 'test/s.json': tc('S1 new', 'failure'), 'test/s2.json': tc('S2 held', 'failure') }, names); assert.equal(none.res.ok, true); assert.equal(none.res.passing, undefined)   // no pass at red: no option
  const ok = await held(files, names); assert.ok(ok.res.ok, ok.res.why)   // S2 marked held: green is right for it
  const wrong = await held({ 'test/s.json': tc('S1 new', 'passed'), 'test/s2.json': tc('S2 held', 'passed') }, names); assert.equal(wrong.res.ok, false)   // S1 is not held: it must still fail
})
