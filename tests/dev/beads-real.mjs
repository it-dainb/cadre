// Dev-only: runs tests/store-contract.ts against REAL bd (one throwaway git repo per store) and, with RECORD=1, writes the replay fixture
// tests/fixtures/bd/contract.ts used by tests/beads.test.ts.
//   RECORD=1 node --experimental-transform-types --import ./tests/dev/register.mjs tests/dev/beads-real.mjs
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { BdStore } from '../../task-management/adapters/beads/store.ts'
import { contract } from '../store-contract.ts'

const sessions = []
const exec = (argv, init = {}) => new Promise((res, rej) => {
  const p = execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: { ...process.env, ...init.env }, timeout: init.timeoutMs ?? 45000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') return rej(err)
    res({ exitCode: err ? err.code : 0, stdout, stderr })
  })
  if (init.stdin !== undefined) p.stdin.end(init.stdin); else p.stdin.end()
})
contract('beads (real bd)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cadre-bd-')), log = []
  sessions.push(log); execFileSync('git', ['init', '-q', dir])
  const run = async (argv, init) => { const r = await exec(argv, init); log.push({ argv: argv.slice(1), stdin: init?.stdin, ...r }); return r }
  return new BdStore({ run, cwd: dir, actor: 'cadre/test/abc123' })
})
if (process.env.RECORD) after(() => writeFileSync(new URL('../fixtures/bd/contract.ts', import.meta.url), `// RECORDED from real bd ${process.env.BD_VERSION ?? ''} by tests/dev/beads-real.mjs (RECORD=1): one session per store, calls in order. Do not edit by hand.\nexport const SESSIONS: { argv: string[]; stdin?: string; exitCode: number; stdout: string; stderr: string }[][] = ` + JSON.stringify(sessions.map(s => s.map(c => ({ argv: c.argv, ...(c.stdin !== undefined ? { stdin: c.stdin } : {}), exitCode: c.exitCode, stdout: c.stdout, stderr: c.stderr })))) + '\n'))
