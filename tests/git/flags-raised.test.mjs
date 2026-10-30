// S3: every flag kind raised in the product has a row in the flag table (plan 2.5: a raised kind with no row would raise no dialog and hold nothing).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, ts = d => readdirSync(join(root, d), { recursive: true }).filter(f => f.endsWith('.ts') && !f.includes('vendor')).map(f => join(root, d, f))
const SITES = [/raise\(h, [^,]+, '([a-z_-]+)'/g, /blockTask\([^)]*?, '([a-z_-]+)', \{/g, /flag: '([a-z_-]+):?'/g, /flag\([a-z.]+, [^,]+, '([a-z_-]+)'\)/g, /flags\.includes\('([a-z_-]+)'\)/g]

test('every raised flag kind has a row; every row names a kind that is raised or new in 2.0', async () => {
  const { flags } = await import('../../profiles/default.ts'), seen = new Set()
  for (const f of [...ts('core'), ...ts('task-management'), ...ts('tools')]) { const src = readFileSync(f, 'utf8'); for (const re of SITES) for (const m of src.matchAll(re)) seen.add(m[1]) }
  seen.delete('limit')   // a drive stop's cause, never a task flag
  const missing = [...seen].filter(k => !flags[k]); assert.deepEqual(missing, [])
  assert.ok(['red', 'conflict', 'spec_change', 'shape', 'stopped', 'lost-epic', 'integration-failed', 'locked-dirty', 'attempts', 'edited', 'report-unvalidated'].every(k => seen.has(k)), [...seen].join(' '))   // the scan finds the known sites
})
