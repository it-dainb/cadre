// The setup helper (core/helpers): the proposed argv is vetted by allowlist (known flags, registry names only), run jailed in the requester's task folder with a clean environment
// and the real home hidden, and only manifests and lockfiles are committed. Real git, real npm and bwrap; the registry is a tiny local one (127.0.0.1), so nothing leaves the machine.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = await import('../../core/helpers.ts'), G = await import('../../core/git.ts')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : undefined, timeout: o.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = async (cwd, ...a) => { const r = await run(a, { cwd }); assert.equal(r.exitCode, 0, `${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
const listing = d => readdirSync(d, { recursive: true }).sort().join('\n')

// a registry with one package, local-dep; it answers on 127.0.0.1 (the jail shares the network)
async function registry(d) {
  const pkg = join(d, 'pkg/package'); mkdirSync(pkg, { recursive: true }); writeFileSync(join(pkg, 'package.json'), '{"name":"local-dep","version":"1.0.0","main":"index.js"}\n'); writeFileSync(join(pkg, 'index.js'), 'module.exports = 42\n')
  await sh(join(d, 'pkg'), 'tar', 'czf', '../local-dep-1.0.0.tgz', 'package'); const tgz = readFileSync(join(d, 'local-dep-1.0.0.tgz'))
  const srv = createServer((q, r) => {
    if (q.url === '/local-dep') { const u = `http://127.0.0.1:${srv.address().port}/local-dep/-/local-dep-1.0.0.tgz`; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ name: 'local-dep', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'local-dep', version: '1.0.0', dist: { tarball: u } } } })) }
    else if (q.url.endsWith('.tgz')) r.end(tgz); else { r.statusCode = 404; r.end('{}') }
  })
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); return srv
}
// a repo (main checkout, with an .npmrc naming the registry), a task worktree on its branch, and a HOME holding the repo's approval and a secret
async function fix(o = {}) {
  // not under /tmp: the jail binds its scratch there and would mask the folders
  const d = mkdtempSync(join('/var/tmp', 'cadre-setup-')), root = join(d, 'repo'), wt = join(d, 'wt'), home = join(d, 'home'), srv = await registry(d)
  for (const p of [root, join(home, '.claude/cadre')]) mkdirSync(p, { recursive: true })
  await sh(root, 'git', 'init', '-q', '-b', 'main'); await sh(root, 'git', 'config', 'user.email', 't@e.x'); await sh(root, 'git', 'config', 'user.name', 't')
  writeFileSync(join(root, 'package.json'), '{\n "name": "app",\n "version": "1.0.0"\n}\n'); writeFileSync(join(root, '.gitignore'), 'node_modules\n'); writeFileSync(join(root, 'a.txt'), 'a\n'); writeFileSync(join(root, '.npmrc'), `registry=http://127.0.0.1:${srv.address().port}/\n`)
  await sh(root, 'git', 'add', '-A'); await sh(root, 'git', 'commit', '-qm', 'init'); await sh(root, 'git', 'worktree', 'add', '-q', '-b', 'feat/t-1', wt)
  if (o.approved !== false) writeFileSync(join(home, '.claude/cadre/deps.json'), JSON.stringify({ [root]: true })); writeFileSync(join(home, 'secret.txt'), 'real-home-secret')
  const kv = new Map(), h = { run: o.run ?? run, home: async () => home, env: async () => ({ PATH: process.env.PATH, LANG: process.env.LANG }), store: { get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v) } },
    readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) } }
  const inp = (x = {}) => ({ root, wt, base: 'main', scratch: join(d, 'scratch'), ask: 'add the local dependency', argv: ['npm', 'install', '--no-audit', '--no-fund', 'local-dep'], auto: true, strays: 0, checkpoint: async () => G.commitAll(run, wt, 'wip: checkpoint'), ...x })
  return { d, root, wt, home, h, inp, done: () => { srv.close(); rmSync(d, { recursive: true, force: true }) } }
}
// the install step runs `script` in the jail instead of the package manager (same jail, same environment)
const jailed = script => async (a, o) => {
  const i = a.indexOf('--'); if (a[0] !== 'bwrap' || !a.includes('--chdir') || a.includes('--unshare-net') || !a.includes('--clearenv')) return run(a, o)
  return run([...a.slice(0, i + 1), 'sh', '-c', script], o)
}

