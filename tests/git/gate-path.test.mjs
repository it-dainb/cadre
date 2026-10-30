// Dev-only: the path of $CADRE_JUNIT through the REAL checkRun (real git and bwrap, tests/dev/tdd-world.mjs), in jail mode and in mode none, and the host-side limits on a real fs.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { world, tester, tc, G, run } = await import('../dev/tdd-world.mjs')

for (const [name, cfg] of [['jail (the runner writes /tmp/cadre/junit-test.xml)', {}], ['mode none (the host path is passed directly)', { jail: 'off' }]]) {
  test(`a runner writing to its $CADRE_JUNIT is read by core from the run scratch, per-test: ${name}`, async () => {
    if (!cfg.jail) assert.notEqual(await G.jailMode(run), 'none', 'bwrap must work here')
    const w = world({ cfg }), { res } = await tester(w, { 'test/s.json': tc('login ok', 'failure', 'expected true'), 'test/t.json': tc('other', 'passed') }, ['login ok'])
    assert.ok(res.ok, res.why); assert.match(res.card, /red ✓ 1 failing/); assert.match(res.card, /- login ok: expected true/); assert.equal(w.meta['cadre.coverVia'], 'results')
  })
}

for (const [what, script, why] of [
  ['a symlink swapped in for the report', 'ln -s /etc/hostname "$CADRE_JUNIT"; exit 1', /not a regular file/],
  ['a report over 1 MB', 'head -c 1100000 /dev/zero | tr "\\0" a > "$CADRE_JUNIT"; exit 1', /over 1 MB/],
  ['a DOCTYPE with an entity', 'printf \'<!DOCTYPE x [<!ENTITY e "x">]><testsuite/>\' > "$CADRE_JUNIT"; exit 1', /DOCTYPE or entity/],
]) test(`B3: ${what} is a gate error (the check is broken), never a red`, async () => {
  const w = world({ pkg: { checks: { test: ['sh', '-c', script] } } }), { res } = await tester(w, { 'test/s.json': tc('a', 'failure') }, ['a'])
  assert.equal(res.ok, false); assert.equal(res.setup, true); assert.match(res.why, why)
})
