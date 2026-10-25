// The A1 decision rule for the specifier (harness/fold-vs-keep.mjs): worse folded -> on; equal, better or mixed -> opt-in; a run with no verdict counts 0 landed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { decide } from '../../harness/fold-vs-keep.mjs'

const run = (landed, rework = 0, dialogs = 0) => ({ landed, rework, dialogs })
test('folded lands strictly fewer: the specifier defaults on', () => assert.equal(decide([run(2), run(2), run(2)], [run(3), run(2), run(2)]).specifierDefault, 'on'))
test('same landed, 2 more rework+dialog events folded: on; 1 more: opt-in', () => {
  assert.equal(decide([run(6, 2, 1), run(0)], [run(6, 1, 0), run(0)]).foldedWorse, true)
  assert.equal(decide([run(6, 1, 1)], [run(6, 1, 0)]).foldedWorse, false)
})
test('folded better on landed but worse elsewhere (mixed), or equal: opt-in', () => {
  assert.equal(decide([run(7, 9, 9)], [run(6, 0, 0)]).specifierDefault, 'off (opt-in)')
  assert.equal(decide([run(6, 1, 1)], [run(6, 1, 1)]).specifierDefault, 'off (opt-in)')
})
test('a crashed run (no verdict) counts 0 landed, in either arm', () => {
  assert.equal(decide([undefined, run(3), run(3)], [run(3), run(3), run(3)]).foldedWorse, true)
  assert.equal(decide([run(3), run(3), run(3)], [undefined, run(3), run(3)]).foldedWorse, false)
})
test('the command reads the runs of both arms and writes its decision', () => {
  const d = mkdtempSync(join(tmpdir(), 'fvk-')), put = (cell, fk) => { mkdirSync(join(d, cell)); if (fk) writeFileSync(join(d, cell, 'verdict.json'), JSON.stringify({ stats: { foldKeep: fk } })) }
  for (const k of [1, 2, 3]) { put(`fold-vs-keep-folded.r${k}`, run(1)); put(`fold-vs-keep-kept.r${k}`, k === 3 ? undefined : run(1)) }
  const out = JSON.parse(execFileSync('node', ['harness/fold-vs-keep.mjs', d], { encoding: 'utf8' }))
  assert.deepEqual([out.folded.landed, out.kept.landed, out.specifierDefault, out.runs], [3, 2, 'off (opt-in)', { folded: 3, kept: 3 }])
})
