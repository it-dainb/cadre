// Dev-only (ADR 0003): shared world for tdd-red.test.mjs and tdd-land.test.mjs (not a test file; real bwrap + real git).
import './register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const G = await import('../../core/git.ts')
const V = await import('../../core/specview.ts')
const T = await import('../../core/tdd.ts')
const { fakeHost, task: snap } = await import('../support.ts')
const { defaults } = await import('../../config/defaults.ts')
const { repoKeyOf } = await import('../../commands/init.ts')
const { policyOf } = await import('../../policy/guards.ts')

const run = (argv, init = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: init.cwd, env: init.env ? { ...process.env, ...init.env } : undefined }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })).stdin?.end(init.stdin))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
// scratch is bound AT /tmp; the worktree is bound on top of it, so it may live under /tmp too
const base = () => { const r = join(homedir(), '.cache', 'cadre-test'); mkdirSync(r, { recursive: true }); return mkdtempSync(join(r, 't-')) }

// ---- a repo with a package whose "tests" are json cases run by run.mjs, which writes JUnit to /tmp/cadre/r.xml ----
const RUN = `import {readdirSync,readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs'
const dir='test', cs=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(dir+'/'+f,'utf8'))):[]
const tag=c=>c.status==='failure'?'<failure message="'+c.text+'"/>':c.status==='error'?'<error message="'+c.text+'"/>':c.status==='skipped'?'<skipped/>':''
mkdirSync('/tmp/cadre',{recursive:true}); writeFileSync('/tmp/cadre/r.xml','<testsuite>'+cs.map(c=>'<testcase classname="s" name="'+c.name+'">'+tag(c)+'</testcase>').join('')+'</testsuite>')
process.exit(cs.some(c=>c.status!=='passed')?1:0)
`
function world(over = {}) {
  const b = base(), root = join(b, 'repo'); mkdirSync(root); execFileSync('git', ['init', '-q', '-b', 'dev', root]); sh(root, 'config', 'user.name', 't'); sh(root, 'config', 'user.email', 't@t')
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test')); mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'src/login.ts'), 'export const SECRET_IMPL = 1\n'); writeFileSync(join(root, 'docs/guide.md'), '# guide\n'); writeFileSync(join(root, 'run.mjs'), RUN)
  writeFileSync(join(root, 'test/old.json'), JSON.stringify({ name: 'old', status: 'passed' })); symlinkSync('../src/login.ts', join(root, 'test/link.ts'))
  sh(root, 'add', '-A'); sh(root, 'commit', '-qm', 'init'); sh(root, 'branch', 'epic/e1-x')
  const pkg = { root: '.', setup: [], checks: { test: ['node', 'run.mjs'], knownbad: ['false'] }, verify: ['test'], viewInclude: ['docs/**'], tdd: { paths: ['test/**'], report: '/tmp/cadre/r.xml' }, ...over.pkg }
  const cfg = { ...defaults(), units: [pkg], worktrees: { root: join(b, 'wt') }, jail: 'auto', ...over.cfg }
  if (!over.cover) cfg.review = { ...cfg.review, coverage: { enforce: false } }   // the fixtures name tests 'a', 'login ok'; the coverage rule has its own test
  const meta = {}, comments = [], ctl = { revision: '0', doc: {} }, store = { async setMeta(id, kv) { Object.assign(meta, kv) }, async update(id, p) { if (p.acceptance !== undefined) over.acceptance = p.acceptance },  async control() { return ctl }, async setControl(p) { Object.assign(ctl.doc, p); return ctl }, async move() {}, async resume() {}, async get(id) { return { id, title: 't', type: over.type ?? 'feature', meta: { ...meta }, acceptance: over.acceptance ?? 'S1: Given a When b Then c', description: 'page 1 skips the first page', design: over.design ?? JSON.stringify({ symbols: [{ name: 'login', kind: 'function', params: 'u', returns: 'bool', status: 'new' }] }) } } }
  const h = fakeHost(); Object.assign(h, { run, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, cwd: async () => root, home: async () => b, config: async () => cfg, taskStore: async () => store })
  const d = { store, cfg, reg: cfg.types, root, home: b, wtRoot: cfg.worktrees.root, key: repoKeyOf(root), actor: 'a', session: 's' }
  return { b, root, h, d, meta, comments, store, pkg, acceptance: () => over.acceptance }
}
const mkTask = async w => w.store.get('m-1')
const worktree = async w => { const wt = join(w.d.wtRoot, 'wt1'); mkdirSync(w.d.wtRoot, { recursive: true }); await G.worktreeAdd(run, w.root, wt, 'feat/m-1-x', await G.tip(run, w.root, 'epic/e1-x')); return wt }
const tc = (name, status, text = '') => JSON.stringify({ name, status, text })
const tester = async (w, files, tests, over = {}) => {   // build the view, let the "tester" write files, then testerDone
  const wt = await worktree(w), task = await mkTask(w), view = await V.buildView(w.h, w.d, task, wt)
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(view, f, '..'), { recursive: true }); writeFileSync(join(view, f), c) }
  await w.h.board.update(s => ({ ...s, epic: 'e1', tasks: [snap('m-1', { type: task.type, state: 'active', step: 'tester' })] }))
  w.meta['cadre.base'] = sh(wt, 'rev-parse', 'HEAD')
  return { wt, view, task: await mkTask(w), res: await T.testerDone(w.h, w.d, await mkTask(w), wt, view, tests.map(n => ({ path: 'test/s.json', name: n })), over.agent) }
}

export { G, V, T, snap, fakeHost, defaults, repoKeyOf, policyOf, run, sh, base, RUN, world, mkTask, worktree, tc, tester }
