// Dev-only: the matrix watcher's screen readers (harness/cell.sh dialog/title) on saved screens. node --test tests/git/watcher.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, fix = join(root, 'tests/fixtures/oracle/kill-docked')
const fns = readFileSync(join(root, 'harness/cell.sh'), 'utf8').split('\n').filter(l => /^(flat|dialog|title|isplan|plantitle|qtitle)\(\)/.test(l)).join('\n')
const sh = (call, pane) => execFileSync('bash', ['-c', `${fns}\np=$(cat "$1"); ${call}`, '_', join(fix, pane)], { encoding: 'utf8' }).trim()

// quick tier, kill-mid-setup on 7d24520: after the restart cadre's pane docked at the right and narrowed the main column, so the review screen read
// "Ready to submit your" / "answers?" on two rows; the watcher never saw a dialog, never pressed Enter, and the plan never came (no-plan, 612 s)
test('the review screen a docked pane wraps over two rows is a dialog the watcher submits', () => {
  assert.equal(sh('dialog "$p" && echo yes || echo no', 'review.txt'), 'yes')
  assert.equal(sh('title "$p"', 'review.txt'), '')   // no question on it: the watcher logs it as "submit answers"
})
test('a question\'s title skips the tab bar the narrowed column wraps', () => {
  assert.equal(sh('title "$p"', 'question.txt'), 'Should the plan also add a CHANGELOG entry? The CHANGELOG has an')
})
// quick tier, kill-mid-setup on a79166c: a toast covered the plan dialog's title; the fallback name did not match the plan pattern, so the watcher logged
// "dialog" and the cell waited 610 s for a "plan" event (no-plan) though the plan was approved and landed
test('a plan dialog whose title a toast covers is logged as the plan', () => {
  assert.equal(sh('isplan "$(plantitle "$(title "$p")" "$p")" && echo plan || echo other', 'plan-covered.txt'), 'plan')
  assert.equal(sh('isplan "$(plantitle "$(title "$p")" "$p")" && echo plan || echo other', 'question.txt'), 'other')
})
// quick tier, kill-mid-setup on 380bdaf: the pane was so narrow that the tab bar's ☐ row scrolled off, the title read empty, and the oracle counted the third tab of
// main's one question call as a dialog of its own (dialog-budget 5 > 4)
test('a question whose tab bar scrolled off still has its title', () => {
  assert.match(sh('qtitle "$p"', 'question-nofold.txt'), /^The explorer found that slug/)
  assert.equal(sh('title "$p"', 'question-nofold.txt'), '')
})
