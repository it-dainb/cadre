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
