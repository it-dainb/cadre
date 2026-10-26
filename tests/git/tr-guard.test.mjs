// Dev-only: the ui/tr import guard (scripts/budget.mjs --tr-imports) fails when a file outside ui/** imports tr (H11).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = dir => { try { execFileSync('node', ['scripts/budget.mjs', '--tr-imports', dir], { encoding: 'utf8', stdio: 'pipe' }); return '' } catch (e) { return String(e.stderr) } }   // the message, not just the exit code: a stale fixture also exits 1

test('tr is importable from ui/** only; core/ and hooks/ importing it fail the guard; the real tree is clean', () => {
  const d = mkdtempSync(join(tmpdir(), 'tr-')); for (const x of ['ui', 'core', 'hooks']) mkdirSync(join(d, x))
  writeFileSync(join(d, 'ui/a.ts'), `import { tr } from './tr'\n`); assert.equal(run(d), '')
  writeFileSync(join(d, 'core/say2.ts'), `import { tr } from '../ui/tr'\n`); assert.match(run(d), /core\/say2\.ts/)
  writeFileSync(join(d, 'hooks/h.ts'), `import { tr } from '../ui/tr'\n`); assert.match(run(d), /hooks\/h\.ts/)
  // every import form is caught, each in its own file
  const forms = { 'a.ts': `import { tr } from "../ui/tr"`, 'b.ts': `import { tr } from '../ui/tr.ts'`, 'c.mts': `import { tr } from '../ui/tr.js'`, 'd.js': `const m = await import('../ui/tr')`, 'e.mjs': `const m = import("../ui/tr.ts")`, 'f.ts': `export { tr } from '../ui/tr'` }
  for (const [f, src] of Object.entries(forms)) {
    const e = mkdtempSync(join(tmpdir(), 'tr-')); mkdirSync(join(e, 'tools')); writeFileSync(join(e, 'tools', f), src + '\n')
    assert.match(run(e), new RegExp(`imported outside ui/\\*\\*:\\ntools/${f.replace('.', '\\.')}`), f)
  }
  assert.match(run(d), /imported outside ui\/\*\*/)
  assert.equal(run(process.cwd()), '')
})
