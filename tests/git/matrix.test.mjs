import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dry = (env = {}) => execFileSync('bash', ['harness/matrix.sh', 'quick', '-n'], { encoding: 'utf8', env: { ...process.env, ...env } })

test('RUNS=2 lists two runs and doubles the cell estimate', () => {
  const one = dry({ FILTER: 'single-295' }), two = dry({ FILTER: 'continue-after-quit' })
  assert.match(two, /continue-after-quit\.r1/); assert.match(two, /continue-after-quit\.r2/); assert.doesNotMatch(two, /RUNS=/)
  assert.match(one, /^1 cells/m); assert.match(two, /^2 cells/m)
  // landed cell = 4 units of 0.4 US$ each, per run
  assert.match(two, /about US\$3\b/); assert.match(one, /about US\$0\b/)
})

const table = (verdicts) => {
  const run = mkdtempSync(join(tmpdir(), 'mx-'))
  verdicts.forEach((pass, i) => {
    const n = `cell.r${i + 1}`; mkdirSync(join(run, n)); writeFileSync(join(run, `${n}.line`), ''); writeFileSync(join(run, `${n}.env`), '')
    writeFileSync(join(run, n, 'verdict.json'), JSON.stringify({ pass, fails: pass ? [] : [{ invariant: `inv${i}`, evidence: 'e' }], stats: { dialogs: 0, turns: 1, usd: 0.5, secs: 120 } }))
  })
  return execFileSync('node', ['harness/table.mjs', run], { encoding: 'utf8' })
}

test('the row passes only if every run passes; US$ and min sum', () => {
  const ok = table([true, true]); assert.match(ok, /^cell +\| PASS/m); assert.match(ok, /1\/1 pass/); assert.match(ok, /\| 1 +\| 4 /)
  const bad = table([true, false]); assert.match(bad, /^cell +\| FAIL +\| inv1/m); assert.match(bad, /0\/1 pass/)
})

test('a real failing run outranks a known one, so the exit code sees it', () => {
  const run = mkdtempSync(join(tmpdir(), 'mx-'))
  const put = (n, inv) => { mkdirSync(join(run, n)); writeFileSync(join(run, `${n}.line`), ''); writeFileSync(join(run, `${n}.env`), 'KNOWN=s1'); writeFileSync(join(run, n, 'verdict.json'), JSON.stringify({ pass: false, fails: [{ invariant: inv, evidence: 'e' }], stats: { dialogs: 0, turns: 1, usd: 0.5, secs: 60 } })) }
  put('cell.r1', 'not-landed'); put('cell.r2', 'errors')
  assert.match(execFileSync('node', ['harness/table.mjs', run], { encoding: 'utf8' }), /^cell +\| FAIL +\| errors/m)
})

// live (release017 fold-vs-keep-folded): the arm landed all three tasks and the oracle still failed "no store snapshots": the scenario never took them. Every cell with an oracle mode
// (but underscore, which has none by design) must use a scenario that takes them.
test('every matrix cell with an oracle mode runs a scenario that takes the store snapshots', () => {
  const rows = readFileSync(new URL('../../harness/matrix.sh', import.meta.url), 'utf8').split('\n').filter(l => /^[\w.-]+\|[^|]*\|[\w-]+\|/.test(l)), bad = []
  for (const l of rows) {
    const [name, , scen, env] = l.split('|'), o = /ORACLE=(\S+)/.exec(env)?.[1]; if (!o || o === 'underscore') continue
    if (!/snapshots/.test(readFileSync(new URL(`../../harness/scenarios/${scen}.sh`, import.meta.url), 'utf8'))) bad.push(`${name} (${scen}.sh)`)
  }
  assert.deepEqual(bad, [])
})

test('an inconclusive run is no pass: the row shows it and the run exits non-zero for a rerun', () => {
  const run = mkdtempSync(join(tmpdir(), 'mx-'))
  for (const [n, v] of [['cell.r1', { pass: true, fails: [] }], ['cell.r2', { pass: false, inconclusive: true, fails: [] }]]) {
    mkdirSync(join(run, n)); writeFileSync(join(run, `${n}.line`), ''); writeFileSync(join(run, `${n}.env`), ''); writeFileSync(join(run, n, 'verdict.json'), JSON.stringify({ ...v, stats: { dialogs: 0, turns: 1, usd: 0, secs: 60 } }))
  }
  const out = execFileSync('node', ['harness/table.mjs', run], { encoding: 'utf8' })
  assert.match(out, /^cell +\| inconclusive/m); assert.match(out, /0\/1 pass/)
})
