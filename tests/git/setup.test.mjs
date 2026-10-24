// The setup helper (core/helpers): the proposed argv is vetted by structured matching, run jailed in the requester's task folder, and only manifests and lockfiles are committed.
// Real git, real npm and bwrap; the "registry" is a local-path dependency, so nothing touches the network.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = await import('../../core/helpers.ts'), G = await import('../../core/git.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : undefined, timeout: o.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = async (cwd, ...a) => { const r = await run(a, { cwd }); assert.equal(r.exitCode, 0, `${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
const listing = d => readdirSync(d, { recursive: true }).sort().join('\n')

// a repo (main checkout), a task worktree on its branch, a local dependency, and a HOME with the repo approved
async function fix(o = {}) {
  // not under /tmp: the jail binds its scratch there and would mask the dependency
  const d = mkdtempSync(join('/var/tmp', 'cadre-setup-')), root = join(d, 'repo'), wt = join(d, 'wt'), home = join(d, 'home'), dep = join(d, 'dep')
  for (const p of [root, home, dep, join(home, '.claude/cadre')]) mkdirSync(p, { recursive: true })
  writeFileSync(join(dep, 'package.json'), '{"name":"local-dep","version":"1.0.0","main":"index.js"}\n'); writeFileSync(join(dep, 'index.js'), 'module.exports = 42\n')
  await sh(root, 'git', 'init', '-q', '-b', 'main'); await sh(root, 'git', 'config', 'user.email', 't@e.x'); await sh(root, 'git', 'config', 'user.name', 't')
  writeFileSync(join(root, 'package.json'), '{\n "name": "app",\n "version": "1.0.0"\n}\n'); writeFileSync(join(root, '.gitignore'), 'node_modules\n'); writeFileSync(join(root, 'a.txt'), 'a\n')
  await sh(root, 'git', 'add', '-A'); await sh(root, 'git', 'commit', '-qm', 'init'); await sh(root, 'git', 'worktree', 'add', '-q', '-b', 'feat/t-1', wt)
  if (o.approved !== false) writeFileSync(join(home, '.claude/cadre/deps.json'), JSON.stringify({ [root]: true }))
  const h = { run: o.run ?? run, home: async () => home, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) } }
  const inp = (x = {}) => ({ root, wt, scratch: join(d, 'scratch'), ask: 'add the local dependency', argv: ['npm', 'install', '--no-audit', '--no-fund', `file:${dep}`], auto: true, strays: 0, checkpoint: async () => G.commitAll(run, wt, 'wip: checkpoint'), ...x })
  return { d, root, wt, home, dep, h, inp, done: () => rmSync(d, { recursive: true, force: true }) }
}

test('every listed form is refused, the plain forms are allowed (structured argv, no shell)', () => {
  const R = '/r', bad = [['sudo', 'npm', 'install', 'x'], ['npm', 'install', '-g', 'x'], ['npm', 'install', '--global', 'x'], ['npm', 'i', '--location=global', 'x'], ['npm', 'i', '--location', 'global', 'x'], ['yarn', 'global', 'add', 'x'],
    ['pnpm', 'add', '-g', 'x'], ['pip', 'install', 'x'], [`${R}/.venv/bin/pip`, 'install', '--user', 'x'], ['/other/.venv/bin/pip', 'install', 'x'], ['cargo', 'install', 'ripgrep'], ['go', 'install', 'x@latest'], ['pipx', 'install', 'x'],
    ['brew', 'install', 'x'], ['apt', 'install', 'x'], ['apt-get', 'install', 'x'], ['npm', 'install', 'x', '|', 'sh'], ['npm', 'install', 'x;', 'rm'], ['npm', 'install', 'x', '&&', 'y'], ['npm install x'], ['npm'], [], ['npm', 'run', 'build'], ['uv', 'tool', 'install', 'x'], ['poetry', 'install'], ['cargo', 'add', 'x', '>', 'f']]
  for (const a of bad) assert.equal(typeof P.vet(a, R), 'string', `refused: ${JSON.stringify(a)}`)
  assert.equal(typeof P.vet('npm install x', R), 'string')
  assert.deepEqual(P.vet(['npm', 'install', 'x@>=1'], R), ['npm', 'install', 'x@>=1', '--ignore-scripts'])
  for (const a of [['pnpm', 'add', 'x'], ['yarn', 'add', 'x'], ['uv', 'add', 'x'], ['uv', 'pip', 'install', 'x'], ['poetry', 'add', 'x'], ['cargo', 'add', 'x'], ['go', 'get', 'x'], [`${R}/.venv/bin/pip`, 'install', 'x']]) assert.ok(Array.isArray(P.vet(a, R)), `allowed: ${JSON.stringify(a)}`)
})

