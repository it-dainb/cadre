// Dev-only: the boundary lint of scripts/budget.mjs (plan 7): a regex literal or a stdout/stderr read in a listed file fails, a bare model-visible string in a profile fails, a clean file passes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../..', import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), 'cadre-lint-'))
const lint = (name, body) => { const f = join(dir, name); writeFileSync(f, body); const r = spawnSync('node', [join(root, 'scripts/budget.mjs'), '--check-file', f], { encoding: 'utf8' }); return { code: r.status, out: r.stdout } }

test('a regex literal and new RegExp( fail; a slash in a string or a division does not', () => {
  assert.equal(lint('a.ts', 'const x = /ab+/.test(y)\n').code, 1)
  assert.equal(lint('b.ts', 'const y = s.replace(/a/g, "b")\n').code, 1)
  assert.equal(lint('c.ts', 'const z = new RegExp(p)\n').code, 1)
  assert.equal(lint('d.ts', "const u = 'a/b/c'.split('/'); const q = (a + b) / 2; const t = `${a}/${b}`\n").code, 0)
})
test('a .stdout / .stderr read fails unless it is inside modelData( or log(', () => {
  assert.equal(lint('e.ts', 'const o = r.stdout.split("x")\n').code, 1)
  assert.equal(lint('f.ts', 'throw new Error(`x ${r.stderr}`)\n').code, 1)
  assert.equal(lint('g.ts', "const t = () => modelData('tool-result', `${r.stdout}${r.stderr}`)\n").code, 0)
  assert.equal(lint('h.ts', 'h.log(r.stderr)\n').code, 0)
})
test('a bare model-visible string in a profile fails the model-exit scan; through modelText it passes', () => {
  assert.equal(lint('profile.ts', "export const flag = { why: 1, nudge: 'x' }\nconst r = { deny: 'no tests' }\n").code, 1)
  assert.equal(lint('profile2.ts', "const r = { deny: modelText('deny', 'no tests') }\n").code, 0)
})
test('the real files are clean: the whole run of the budget script exits 0 (core/gate.ts, core/tdd.ts, core/junit.ts, profiles/*.ts, vendored sha)', () => {
  const r = spawnSync('node', [join(root, 'scripts/budget.mjs')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr)
})
