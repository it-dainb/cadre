// Dev-only: the matrix watcher's screen readers (harness/cell.sh dialog/title) on saved screens. node --test tests/git/watcher.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, fix = join(root, 'tests/fixtures/oracle/kill-docked')
const fns = readFileSync(join(root, 'harness/cell.sh'), 'utf8').split('\n').filter(l => /^(flat|dialog|title|isplan|plantitle|qtitle|isplain|waitfor)\(\)/.test(l)).join('\n')
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
// quick tier at 215de58: the fallback title also fired on the review screen ("› Prompt from the cadre plugin …"), so the watcher logged a dialog where it used to log
// "submit answers", and the oracle counted 5 dialogs against 4. The fallback is for a real question only.
test('the review screen keeps an empty title (it is logged as the submit); the fallback never turns it into a dialog', () => {
  assert.equal(sh('dialog "$p" && echo yes || echo no', 'review-wrapped.txt'), 'yes')
  assert.equal(sh('qtitle "$p"', 'review-wrapped.txt'), '')
  assert.equal(sh('qtitle "$p"', 'review.txt'), '')
})
test('a title the fallback reads from a covered pane has no box drawing in it', () => {
  assert.doesNotMatch(sh('qtitle "$p"', 'plan-covered.txt'), /[╭╮╰╯─│]/)
})

// devmoved.sh set W=$D/work, the cell's own variable for the watcher's pid: `kill $W` killed nothing and every dev-moved cell left its watcher running for hours
test('no scenario assigns a variable the cell itself uses', () => {
  const own = ['H', 'N', 'FIX', 'SCEN', 'D', 'O', 'T0', 'PP', 'WALL', 'WATCH', 'CELL', 'S', 'TOK']
  for (const f of readdirSync(join(root, 'harness/scenarios'))) {
    const hits = readFileSync(join(root, 'harness/scenarios', f), 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).flatMap(l => [...l.matchAll(/(?:^|[;&{(]|\s)(?:local\s+)?([A-Z][A-Z0-9_]*)=/g)].map(m => m[1])).filter(v => own.includes(v))
    assert.deepEqual(hits, [], `${f} assigns ${hits.join(', ')}`)
  }
})

// quick tier, user1-mono-clear-cd-retype on 7467527: main took 33 s to ask its question after the setup; goal() read the open dialog as "the line ran as plain text" and pressed Escape
// on main's own question, then typed the goal again (a dialog too many). A turn running with a dialog open is cadre's, never plain text.
test('a running turn with no dialog open is plain text; one with a dialog open (main\'s question) is not', () => {
  const busy = 'Working on it…\nesc to interrupt'
  assert.equal(execFileSync('bash', ['-c', `${fns}\nisplain "$1" && echo plain || echo not`, '_', busy], { encoding: 'utf8' }).trim(), 'plain')
  assert.equal(execFileSync('bash', ['-c', `${fns}\nisplain "$1" && echo plain || echo not`, '_', 'idle composer\n? for shortcuts'], { encoding: 'utf8' }).trim(), 'not')
  assert.equal(sh('{ isplain "$p" && echo plain || echo not; }', 'question.txt'), 'not')
  assert.equal(execFileSync('bash', ['-c', `${fns}\np=$(cat "$1"); isplain "$p
esc to interrupt" && echo plain || echo not`, '_', join(fix, 'question.txt')], { encoding: 'utf8' }).trim(), 'not')   // a dialog on screen wins even when the footer still says esc to interrupt
})

// quick tier, user1-mono-clear-cd-retype on 37ddade: the goal is typed while the setup run goes on (the scenario's point); Claude Code queues it behind the running turn, and goal() gave up after
// 30 s and pressed Escape on the setup run itself ("the plan wasn't drafted", no plan in 610 s). A line typed into a running turn waits for it; one typed at an idle prompt gets 30 s.
test('how long goal() waits for cadre to answer: the budget when a turn was running at the send, 30 s at an idle prompt', () => {
  const w = (busy, left) => execFileSync('bash', ['-c', `${fns}\nwaitfor "$1" "$2"`, '_', busy, left], { encoding: 'utf8' }).trim()
  assert.equal(w('1', '480'), '480'); assert.equal(w('', '480'), '30')
})
