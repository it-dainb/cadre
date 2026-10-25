// Setup (core/helpers): the argv a requester sent is vetted by allowlist (known flags, registry names only), run jailed in the requester's task folder with a clean environment
// and the real home hidden, and only manifests and lockfiles are committed. Real git, real npm and bwrap; the registry is a tiny local one (127.0.0.1), so nothing leaves the machine.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, realpathSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  const W = '/w', PY = { py: '/usr/bin/python3' }, bad = [['sudo', 'npm', 'install', 'x'], ['npm', 'install', '-g', 'x'], ['npm', 'install', '--global', 'x'], ['npm', 'i', '--location=global', 'x'], ['npm', 'i', '--location', 'global', 'x'], ['npm', 'i', '--global=true', 'x'], ['yarn', 'global', 'add', 'x'],
    ['pnpm', 'add', '-g', 'x'], ['pip', 'install', 'x'], [`${W}/.venv/bin/pip`, 'install', '--user', 'x'], ['/other/.venv/bin/pip', 'install', 'x'], ['/repo/.venv/bin/pip', 'install', 'x'], [`${W}/.venv/bin/pip`, 'install', 'x'], ['cargo', 'install', 'ripgrep'], ['go', 'install', 'x.io/a@latest'], ['pipx', 'install', 'x'],
    ['brew', 'install', 'x'], ['apt', 'install', 'x'], ['npm', 'install', 'x', '|', 'sh'], ['npm', 'install', 'x;', 'rm'], ['npm', 'install', 'x', '&&', 'y'], ['npm install x'], ['npm'], [], ['npm', 'run', 'build'], ['uv', 'tool', 'install', 'x'], ['poetry', 'add', 'x'], ['cargo', 'add', 'x', '>', 'f'],
    ['npm', 'i', '--registry=http://evil/', 'x'], ['npm', 'i', '--registry', 'http://evil/', 'x'], [`${W}/.venv/bin/pip`, 'install', '--index-url', 'http://evil/', 'x'], ['uv', 'pip', 'install', '--extra-index-url', 'http://evil/', 'x'], ['uv', 'pip', 'install', '--index-url', 'http://evil/', 'x'],
    ['npm', 'i', '--target', '/x', 'p'], [`${W}/.venv/bin/pip`, 'install', '--target', '/x', 'p'], [`${W}/.venv/bin/pip`, 'install', '-e', '.'], [`${W}/.venv/bin/pip`, 'install', '-r', 'req.txt'], ['npm', 'i', '--prefix', '/x', 'p'], ['npm', 'i', '--userconfig', '/x', 'p'], ['pnpm', 'add', '--global-folder', '/x', 'p'],
    ['uv', 'add', '--directory', '/x', 'p'], ['uv', 'add', '--project', '/x', 'p'], ['uv', 'add', '--index-url', 'http://evil/', 'p'], ['cargo', 'add', '--path', '../x'], ['cargo', 'add', '--git', 'http://evil/x'], ['cargo', 'add', '--registry', 'evil', 'x'],
    ['npm', 'i', 'file:/etc'], ['npm', 'i', 'git+ssh://git@evil/x.git'], ['npm', 'i', 'https://evil/x.tgz'], ['npm', 'i', 'x@file:../y'], ['npm', 'i', 'npm:x@1'], ['npm', 'i', 'github:a/b'], ['npm', 'i', '--', 'x'], ['npm', 'i', './x'], ['npm', 'i', '../x'], ['npm', 'i', '/x'], ['npm', 'i', '~/x'], ['npm', 'i', '.'],
    ['go', 'get', './x'], ['go', 'get', 'file:///x'], ['cargo', 'add', '../x'], ['uv', 'add', 'git+http://evil/x'], [`${W}/.venv/bin/pip`, 'install', 'x @ http://evil/x.whl'],
    [`${W}/.venv/bin/pip`, 'install', 'evil.tar.gz'], [`${W}/.venv/bin/pip`, 'install', 'evil.tgz'], ['uv', 'pip', 'install', 'evil.zip'], ['uv', 'pip', 'install', 'x.whl'], ['uv', 'add', 'evil.tar.gz'], ['npm', 'i', 'evil.tgz'], ['npm', 'i', 'x.tar'], ['cargo', 'add', 'x.crate'],
    [`${W}/.venv/bin/pip`, 'install', 'a..b'], [`${W}/.venv/bin/pip`, 'install', '.hidden'], ['uv', 'add', '--group', '-x', 'p'], ['uv', 'add', '--optional', '--evil', 'p']]
  for (const a of bad) assert.equal(typeof P.vet(a, W, PY), 'string', `refused: ${JSON.stringify(a)}`)
  assert.equal(typeof P.vet('npm install x', W), 'string'); assert.match(P.vet(['poetry', 'add', 'x'], W), /poetry cannot be run here: it cannot refuse source builds/)
  const ok = (a) => { const v = P.vet(a, W, PY); assert.equal(typeof v, 'object', `allowed: ${JSON.stringify(a)}`); return v }
  assert.deepEqual(ok(['npm', 'install', '-D', '--no-audit', 'x@>=1', '@scope/y@^2', 'z@latest']), { argv: ['npm', 'install', '-D', '--no-audit', 'x@>=1', '@scope/y@^2', 'z@latest'], env: { npm_config_ignore_scripts: 'true', YARN_ENABLE_SCRIPTS: 'false', YARN_IGNORE_PATH: '1', npm_config_manage_package_manager_versions: 'false', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0' } })
  assert.deepEqual(ok(['pnpm', 'add', 'x']).argv, ['pnpm', 'add', 'x', '--ignore-pnpmfile']); assert.equal(ok(['yarn', 'add', '--dev', 'x']).env.YARN_ENABLE_SCRIPTS, 'false'); assert.equal(ok(['yarn', 'add', 'x']).env.YARN_IGNORE_PATH, '1')
  assert.ok(ok(['uv', 'pip', 'install', 'x']).empty && !ok(['uv', 'add', 'x']).empty && !ok(['npm', 'i', 'x']).empty, 'the pip forms run from an empty folder')
  assert.match(P.vet(['uv', 'add', 'x'], W), /no system python/); assert.match(P.vet(['uv', 'pip', 'install', 'x'], W), /no system python/); assert.match(P.vet([`${W}/.venv/bin/pip`, 'install', 'x'], W, PY), /uv pip install or uv add/)
  const u = ok(['uv', 'add', 'x']); assert.equal(u.env.UV_PYTHON, '/usr/bin/python3'); assert.equal(u.env.UV_PROJECT_ENVIRONMENT, '/tmp/venv'); assert.deepEqual(u.argv.slice(-2), ['--no-build', '--no-sync'])
  const up = ok(['uv', 'pip', 'install', 'x']); assert.deepEqual(up.argv.slice(-5), ['--only-binary=:all:', '--python', '/usr/bin/python3', '--prefix', `${W}/.venv`]); assert.ok(!up.env.VIRTUAL_ENV)
  assert.equal(P.vet(['cargo', 'add', 'x'], W, { rust: 'stable-x' }).env.RUSTUP_TOOLCHAIN, 'stable-x')
   assert.ok(ok(['uv', 'pip', 'install', 'x>=1,<2']).argv.includes('--only-binary=:all:'))
  assert.equal(ok(['go', 'get', 'github.com/a/b@v1.2.3']).env.GOTOOLCHAIN, 'local'); ok(['cargo', 'add', '--dev', '-F', 'derive', 'serde@1'])
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
    assert.match(seen.lsrun?.trim(), /^(systemd)?$/, 'nothing in /run and /var/run but the resolver folder DNS needs: no docker.sock, user bus or agent socket'); assert.equal(seen.runuser, null); assert.ok(Number(seen.pids) < 10 && seen.hostpid === null, `the host's processes are not visible (${seen.pids?.trim()} pids)`)
    assert.ok(!/real-home-secret/.test(seen.secret) && /No such file/.test(seen.secret), 'the real home is hidden'); assert.ok(!/secret\.txt|\.claude/.test(seen.lshome), seen.lshome)
  } finally { delete process.env.GITHUB_TOKEN; delete process.env.NPM_TOKEN; f.done() }
})