test('every listed form is refused; the plain forms are allowed with scripts off (by environment) and wheels only', () => {
  const W = '/w', bad = [['sudo', 'npm', 'install', 'x'], ['npm', 'install', '-g', 'x'], ['npm', 'install', '--global', 'x'], ['npm', 'i', '--location=global', 'x'], ['npm', 'i', '--location', 'global', 'x'], ['npm', 'i', '--global=true', 'x'], ['yarn', 'global', 'add', 'x'],
    ['pnpm', 'add', '-g', 'x'], ['pip', 'install', 'x'], [`${W}/.venv/bin/pip`, 'install', '--user', 'x'], ['/other/.venv/bin/pip', 'install', 'x'], ['/repo/.venv/bin/pip', 'install', 'x'], ['cargo', 'install', 'ripgrep'], ['go', 'install', 'x.io/a@latest'], ['pipx', 'install', 'x'],
    ['brew', 'install', 'x'], ['apt', 'install', 'x'], ['npm', 'install', 'x', '|', 'sh'], ['npm', 'install', 'x;', 'rm'], ['npm', 'install', 'x', '&&', 'y'], ['npm install x'], ['npm'], [], ['npm', 'run', 'build'], ['uv', 'tool', 'install', 'x'], ['poetry', 'add', 'x'], ['cargo', 'add', 'x', '>', 'f'],
    ['npm', 'i', '--registry=http://evil/', 'x'], ['npm', 'i', '--registry', 'http://evil/', 'x'], [`${W}/.venv/bin/pip`, 'install', '--index-url', 'http://evil/', 'x'], ['uv', 'pip', 'install', '--extra-index-url', 'http://evil/', 'x'], ['uv', 'pip', 'install', '--index-url', 'http://evil/', 'x'],
    ['npm', 'i', '--target', '/x', 'p'], [`${W}/.venv/bin/pip`, 'install', '--target', '/x', 'p'], [`${W}/.venv/bin/pip`, 'install', '-e', '.'], [`${W}/.venv/bin/pip`, 'install', '-r', 'req.txt'], ['npm', 'i', '--prefix', '/x', 'p'], ['npm', 'i', '--userconfig', '/x', 'p'], ['pnpm', 'add', '--global-folder', '/x', 'p'],
    ['uv', 'add', '--directory', '/x', 'p'], ['uv', 'add', '--project', '/x', 'p'], ['uv', 'add', '--index-url', 'http://evil/', 'p'], ['cargo', 'add', '--path', '../x'], ['cargo', 'add', '--git', 'http://evil/x'], ['cargo', 'add', '--registry', 'evil', 'x'],
    ['npm', 'i', 'file:/etc'], ['npm', 'i', 'git+ssh://git@evil/x.git'], ['npm', 'i', 'https://evil/x.tgz'], ['npm', 'i', 'x@file:../y'], ['npm', 'i', 'npm:x@1'], ['npm', 'i', 'github:a/b'], ['npm', 'i', '--', 'x'], ['npm', 'i', './x'], ['npm', 'i', '../x'], ['npm', 'i', '/x'], ['npm', 'i', '~/x'], ['npm', 'i', '.'],
    ['go', 'get', './x'], ['go', 'get', 'file:///x'], ['cargo', 'add', '../x'], ['uv', 'add', 'git+http://evil/x'], [`${W}/.venv/bin/pip`, 'install', 'x @ http://evil/x.whl'],
    [`${W}/.venv/bin/pip`, 'install', 'evil.tar.gz'], [`${W}/.venv/bin/pip`, 'install', 'evil.tgz'], ['uv', 'pip', 'install', 'evil.zip'], ['uv', 'pip', 'install', 'x.whl'], ['uv', 'add', 'evil.tar.gz'], ['npm', 'i', 'evil.tgz'], ['npm', 'i', 'x.tar'], ['cargo', 'add', 'x.crate'],
    [`${W}/.venv/bin/pip`, 'install', 'a..b'], [`${W}/.venv/bin/pip`, 'install', '.hidden'], ['uv', 'add', '--group', '-x', 'p'], ['uv', 'add', '--optional', '--evil', 'p']]
  for (const a of bad) assert.equal(typeof P.vet(a, W), 'string', `refused: ${JSON.stringify(a)}`)
  assert.equal(typeof P.vet('npm install x', W), 'string'); assert.match(P.vet(['poetry', 'add', 'x'], W), /poetry cannot be run here: it cannot refuse source builds/)
  const ok = (a) => { const v = P.vet(a, W); assert.equal(typeof v, 'object', `allowed: ${JSON.stringify(a)}`); return v }
  assert.deepEqual(ok(['npm', 'install', '-D', '--no-audit', 'x@>=1', '@scope/y@^2', 'z@latest']), { argv: ['npm', 'install', '-D', '--no-audit', 'x@>=1', '@scope/y@^2', 'z@latest'], env: { npm_config_ignore_scripts: 'true', YARN_ENABLE_SCRIPTS: 'false', YARN_IGNORE_PATH: '1' } })
  assert.deepEqual(ok(['pnpm', 'add', 'x']).argv, ['pnpm', 'add', 'x', '--ignore-pnpmfile']); assert.equal(ok(['yarn', 'add', '--dev', 'x']).env.YARN_ENABLE_SCRIPTS, 'false'); assert.equal(ok(['yarn', 'add', 'x']).env.YARN_IGNORE_PATH, '1')
  assert.ok(ok([`${W}/.venv/bin/pip`, 'install', 'x']).empty && ok(['uv', 'pip', 'install', 'x']).empty && !ok(['uv', 'add', 'x']).empty && !ok(['npm', 'i', 'x']).empty, 'the pip forms run from an empty folder'); assert.equal(ok(['uv', 'pip', 'install', 'x']).env.VIRTUAL_ENV, `${W}/.venv`)
  assert.deepEqual(ok(['uv', 'add', '--group', 'dev', 'pytest==8.0.1']).argv.slice(-1), ['--no-build']); assert.deepEqual(ok(['uv', 'pip', 'install', 'x>=1,<2']).argv.slice(-1), ['--only-binary=:all:'])
  assert.deepEqual(ok([`${W}/.venv/bin/pip`, 'install', 'x[extra]==1.0']).argv.slice(-1), ['--only-binary=:all:']); assert.equal(ok(['go', 'get', 'github.com/a/b@v1.2.3']).env.GOTOOLCHAIN, 'local'); ok(['cargo', 'add', '--dev', '-F', 'derive', 'serde@1'])
})

