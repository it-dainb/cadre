// Dev-only: characterization of cadre 1.0.1 (plan cadre-2.0 section 6), the five flag-effect scripts = rows 4, 5, 6, 7, 10 of the 2.5 flag table, plus the coverage check that each row is hit.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { transcript, check, script } = await import('../dev/char-driver.mjs')
const CELLS = { 'flag-rebase': 4, 'flag-red': 5, 'flag-shape': 6, 'flag-restart': 7, 'flag-spec': 10 }
const T = {}
for (const cell of Object.keys(CELLS)) test(`characterization ${cell}`, async () => { T[cell] = await transcript(cell); await check(cell, T[cell]) })

// a row is hit when its transcript shows the flag raised and then the effect of the answer: the flag gone and the task moved on (the step it ends at)
const flagged = (t, kind) => t.findIndex(e => e.tasks.some(x => x.flags.includes(kind)))
const after = (t, from, op) => t.slice(from).find(e => e.op === op)
const HIT = {
  4: t => after(t, flagged(t, 'conflict'), 'Retry: one more round')?.tasks[0],
  5: t => after(t, flagged(t, 'gate-error'), 'Retry')?.tasks[0],
  6: t => after(t, flagged(t, 'shape'), 'Retry')?.tasks[0],
  7: t => after(t, flagged(t, 'no-report'), 'Keep going')?.tasks[0],
  10: t => after(t, flagged(t, 'spec_change'), 'Accept')?.tasks[0],
}
const MOVED = { 4: ['active', 'worker'], 5: ['active', 'tester'], 6: ['active', 'worker'], 7: ['active', 'worker'], 10: ['active', 'tester'] }
test('coverage: each of rows 4, 5, 6, 7, 10 is hit by a script (flag raised, answer clears it)', () => {
  for (const [cell, row] of Object.entries(CELLS)) {
    assert.equal(script(cell).row, row, `${cell} names its row`)
    const t = HIT[row](T[cell] ?? []), want = MOVED[row]
    assert.ok(t, `${cell}: row ${row} never raised its flag and answered it`)
    assert.deepEqual([t.state, t.step, t.flags], [...want, []], `${cell}: row ${row}`)
  }
  assert.deepEqual(Object.values(CELLS).sort((a, b) => a - b), [4, 5, 6, 7, 10])
})
