// The prefix of a cadre agent's Bash call (core/helpers.offlinePrefix), run by a real bash: package managers offline, and their caches and logs in a folder of the user's own
// (`${TMPDIR:-/tmp}/cadre-<uid>`, 0700, used only when it is ours and not a link), never in a shared fixed path.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { CACHES, OFFLINE, offlinePrefix } = await import('../../core/helpers.ts')
const uid = process.getuid()
const run = (tmp, cmd) => execFileSync('bash', ['-c', `${offlinePrefix()}${cmd}`], { env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: 'utf8' })
const envOf = out => Object.fromEntries(out.trim().split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const NAMES = [...Object.keys(OFFLINE), ...Object.keys(CACHES), '__cd']

test('the prefix sets the offline settings and the caches in cadre-<uid> (0700, ours); the command after it runs as written and the prefix leaves no variable of its own', () => {
  const tmp = mkdtempSync(join('/var/tmp', 'cadre-shell-'))
  try {
    const e = envOf(run(tmp, `env | grep -E '^(${NAMES.join('|')})='; echo "exit-ok"`)), dir = join(tmp, `cadre-${uid}`)
    for (const [k, v] of Object.entries(OFFLINE)) assert.equal(e[k], v, k)
    for (const [k, d] of Object.entries(CACHES)) assert.equal(e[k], join(dir, d), k)
    assert.equal(e.__cd, undefined); assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(dir).uid, uid)
    assert.equal(run(tmp, 'echo a && echo b').trim(), 'a\nb')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a cadre-<uid> that is a link is never used for the caches (the offline settings still apply; a folder owned by someone else fails the same `-O` test, which needs a second OS user to show)', () => {
  const tmp = mkdtempSync(join('/var/tmp', 'cadre-shell-')), elsewhere = join(tmp, 'elsewhere'); mkdirSync(elsewhere)
  try {
    symlinkSync(elsewhere, join(tmp, `cadre-${uid}`))
    const e = envOf(run(tmp, `env | grep -E '^(${NAMES.join('|')})='`))
    for (const k of Object.keys(CACHES)) assert.equal(e[k], undefined, `${k} is not set through a link`)
    assert.equal(e.npm_config_offline, 'true'); assert.equal(e.UV_OFFLINE, '1'); assert.equal(existsSync(join(elsewhere, 'npm-cache')), false)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a cadre-<uid> that already exists with a loose mode is tightened to 0700 when it is ours', () => {
  const tmp = mkdtempSync(join('/var/tmp', 'cadre-shell-')), dir = join(tmp, `cadre-${uid}`); mkdirSync(dir, { mode: 0o755 })
  try { run(tmp, 'true'); assert.equal(statSync(dir).mode & 0o777, 0o700) } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('scripts/test-wall.mjs: with TEST_WALL_S=2 a 5 s file fails and a 0 s file passes (the timer costs seconds)', () => {
  const tmp = mkdtempSync(join('/var/tmp', 'cadre-wall-')), wall = file => spawnSync('node', ['scripts/test-wall.mjs', file], { cwd: new URL('../..', import.meta.url).pathname, env: { ...process.env, NODE_TEST_CONTEXT: undefined, TEST_WALL_S: '2' }, encoding: 'utf8' })
  try {
    const slow = join(tmp, 'slow.mjs'), fast = join(tmp, 'fast.mjs')
    writeFileSync(slow, "import { test } from 'node:test'\ntest('slow', async () => { await new Promise(r => setTimeout(r, 5000)) })\n"); writeFileSync(fast, "import { test } from 'node:test'\ntest('fast', () => {})\n")
    const s = wall(slow); assert.equal(s.status, 1); assert.match(s.stdout, /TIMEOUT/)
    const f = wall(fast); assert.equal(f.status, 0, f.stdout)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})
