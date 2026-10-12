// Dev-only: the init check finds a .cadre made below the root (a shell left in a package folder, live 0.10.0), on a real tree; never inside .git or node_modules.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const I = await import('../../commands/init.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })

test('a stray kit/.cadre is a red item; the root .cadre and ones under .git or node_modules are not', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-stray-')); for (const p of ['.cadre', 'kit/.cadre/store', 'node_modules/x/.cadre', '.git/y/.cadre']) mkdirSync(join(d, p), { recursive: true })
  const h = { run, cwd: async () => d, home: async () => d, now: async () => 0, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, stat: async () => undefined, env: async () => ({}),
    options: {}, board: cell({ mission: 'm', tasks: [] }), secret: cell({}), ui: cell({}), store: { get: async () => undefined, set: async () => {} } }
  const st = (await I.initItems(h, { quick: true })).filter(i => i.name === 'no setup folder outside the root')
  assert.deepEqual(st.map(i => i.why), [`kit/.cadre is not the project root's: delete it (rm -rf ${d}/kit/.cadre)`])
})
