// Dev-only: the matrix watcher's screen readers (harness/cell.sh dialog/title) on saved screens. node --test tests/git/watcher.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, fix = join(root, 'tests/fixtures/oracle/kill-docked')
const fns = readFileSync(join(root, 'harness/cell.sh'), 'utf8').split('\n').filter(l => /^(flat|dialog|title)\(\)/.test(l)).join('\n')
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