test('npm install from the registry: the lockfile is committed on the task branch, only manifests, HOME untouched', async () => {
  const f = await fix(); try {
    const main = await sh(f.root, 'git', 'rev-parse', 'main'), before = [statSync(f.home).mtimeMs, listing(f.home)], r = await P.setup(f.h, f.inp())
    assert.match(r.text, /^Installed and committed on your branch: package\.json, package-lock\.json/, r.text); assert.ok(r.done)
    assert.equal(await sh(f.wt, 'git', 'log', '-1', '--format=%s'), 'chore(deps): add the local dependency'); assert.equal(await sh(f.wt, 'git', 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/t-1')
    assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort(), ['package-lock.json', 'package.json'])
    assert.ok(JSON.parse(readFileSync(join(f.wt, 'package.json'), 'utf8')).dependencies['local-dep']); assert.ok(existsSync(join(f.wt, 'node_modules/local-dep/index.js')), 'a successful run keeps what it installed')
    assert.equal(await sh(f.wt, 'git', 'status', '--porcelain'), ''); assert.equal(await sh(f.root, 'git', 'rev-parse', 'main'), main)
    assert.deepEqual([statSync(f.home).mtimeMs, listing(f.home)], before); assert.ok(!existsSync(join(f.d, 'scratch')))
  } finally { f.done() }
})

test('a dirty worktree survives: the worker\'s edits (a tracked file, an untracked one, an edited package.json) are kept byte for byte; a failed run restores them exactly', async () => {
  const f = await fix(); try {
    writeFileSync(join(f.wt, 'a.txt'), 'a edited by the worker\n'); writeFileSync(join(f.wt, 'new.txt'), 'untracked\n'); writeFileSync(join(f.wt, 'package.json'), '{\n "name": "app",\n "version": "1.0.0",\n "description": "mine"\n}\n')
    const files = ['a.txt', 'new.txt', 'package.json'], read = () => files.map(x => readFileSync(join(f.wt, x), 'utf8')), mine = read()
    const failed = await P.setup(f.h, f.inp({ argv: ['npm', 'install', '--no-audit', '--no-fund', 'no-such-package'] }))
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

test('the jail: no host environment variable and nothing of the real home is visible to the install', async () => {
  process.env.GITHUB_TOKEN = 'ghp_fake_token'; process.env.NPM_TOKEN = 'npm_fake'
  const f = await fix(); let seen; try {
    f.h.run = jailed(`env > /tmp/envdump; cat ${f.home}/secret.txt > /tmp/secret 2>&1; ls -A ${f.home} > /tmp/lshome 2>&1; (ls -A /run; ls -A /var/run) > /tmp/lsrun 2>&1; [ -e /run/user ] && echo yes > /tmp/runuser; ls /proc | grep -c '^[0-9]' > /tmp/pids; [ -e /proc/${process.pid} ] && echo yes > /tmp/hostpid; echo ok > /tmp/ran`)
    const orig = f.h.run; f.h.run = async (a, o) => { const r = await orig(a, o); if (a[0] === 'bwrap' && a.includes('--clearenv') && !a.includes('--unshare-net')) { const sc = join(f.d, 'scratch'); seen = Object.fromEntries(['envdump', 'secret', 'lshome', 'ran', 'lsrun', 'runuser', 'pids', 'hostpid'].map(n => [n, existsSync(join(sc, n)) ? readFileSync(join(sc, n), 'utf8') : null])) } return r }
    await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'local-dep'] }))
    assert.equal(seen.ran?.trim(), 'ok', 'the stand-in ran inside the jail'); assert.ok(!/ghp_fake_token|npm_fake/.test(seen.envdump), 'no host variable'); assert.match(seen.envdump, new RegExp(`HOME=${f.d}/scratch/home`)); assert.match(seen.envdump, /npm_config_ignore_scripts=true/)
    assert.equal(seen.lsrun?.trim(), '', 'nothing in /run and /var/run: no docker.sock, user bus or agent socket'); assert.equal(seen.runuser, null); assert.ok(Number(seen.pids) < 10 && seen.hostpid === null, `the host's processes are not visible (${seen.pids?.trim()} pids)`)
    assert.ok(!/real-home-secret/.test(seen.secret) && /No such file/.test(seen.secret), 'the real home is hidden'); assert.ok(!/secret\.txt|\.claude/.test(seen.lshome), seen.lshome)
  } finally { delete process.env.GITHUB_TOKEN; delete process.env.NPM_TOKEN; f.done() }
})