test('changed .npmrc/.pnpmfile.cjs/.yarnrc*/pip.conf/uv.toml/.cargo/config.toml against the base: no install; unchanged ones (the repo\'s own .npmrc) do not matter', async () => {
  const f = await fix(); try {
    for (const p of ['.pnpmfile.cjs', '.yarnrc.yml', 'sub/pip.conf', 'pip.ini', '.cargo/config.toml', '.cargo/config', 'uv.toml', '.python-version', 'rust-toolchain', 'rust-toolchain.toml', '.npmrc', 'pnpm-workspace.yaml', '.yarn/releases/yarn-4.cjs', '.yarn/plugins/p.cjs']) {
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

test('uv pip runs from an empty folder: a planted archive of the repository is not found by its bare name, and no setup.py runs', async () => {
  const f = await fix(); let seen; try {
    writeFileSync(join(f.wt, 'evil.tar.gz'), 'not a real archive'); writeFileSync(join(f.wt, 'setup.py'), `open('${f.d}/MARKER', 'w').write('ran')\n`); mkdirSync(join(f.wt, 'x')); writeFileSync(join(f.wt, 'x/setup.py'), `open('${f.d}/MARKER', 'w').write('ran')\n`)
    assert.match((await P.setup(f.h, f.inp({ argv: ['uv', 'pip', 'install', 'evil.tar.gz'] }))).text, /^The install was refused/); assert.ok(!existsSync(join(f.d, 'MARKER')))
    const orig = jailed('ls -A . > /tmp/lscwd; pwd > /tmp/pwd'); f.h.run = async (a, o) => { const r = await orig(a, o); if (a[0] === 'bwrap' && a.includes('--clearenv') && !a.includes('--unshare-net')) { const sc = join(f.d, 'scratch'); seen = { cwd: readFileSync(join(sc, 'lscwd'), 'utf8'), pwd: readFileSync(join(sc, 'pwd'), 'utf8') } } return r }
    await P.setup(f.h, f.inp({ argv: ['uv', 'pip', 'install', 'x'] }))   // a bare name that is also a folder of the repository
    assert.equal(seen.pwd.trim(), '/tmp/cwd'); assert.equal(seen.cwd.trim(), '', 'the folder pip starts in is empty'); assert.ok(!existsSync(join(f.d, 'MARKER')))
  } finally { f.done() }
})

test('the jail binds back only real folders strictly inside the home, never the whole home', () => {
  const j = G.setupJail({ wt: '/h/w', scratch: '/h/s', pkgRoot: '/h/w', argv: ['x'], scratchHome: '/h/s/home', home: '/h', path: '/h:/h/.nvm/versions/node/v1/bin:/h/.cargo/bin:/usr/bin', tools: ['/h', '/h/.nvm/versions/node/v1/bin', '/h/.cargo/bin', '/usr/bin', '/h/w/node_modules/.bin', '/h/s/bin'] })
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

test('nothing the toolchain executes comes from the worktree: a planted .venv python and a .python-version are not run, the old .venv pip form is refused, the host outside the system folders is hidden', async () => {
  const f = await fix(); let seen; try {
    const mark = join(f.d, 'MARKER'); mkdirSync(join(f.wt, '.venv/bin'), { recursive: true }); for (const n of ['python', 'python3', 'pip']) writeFileSync(join(f.wt, '.venv/bin', n), `#!/bin/sh\necho ran > ${mark}\n`, { mode: 0o755 })
    writeFileSync(join(f.wt, 'py'), `#!/bin/sh\necho ran > ${mark}\n`, { mode: 0o755 }); writeFileSync(join(f.wt, '.python-version'), './py\n')
    assert.match((await P.setup(f.h, f.inp({ argv: [`${f.wt}/.venv/bin/pip`, 'install', 'x'] }))).text, /^The install was refused.*uv pip install or uv add/); assert.ok(!existsSync(mark))
    assert.match((await P.setup(f.h, f.inp())).text, /^The install was not run: \.python-version changed/)   // committed since the base, so nothing runs
    await sh(f.wt, 'git', 'reset', '-q', '--hard', 'main'); await sh(f.wt, 'git', 'clean', '-fdq')
    const outside = '/var/tmp/cadre-hidden-' + process.pid; writeFileSync(outside, 'host-file')
    try {
      const orig = jailed(`cat ${outside} > /tmp/hid 2>&1; echo $UV_PYTHON $UV_PROJECT_ENVIRONMENT > /tmp/uvenv; ls /usr/bin/python3 > /tmp/py 2>&1; for t in npm node uv; do command -v $t; done > /tmp/tools`)
      f.h.run = async (a, o) => { const r = await orig(a, o); if (a[0] === 'bwrap' && a.includes('--clearenv') && !a.includes('--unshare-net')) { const sc = join(f.d, 'scratch'); seen = Object.fromEntries(['hid', 'uvenv', 'tools'].map(n => [n, readFileSync(join(sc, n), 'utf8')])) } return r }
      await P.setup(f.h, f.inp({ argv: ['uv', 'add', 'x'] }))
    } finally { rmSync(outside, { force: true }) }
    assert.match(seen.hid, /No such file/); assert.match(seen.uvenv, /^\/usr\/\S*python3\S* \/tmp\/venv/); assert.match(seen.tools, /npm[\s\S]*node[\s\S]*uv/); assert.ok(!existsSync(mark))
  } finally { f.done() }
})

test('an ignored .yarnrc.yml or .cargo/config.toml (not in the diff) stops the install too; one inside node_modules does not', async () => {
  const f = await fix(); try {
    const ex = await sh(f.wt, 'git', 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'); writeFileSync(ex, '.yarnrc.yml\n.cargo/\n')
    for (const p of ['.yarnrc.yml', 'sub/.cargo/config.toml']) {
      mkdirSync(join(f.wt, p, '..'), { recursive: true }); writeFileSync(join(f.wt, p), 'x\n'); if (p.startsWith('sub')) writeFileSync(join(f.wt, '.gitignore'), 'node_modules\n'), writeFileSync(ex, '.yarnrc.yml\n.cargo/\n')
      assert.equal(await sh(f.wt, 'git', 'status', '--porcelain', '--', p), ''); const r = await P.setup(f.h, f.inp()); assert.match(r.text, new RegExp(`^The install was not run: ${p.replaceAll('.', '\\.')}`), r.text)
      rmSync(join(f.wt, p), { force: true })
    }
    mkdirSync(join(f.wt, 'node_modules/p'), { recursive: true }); writeFileSync(join(f.wt, 'node_modules/p/.npmrc'), 'x\n'); assert.match((await P.setup(f.h, f.inp())).text, /^Installed/)
  } finally { f.done() }
})

test('the git runner: a tree whose .git was swapped for a directory with core.fsmonitor is refused and nothing runs; linked worktrees and the repo itself work', async () => {
  const f = await fix(); try {
    const g = G.guardedRun(run, async () => f.root), mark = join(f.d, 'MARKER'), script = join(f.d, 'mon.sh'); writeFileSync(script, `#!/bin/sh\necho ran > ${mark}\n`, { mode: 0o755 })
    assert.equal((await g(['git', '-C', f.wt, 'status', '--porcelain'])).exitCode, 0); assert.equal((await g(['git', '-C', f.root, 'status', '--porcelain'])).exitCode, 0); assert.equal((await g(['git', 'status'], { cwd: f.wt })).exitCode, 0)
    const hook = join(f.root, '.git/hooks/pre-commit'), hm = join(f.d, 'HOOK'); writeFileSync(hook, `#!/bin/sh\necho ran > ${hm}\n`, { mode: 0o755 }); writeFileSync(join(f.root, 'b.txt'), 'b\n'); await sh(f.root, 'git', 'add', 'b.txt')
    assert.equal((await g(['git', '-C', f.root, 'commit', '-qm', 'b'])).exitCode, 0); assert.ok(existsSync(hm), "the repo's own hook still runs")
    rmSync(join(f.wt, '.git')); await sh(f.d, 'git', 'init', '-q', f.wt); await sh(f.wt, 'git', 'config', 'core.fsmonitor', script)
    await run(['git', '-C', f.wt, 'status']); assert.ok(existsSync(mark), 'unguarded, the planted config runs'); rmSync(mark)
    const r = await g(['git', '-C', f.wt, 'status']); assert.notEqual(r.exitCode, 0); assert.match(r.stderr, /not a working folder/); assert.ok(!existsSync(mark))
    assert.notEqual((await g(['git', 'status'], { cwd: f.wt })).exitCode, 0); assert.ok(!existsSync(mark))
    rmSync(join(f.wt, '.git'), { recursive: true }); writeFileSync(join(f.wt, '.git'), `gitdir: ${f.d}\n`); assert.notEqual((await g(['git', '-C', f.wt, 'status'])).exitCode, 0)   // a file that names a git dir elsewhere
    await sh(f.root, 'git', 'config', 'core.fsmonitor', script); assert.equal((await g(['git', '-C', f.root, 'status'])).exitCode, 0); assert.ok(!existsSync(mark), 'the flags switch the monitor off even in the repo\'s own config')
  } finally { f.done() }
})

// uv add --no-sync only edits the manifest and lockfile; the reply says the packages are in the folder, so they must be (the fake uv stands in for the registry; the jail is real)
test('uv add: the reply and its effect agree: "in your folder" only when the packages are in the worktree\'s own .venv (wheels only, from an empty folder)', async () => {
  const f = await fix(); try {
    const bin = join(f.d, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'uv'), `#!/bin/sh
echo "$PWD $*" >> /tmp/uvlog
c=$1; shift; P=; Y=; for a; do [ "$p" = --prefix ] && P=$a; [ "$p" = --python ] && Y=$a; p=$a; done
case $c in
  add) printf 'dependencies = ["six"]\\n' >> pyproject.toml; echo lock > uv.lock;;
  export) printf 'six==1.17.0 \\\\\\n    --hash=sha256:abc\\n' > /tmp/req.txt;;
  venv) for a; do d=$a; done; mkdir -p "$d/lib/python3/site-packages" "$d/bin"; echo home > "$d/pyvenv.cfg"; echo "*" > "$d/.gitignore"; : > "$d/bin/python";;
  pip) for a in "$@"; do case $a in -r) R=1;; esac; done; [ -n "$R" ] || exit 1; mkdir -p "$P/lib/python3/site-packages/six" "$P/bin"; : > "$P/lib/python3/site-packages/six/__init__.py"; printf '#!%s\\nprint(1)\\n' "$Y" > "$P/bin/tool"; chmod +x "$P/bin/tool"; n=$(printf 'x\\nmanage.py'); printf '#!%s\\nprint(1)\\n' "$Y" > "$P/bin/$n";;
esac\n`, { mode: 0o755 })
    f.h.env = async () => ({ PATH: `${bin}:${process.env.PATH}`, LANG: process.env.LANG })
    const calls = [], orig = f.h.run; f.h.run = async (a, o) => { const r = await orig(a, o); if (a[0] === 'bwrap' && existsSync(join(f.d, 'scratch/uvlog'))) { calls.push(...readFileSync(join(f.d, 'scratch/uvlog'), 'utf8').split('\n').filter(Boolean)); rmSync(join(f.d, 'scratch/uvlog')) } return r }
    writeFileSync(join(f.wt, 'pyproject.toml'), '[project]\nname = "x"\ndependencies = []\n'); await sh(f.wt, 'git', 'add', '-A'); await sh(f.wt, 'git', 'commit', '-qm', 'py')
    // a file named "x\nmanage.py" in .venv/bin must not stand for ./manage.py of the folder the host runs in (the user's repo root)
    const here = process.cwd(), py = realpathSync('/usr/bin/python3'), top = join(f.d, 'top'); mkdirSync(top); writeFileSync(join(top, 'manage.py'), `#!${py}\nprint(1)\n`); process.chdir(top)
    const r = await P.setup(f.h, f.inp({ argv: ['uv', 'add', 'six'] })).finally(() => process.chdir(here)), site = join(f.wt, '.venv/lib/python3/site-packages/six/__init__.py')
    assert.match(r.text, /^Installed and committed on your branch: pyproject\.toml, uv\.lock/, r.text)
    assert.equal(readFileSync(join(top, 'manage.py'), 'utf8'), `#!${py}\nprint(1)\n`, 'the top-level script is untouched'); assert.ok(readFileSync(join(f.wt, '.venv/bin', 'x\nmanage.py'), 'utf8').startsWith(`#!${py}`), 'the odd name is skipped, not rewritten')
    assert.equal(/in your folder/.test(r.text), existsSync(site), 'the reply claims what happened'); assert.ok(existsSync(site))
    assert.ok(calls.some(l => l.startsWith('/tmp/cwd pip install --python') && l.includes('--only-binary=:all:') && l.includes('--require-hashes') && l.includes(`--prefix ${f.wt}/.venv`) && l.endsWith(' -r /tmp/req.txt')), calls.join('\n')); assert.ok(calls.some(l => l.endsWith(` export --frozen --no-emit-project --output-file /tmp/req.txt`) && !l.startsWith('/tmp/cwd')), calls.join('\n')); assert.equal(readFileSync(join(f.wt, '.venv/bin/tool'), 'utf8').split('\n')[0], `#!${f.wt}/.venv/bin/python`, 'a console script runs the venv\'s python'); assert.ok(calls.some(l => /^\/tmp\/cwd venv --python \S+ .*\.venv$/.test(l)))
  } finally { f.done() }
})

test('uv add: a .venv that is a link is refused before anything runs', async () => {
  const f = await fix(); try {
    mkdirSync(join(f.d, 'elsewhere')); symlinkSync(join(f.d, 'elsewhere'), join(f.wt, '.venv')); const seen = []; const orig = f.h.run; f.h.run = async (a, o) => { seen.push(a.includes('--clearenv') ? 'jail' : a[0]); return orig(a, o) }
    assert.match((await P.setup(f.h, f.inp({ argv: ['uv', 'add', 'six'] }))).text, /^The install was not run: \.venv in your folder is a link/); assert.ok(!seen.includes('jail'), 'no jail ran')
  } finally { f.done() }
})

test('npm install in a repo that does not ignore node_modules: the packages stay in the folder, as the reply says', async () => {
  const f = await fix(); try {
    await sh(f.wt, 'git', 'rm', '-q', '.gitignore'); await sh(f.wt, 'git', 'commit', '-qm', 'no ignore'); assert.ok(!existsSync(join(f.wt, '.gitignore')))
    const r = await P.setup(f.h, f.inp()), dep = join(f.wt, 'node_modules/local-dep/package.json')
    assert.match(r.text, /^Installed and committed on your branch: package\.json, package-lock\.json/, r.text)
    assert.equal(/in your folder/.test(r.text), existsSync(dep), 'the reply claims what happened'); assert.ok(existsSync(dep)); assert.ok(r.done && !r.stray)
    assert.equal(await sh(f.wt, 'git', 'ls-files', 'node_modules'), '', 'node_modules is not committed')
  } finally { f.done() }
})

test('npm: a failed install leaves info/exclude as it was; a refused one never touches it', async () => {
  const f = await fix(); try {
    const ex = await sh(f.wt, 'git', 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'); mkdirSync(join(ex, '..'), { recursive: true }); const was = existsSync(ex) ? readFileSync(ex, 'utf8') : null
    await sh(f.wt, 'git', 'rm', '-q', '.gitignore'); await sh(f.wt, 'git', 'commit', '-qm', 'no ignore')
    assert.match((await P.setup(f.h, f.inp({ argv: ['npm', 'install', 'no-such-package-here'] }))).text, /^The install changed nothing/)
    assert.equal(existsSync(ex) ? readFileSync(ex, 'utf8') : null, was, 'restored after the failure')
    assert.match((await P.setup(f.h, f.inp({ argv: ['npm', 'install', '-g', 'x'] }))).text, /^The install was refused/); assert.equal(existsSync(ex) ? readFileSync(ex, 'utf8') : null, was, 'untouched by a refusal')
  } finally { f.done() }
})

// the folder's own .venv/bin leads PATH for checks (like node_modules/.bin): what an install put there is what runs, in every jail mode
test('checkRun: .venv/bin of the folder is first on PATH, in the jail (overlay or copy) and unjailed; without it nothing changes', async () => {
  const f = await fix(); try {
    mkdirSync(join(f.wt, '.venv/bin'), { recursive: true }); writeFileSync(join(f.wt, '.venv/bin/venvtool'), '#!/bin/sh\necho from-venv\n', { mode: 0o755 })
    const mode = await G.jailMode(run), sc = join(f.d, 'sc'); mkdirSync(sc)
    for (const m of [...new Set([mode, 'none'])]) {
      const r = await G.checkRun(run, m, { wt: f.wt, scratch: sc, pkgRoot: f.wt, argv: ['venvtool'] }); assert.equal(r.stdout.trim(), 'from-venv', `${m}: ${r.stderr}`)
    }
    rmSync(join(f.wt, '.venv'), { recursive: true }); assert.notEqual((await G.checkRun(run, 'none', { wt: f.wt, scratch: sc, pkgRoot: f.wt, argv: ['venvtool'] })).exitCode, 0)
  } finally { f.done() }
})

test('npm ci: refused while node_modules exists; in a worktree whose lockfile already lists the package it installs it, the reply says so and nothing is committed', async () => {
  const f = await fix(); try {
    const first = await P.setup(f.h, f.inp()); assert.match(first.text, /^Installed and committed/)
    assert.match((await P.setup(f.h, f.inp({ argv: ['npm', 'ci'] }))).text, /^The install was not run: node_modules is already there, and npm ci would delete it/); assert.ok(existsSync(join(f.wt, 'node_modules/local-dep/package.json')), 'a refused ci leaves node_modules alone')
    rmSync(join(f.wt, 'node_modules'), { recursive: true })
    const r = await P.setup(f.h, f.inp({ argv: ['npm', 'ci'], ask: 'install what the lockfile lists' }))
    assert.match(r.text, /^Nothing to commit: the manifest and lockfile already list them, and the packages are installed in your folder/, r.text); assert.ok(r.done)
    assert.ok(existsSync(join(f.wt, 'node_modules/local-dep/package.json')), 'installed')
  } finally { f.done() }
})

// the unit's offline check after an install: a check that was red already (a task's locked spec tests are red until the work is done) does not undo the install; one that turns red because of it does
test('offline check: red before and after: the install stays; green before, red after: it is undone and nothing is left', async () => {
  const f = await fix(); try {
    const kept = await P.setup(f.h, f.inp({ check: ['sh', '-c', 'exit 1'] })); assert.match(kept.text, /^Installed and committed on your branch: package\.json, package-lock\.json\. The installed packages are in your folder\. The checks were already failing before it, so the install could not be verified by them\.$/, kept.text); assert.ok(kept.done)
    assert.ok(existsSync(join(f.wt, 'node_modules/local-dep/package.json')))
  } finally { f.done() }
  const g = await fix(); try {
    const r = await P.setup(g.h, g.inp({ check: ['sh', '-c', 'test ! -d node_modules'] })); assert.match(r.text, /^The install changed nothing: the offline check passed before it and failed after it/, r.text)
    assert.ok(!existsSync(join(g.wt, 'node_modules')), 'nothing left'); assert.equal(await sh(g.wt, 'git', 'status', '--porcelain'), '')
  } finally { g.done() }
})

// a check run that throws: before the install it counts as red (nothing was changed yet, the install goes on and says it was not verified); after it, it undoes the install through the same path as a failed check
test('offline check that throws: before the install it counts as red; after a green before-run it undoes the install and restores the tree', async () => {
  const check = (f, throwFrom) => { let n = 0; const orig = f.h.run; f.h.run = async (a, o) => { if (a.includes('--unshare-net') && ++n >= throwFrom) throw new Error('the sandbox died'); return orig(a, o) } }
  const f = await fix(); try {
    check(f, 1); const r = await P.setup(f.h, f.inp({ check: ['true'] })); assert.match(r.text, /^Installed and committed on your branch.*could not be verified by them\.$/, r.text)
  } finally { f.done() }
  const g = await fix(); try {
    const ex = await sh(g.wt, 'git', 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'); mkdirSync(join(ex, '..'), { recursive: true }); const was = existsSync(ex) ? readFileSync(ex, 'utf8') : null
    await sh(g.wt, 'git', 'rm', '-q', '.gitignore'); await sh(g.wt, 'git', 'commit', '-qm', 'no ignore')
    check(g, 2); const r = await P.setup(g.h, g.inp({ check: ['true'] })); assert.match(r.text, /^The install changed nothing: the offline check passed before it and failed after it \(Error: the sandbox died\)/, r.text)
    assert.equal(await sh(g.wt, 'git', 'status', '--porcelain'), ''); assert.ok(!existsSync(join(g.wt, 'node_modules'))); assert.equal(existsSync(ex) ? readFileSync(ex, 'utf8') : null, was, 'the ignore line is put back')
  } finally { g.done() }
})
