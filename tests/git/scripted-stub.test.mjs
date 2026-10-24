// Dev-only: the scripted stub (harness/scripted/hooks/register.ts). node --test tests/git/scripted-stub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../harness/scripted/hooks/register.ts', import.meta.url), 'utf8')
const re = eval(/const taskOf = .*?match\((\/.*?\/)\)/.exec(src)[1]), taskOf = brief => brief.match(re)?.[1]

// continue-after-quit-s on 62c1623: the stub read no task id from "REVIEW TASK-c-6-1" (its pattern wanted a ".N" suffix), so the reviewer's run_check was refused
// with "you are bound to c-6-1"; the worker and both reviewers made three identical refusals when the kill landed late, and the oracle's refusal-loop failed the cell
test('taskOf reads every id shape a brief carries', () => {
  for (const id of ['c-6-1', 'm-2', 'c-4-1']) assert.equal(taskOf(`# REVIEW TASK-${id}\n\n## Source commit`), id)
  assert.equal(taskOf('no id here'), undefined)
})

// the same run: the reviewer has no Bash, so a Bash wait made no wait at all and it ended in under a second, before the cell's kill landed
test('the cont reviewer waits by sleeping in the step, not through a tool it does not have', () => {
  assert.doesNotMatch(src, /script === 'cont' \? \[WAIT\]/)
  assert.match(src, /script === 'cont' && who === 'reviewer' && e\.index === 0\) await new Promise/)
})