test('changed .npmrc/.pnpmfile.cjs/.yarnrc*/pip.conf/uv.toml/.cargo/config.toml against the base: no install; unchanged ones (the repo\'s own .npmrc) do not matter', async () => {
  const f = await fix(); try {
    for (const p of ['.pnpmfile.cjs', '.yarnrc.yml', 'sub/pip.conf', 'pip.ini', '.cargo/config.toml', '.cargo/config', 'uv.toml', '.npmrc', 'pnpm-workspace.yaml', '.yarn/releases/yarn-4.cjs', '.yarn/plugins/p.cjs']) {
      await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); mkdirSync(join(f.wt, p, '..'), { recursive: true }); writeFileSync(join(f.wt, p), `changed ${p}\n`)   // an uncommitted change is checkpointed first, then judged against the base
      const r = await P.setup(f.h, f.inp()); assert.match(r.text, new RegExp(`^The install was not run: ${p.replaceAll('.', '\\.')} changed in this task`), p); assert.ok(!existsSync(join(f.wt, 'node_modules')))
    }
    for (const [body, refused] of [['[project]\nname = "x"\n', false], ['[[tool.uv.index]]\nurl = "http://evil/simple"\n', true], ['[tool.uv.sources]\nx = { path = "../x" }\n', true], ['[tool.pip]\nextra-index-url = "http://evil"\n', true], ['[tool.uv]\nfind-links = ["x"]\n', true]]) {
      await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); writeFileSync(join(f.wt, 'pyproject.toml'), body); const r = await P.setup(f.h, f.inp())
      assert.equal(/^The install was not run: pyproject\.toml changed/.test(r.text), refused, `${body} -> ${r.text}`)
    }
    await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); assert.match((await P.setup(f.h, f.inp())).text, /^Installed/)
  } finally { f.done() }
})

test('only manifests of the repo root or a unit root are committed; a failed run removes the ignored paths it made, a successful one keeps them', async () => {
  const f = await fix(); try {
    const w = `${f.wt}`, writes = `mkdir -p ${w}/sub ${w}/node_modules/x ${w}/vendor; echo '{"name":"app","dependencies":{"d":"1"}}' > ${w}/package.json; echo '{}' > ${w}/sub/package.json; echo '{}' > ${w}/node_modules/x/package.json; echo '{}' > ${w}/vendor/package.json`
    f.h.run = jailed(writes); const r = await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'x'], roots: ['.'] }))
    assert.ok(r.stray, r.text); assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n'), ['package.json']); assert.ok(!existsSync(join(f.wt, 'sub/package.json')) && !existsSync(join(f.wt, 'vendor/package.json')), 'a manifest elsewhere is discarded')
    assert.ok(existsSync(join(f.wt, 'node_modules/x/package.json')), 'a successful run keeps its ignored paths')
    await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); rmSync(join(f.wt, 'node_modules'), { recursive: true, force: true })
    const r2 = await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'x'], roots: ['.', 'sub'] })); assert.deepEqual((await sh(f.wt, 'git', 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort(), ['package.json', 'sub/package.json'], r2.text)   // a unit root counts
    await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); rmSync(join(f.wt, 'node_modules'), { recursive: true, force: true }); rmSync(join(f.wt, 'sub'), { recursive: true, force: true })
    f.h.run = jailed(`${writes}; exit 3`); const bad = await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'x'] }))
    assert.match(bad.text, /^The install changed nothing: it failed/); assert.ok(!existsSync(join(f.wt, 'node_modules')), 'the ignored paths a failed run made are gone'); assert.equal(await sh(f.wt, 'git', 'status', '--porcelain'), '')
  } finally { f.done() }
})

