// Dev-only: the matrix oracle on a saved screen (harness/oracle.mjs). node --test tests/git/oracle.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, fix = join(root, 'tests/fixtures/oracle/restart-docked')
const judge = (edit = t => t) => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')); cpSync(fix, d, { recursive: true })
  for (const f of readdirSync(join(d, 'panes'))) writeFileSync(join(d, 'panes', f), edit(readFileSync(join(d, 'panes', f), 'utf8')))
  try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
  return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
}

// quick tier, kill-mid-setup on 9918502: the bare /cadre after the restart said "Setup was interrupted · /cadre …", but the pane docked at the right
// wrapped it over two rows ("Setup was" / "interrupted · /cadre") and the one-row pattern failed restart-named
test('restart-named reads a reply the docked pane wrapped over two rows', () => {
  assert.ok(readFileSync(join(fix, 'panes', readdirSync(join(fix, 'panes'))[0]), 'utf8').includes('cadre: Setup was    │'))
  assert.ok(!judge().includes('restart-named'))
  assert.ok(judge(t => t.replace(/Setup was/g, 'All good  ').replace(/interrupted/g, 'xxxxxxxxxxx')).includes('restart-named'))   // a reply that names nothing still fails
})

// scripted dev-moved on 4922aa6: the watcher pressed 1 on the band 185 ms before the cell ended; the capture stopped and the debug log was copied
// before the dialog (1 s later) could show, so press1-no-dialog judged a press it never watched. A press with no 5 s left to watch is not judged.
test('press1-no-dialog judges only a press the cell watched for 5 s', () => {
  const press1 = gap => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_131_660_000, rule = '─'.repeat(40)
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true, filter: s => !s.endsWith('.txt') })
    writeFileSync(join(d, 'panes', `${t}.txt`), `x [-]\n! NEEDS YOU · dev has new work for your checkout   1: answer\n${rule}\n❯ \n${rule}\n  ⚠ cadre: dev has new work for your checkout · press 1\n`)
    writeFileSync(join(d, 'driver.log'), [`${t - 1000} start x`, `${t + 100} press1 ⚠ cadre: dev has new work for your checkout · press 1`, `${t + 100 + gap} end`].join('\n') + '\n')
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
  }
  assert.ok(!press1(185).includes('press1-no-dialog'))
  assert.ok(press1(10_000).includes('press1-no-dialog'))   // a press watched for 10 s with no dialog still fails
})