test('npm install of a local dependency: the lockfile is committed on the task branch, only manifests, HOME untouched', async () => {
  const f = await fix(); try {
    const main = await sh(f.root, 'git', 'rev-parse', 'main'), before = [statSync(f.home).mtimeMs, listing(f.home)], r = await P.setup(f.h, f.inp())
    assert.match(r.text, /^Installed and committed on your branch: package\.json, package-lock\.json/, r.text)
    assert.equal(await sh(f.wt, 'git', 'log', '-1', '--format=%s'), 'chore(deps): add the local dependency'); assert.equal(await sh(f.wt, 'git', 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/t-1')
    assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort(), ['package-lock.json', 'package.json'])
    assert.ok(JSON.parse(readFileSync(join(f.wt, 'package.json'), 'utf8')).dependencies['local-dep']); assert.ok(existsSync(join(f.wt, 'node_modules/local-dep/index.js')))
    assert.equal(await sh(f.wt, 'git', 'status', '--porcelain'), ''); assert.equal(await sh(f.root, 'git', 'rev-parse', 'main'), main)
    assert.deepEqual([statSync(f.home).mtimeMs, listing(f.home)], before); assert.ok(!existsSync(join(f.d, 'scratch')))
  } finally { f.done() }
})

test('a dirty worktree survives: the worker\'s edits (a tracked file, an untracked one, an edited package.json) are kept byte for byte; a failed run restores them exactly', async () => {
  const f = await fix(); try {
    writeFileSync(join(f.wt, 'a.txt'), 'a edited by the worker\n'); writeFileSync(join(f.wt, 'new.txt'), 'untracked\n'); writeFileSync(join(f.wt, 'package.json'), '{\n "name": "app",\n "version": "1.0.0",\n "description": "mine"\n}\n')
    const files = ['a.txt', 'new.txt', 'package.json'], read = () => files.map(x => readFileSync(join(f.wt, x), 'utf8')), mine = read()
    const failed = await P.setup(f.h, f.inp({ argv: ['npm', 'install', '--no-audit', '--no-fund', `file:${f.d}/nonexistent`] }))
    assert.match(failed.text, /^The install changed nothing: it failed/); assert.deepEqual(read(), mine); assert.equal(await sh(f.wt, 'git', 'status', '--porcelain'), '')   // the checkpoint holds them, the tree is as it was
    const ok = await P.setup(f.h, f.inp()); assert.match(ok.text, /^Installed/)
    assert.deepEqual(read().slice(0, 2), mine.slice(0, 2)); const pj = JSON.parse(read()[2]); assert.equal(pj.description, 'mine'); assert.ok(pj.dependencies['local-dep'])
    assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort(), ['package-lock.json', 'package.json'])   // the deps commit holds manifests only
    assert.match(await sh(f.wt, 'git', 'log', '--format=%s', '-3'), /chore\(deps\)[\s\S]*wip: checkpoint/)
  } finally { f.done() }
})

test('no jail gives one dialog and nothing runs; deps.auto false gives one dialog; an unapproved repo asks once to allow, and the approval is in the user layer', async () => {
  const f = await fix({ approved: false, run: (a, o) => (a[0] === 'bwrap' ? Promise.resolve({ exitCode: 1, stdout: '', stderr: 'no' }) : run(a, o)) }); try {
    const head = await sh(f.wt, 'git', 'rev-parse', 'HEAD'), unapproved = await P.setup(f.h, f.inp()); assert.ok(unapproved.allow && unapproved.dialog, 'the first install in a repo asks'); assert.equal(await P.approved(f.h, f.root), false)
    const off = await P.setup(f.h, f.inp({ auto: false })); assert.match(off.dialog, /deps\.auto is off/); assert.ok(!off.allow)   // deps.auto
    await P.approve(f.h, f.root); assert.equal(await P.approved(f.h, f.root), true); assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(f.home, '.claude/cadre/deps.json'), 'utf8'))), [f.root])
    const none = await P.setup(f.h, f.inp()); assert.match(none.dialog, /isolation/); assert.ok(!none.allow)
    assert.equal(await sh(f.wt, 'git', 'rev-parse', 'HEAD'), head); assert.ok(!existsSync(join(f.wt, 'node_modules')))
    assert.match((await P.setup(f.h, f.inp({ argv: ['sudo', 'npm', 'i', 'x'], auto: false }))).text, /^The install was refused/)   // a refused form never reaches a dialog
  } finally { f.done() }
})