test('pip runs from an empty folder: a planted archive of the repository is not found by its bare name, and no setup.py runs', async () => {
  const f = await fix(); let seen; try {
    writeFileSync(join(f.wt, 'evil.tar.gz'), 'not a real archive'); writeFileSync(join(f.wt, 'setup.py'), `open('${f.d}/MARKER', 'w').write('ran')\n`); mkdirSync(join(f.wt, 'x')); writeFileSync(join(f.wt, 'x/setup.py'), `open('${f.d}/MARKER', 'w').write('ran')\n`)
    assert.match((await P.setup(f.h, f.inp({ argv: [`${f.wt}/.venv/bin/pip`, 'install', 'evil.tar.gz'] }))).text, /^The install was refused/); assert.ok(!existsSync(join(f.d, 'MARKER')))
    const orig = jailed('ls -A . > /tmp/lscwd; pwd > /tmp/pwd'); f.h.run = async (a, o) => { const r = await orig(a, o); if (a[0] === 'bwrap' && a.includes('--clearenv') && !a.includes('--unshare-net')) { const sc = join(f.d, 'scratch'); seen = { cwd: readFileSync(join(sc, 'lscwd'), 'utf8'), pwd: readFileSync(join(sc, 'pwd'), 'utf8') } } return r }
    await P.setup(f.h, f.inp({ argv: [`${f.wt}/.venv/bin/pip`, 'install', 'x'] }))   // a bare name that is also a folder of the repository
    assert.equal(seen.pwd.trim(), '/tmp/cwd'); assert.equal(seen.cwd.trim(), '', 'the folder pip starts in is empty'); assert.ok(!existsSync(join(f.d, 'MARKER')))
  } finally { f.done() }
})

test('the jail binds back only real folders strictly inside the home, never the whole home', () => {
  const j = G.setupJail({ wt: '/h/w', scratch: '/h/s', pkgRoot: '/h/w', argv: ['x'], scratchHome: '/h/s/home', home: '/h', path: '/h:/h/.nvm/versions/node/v1/bin:/h/.cargo/bin:/usr/bin', tools: ['/h', '/h/.nvm/versions/node/v1/bin', '/h/.cargo/bin', '/usr/bin'] })
  const ro = j.flatMap((x, i) => (x === '--ro-bind' && j[i + 1] !== '/' ? [j[i + 1]] : [])); assert.deepEqual(ro, ['/h/.nvm/versions/node/v1', '/h/.cargo/bin'])
  for (const f of ['--clearenv', '--unshare-pid', '--unshare-ipc', '--die-with-parent']) assert.ok(j.includes(f), f); assert.deepEqual(j.slice(j.indexOf('--tmpfs'), j.indexOf('--tmpfs') + 2), ['--tmpfs', '/run'])
})

test('a failed run removes what it wrote into an ignored folder that was already there, and keeps what was there', async () => {
  const f = await fix(); try {
    mkdirSync(join(f.wt, 'node_modules/old'), { recursive: true }); writeFileSync(join(f.wt, 'node_modules/old/keep.js'), 'k'); writeFileSync(join(f.wt, 'node_modules/loose.js'), 'l')
    f.h.run = jailed(`mkdir -p ${f.wt}/node_modules/old ${f.wt}/node_modules/newpkg/lib; echo n > ${f.wt}/node_modules/old/new.js; echo n > ${f.wt}/node_modules/newpkg/lib/a.js; echo n > ${f.wt}/node_modules/created.js; exit 2`)
    assert.match((await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'x'] }))).text, /^The install changed nothing: it failed/)
    assert.ok(existsSync(join(f.wt, 'node_modules/old/keep.js')) && existsSync(join(f.wt, 'node_modules/loose.js')), 'what was there stays')
    for (const p of ['node_modules/old/new.js', 'node_modules/newpkg', 'node_modules/created.js']) assert.ok(!existsSync(join(f.wt, p)), `${p} is gone`)
  } finally { f.done() }
})
