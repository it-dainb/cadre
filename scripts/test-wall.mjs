// Dev-only (node): the 60 s wall per test file (TEST_WALL_S overrides). Usage: node scripts/test-wall.mjs [file.mjs ...]
// No args: every tests/git, tests/modules and tests/protocol *.mjs, each as its own `node --test` under a kill timer, then the .ts suites.
// .ts suites: `claude plugin test` has no reporter option and takes a folder, not a file, so only per-test ms inside each file's block
// are available (no per-file total). A file's wall is the sum of its tests' ms (load time excluded); the whole run is also held to the limit.
// The binary is $CC, else harness/claude-2.1.299; with neither, the .ts stage is skipped.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const limit = Number(process.env.TEST_WALL_S) || 60
let bad = 0
const row = (name, s, note = '') => { const over = s > limit || note; if (over) bad++; console.log(`${over ? 'FAIL' : 'ok  '} ${s.toFixed(1).padStart(6)} s  ${name}${note ? '  ' + note : ''}`) }

// detached: the runner gets its own process group, so the kill takes the test-file child with it (SIGKILL on the runner alone left that child running)
const exec = (cmd, args, cwd, collect) => new Promise(res => {
  const p = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', collect ? 'pipe' : 'ignore', 'ignore'] }); let out = '', timedOut = false
  p.stdout?.on('data', d => { out += d })
  const t = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, 'SIGKILL') } catch {} }, limit * 1000)
  p.on('close', status => { clearTimeout(t); res({ status, timedOut, out }) })
})

const given = process.argv.slice(2)
const files = given.length ? given : ['tests/git', 'tests/modules', 'tests/protocol'].flatMap(d => readdirSync(join(root, d)).filter(f => f.endsWith('.mjs')).sort().map(f => join(d, f)))
for (const f of files) {
  const t = Date.now(), r = await exec('node', ['--experimental-transform-types', '--test', f], root)
  row(f, (Date.now() - t) / 1000, r.timedOut ? 'TIMEOUT' : r.status ? 'FAILED' : '')
}

const cc = process.env.CC || join(root, 'harness/claude-2.1.299')
if (!given.length && existsSync(cc)) {
  const t = Date.now(), r = await exec(cc, ['plugin', 'test', '.'], root, true)
  const total = (Date.now() - t) / 1000
  if (r.timedOut) row('plugin test .', total, 'TIMEOUT')
  else {
    let cur = null; const sum = {}
    for (const l of r.out.split('\n')) {
      const h = /^(tests\/.+\.test\.tsx?):$/.exec(l); if (h) { cur = h[1]; sum[cur] = 0; continue }
      const m = cur && /\[([\d.]+)(ms|s)\]$/.exec(l); if (m) sum[cur] += Number(m[1]) / (m[2] === 'ms' ? 1000 : 1)
    }
    for (const [f, s] of Object.entries(sum)) if (s > limit) row(f, s)
    row(`plugin test . (${Object.keys(sum).length} files, slowest ${Math.max(0, ...Object.values(sum)).toFixed(1)} s)`, total, r.status ? 'FAILED' : '')
  }
}
process.exit(bad ? 1 : 0)
