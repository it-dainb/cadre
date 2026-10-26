// Dev-only: the ui/tr import guard (scripts/budget.mjs --tr-imports) fails when a file outside ui/** imports tr (H11).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = dir => { try { execFileSync('node', ['scripts/budget.mjs', '--tr-imports', dir], { encoding: 'utf8', stdio: 'pipe' }); return '' } catch (e) { return String(e.stderr) } }

test('tr is importable from ui/** only; core/ and hooks/ importing it fail the guard; the real tree is clean', () => {
  const d = mkdtempSync(join(tmpdir(), 'tr-')); for (const x of ['ui', 'core', 'hooks']) mkdirSync(join(d, x))
  writeFileSync(join(d, 'ui/a.ts'), `import { tr } from './tr'\n`); assert.equal(run(d), '')
  writeFileSync(join(d, 'core/say2.ts'), `import { tr } from '../ui/tr'\n`); assert.match(run(d), /core\/say2\.ts/)
  writeFileSync(join(d, 'hooks/h.ts'), `import { tr } from '../ui/tr'\n`); assert.match(run(d), /hooks\/h\.ts/)
  assert.equal(run(process.cwd()), '')
})
