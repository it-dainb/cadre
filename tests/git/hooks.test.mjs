// Dev-only: delivery hooks (plan 2.7) on real git: closing a task runs the task.closed hooks in a working folder cut at the epic tip, core audits and commits what they
// changed with the static template, and the commit lands on the epic branch by CAS. A failing hook raises hook-failed; Retry runs it again, Skip gives it up.
// node --experimental-transform-types --test tests/git/hooks.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost, task } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { admitWith } = await import('../../core/admission.ts')
const C = await import('../../core/close.ts')
const { handleWith } = await import('../../tools/index.ts')
const { retryHooks } = await import('../../core/hooks.ts')
const { skeleton } = await import('../../modules/changelog.mjs')
const PL = await import('../../core/pipeline.ts'), { sessionProfile } = await import('../dev/register.mjs')
const { repoKeyOf } = await import('../../commands/init.ts')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const DESIGN = JSON.stringify({ items: [{ name: 'f', kind: 'fn', params: [], returns: 'x', status: 'new' }] })
const hooks = h => PL.setProfile({ ...sessionProfile, hooks: h })
const node = (code, commit) => ({ run: ['node', '-e', code], ...(commit ? { commit } : {}) })

// a repo with CHANGELOG.md and an epic branch; one task, reviewed and passed, waiting for its close
async function world(entry = { category: 'Added', entry: 'did it' }) {
  PL.setProfile(sessionProfile)
  const d = mkdtempSync(join(tmpdir(), 'cadre-hook-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'a.txt'), 'a\n'); writeFileSync(join(d, 'CHANGELOG.md'), skeleton()); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'; cfg.units = [{ root: '.', verify: ['verify'], checks: { verify: ['true'], test: ['true'] } }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal')
  const id = (await store.createDraft({ title: 'task 0', description: 'd', acceptance: 'S1: Given x When y Then z', design: DESIGN, type: 'refactor', parent: epic, meta: { 'cadre.package': '.', 'cadre.changelog': JSON.stringify(entry) } })).id
  await store.approve([epic, id])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async (p, o) => (existsSync(p) ? { kind: 'dir', realPath: o?.resolve ? realpathSync(p) : undefined } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => (existsSync(p) ? execFileSync('cat', [p], { encoding: 'utf8' }) : null) })
  const dep = { store, cfg, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' })); h.taskStore = async () => store; h.config = async () => cfg
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: 'p1', slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: [task(id, { title: 'task 0', type: 'refactor' })] }))
  let n = 0; const next = async e => ({ agentId: `ag${++n}`, model: 'm', echo: e })
  const spawn = () => admitWith(h, dep, { prompt: `work on ${id}` }, next), rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  await spawn(); writeFileSync(join((await store.get(id)).meta['cadre.worktree'], 'b.txt'), 'b\n'); await rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' }); await spawn()
  await rep('ag2', { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', ok: true }], contractStatus: [{ name: 'f', ok: true }] })
  const flags = async () => (await h.board.read()).tasks.find(t => t.id === id).flags, dirs = { root: d, wtRoot: `${d}-wt`, key: 'k' }
  return { d, h, dep, store, id, flags, dirs, epicTip: () => sh(d, 'rev-parse', 'epic/p1-x'), subjects: n2 => sh(d, 'log', `-${n2}`, '--format=%s', 'epic/p1-x').split('\n'), left: () => sh(d, 'worktree', 'list').split('\n').length }
}

test('closing a task runs the changelog hook once and commits its entry on the epic branch with the template (B6); no worktree is left', async () => {
  const w = await world(), old = w.epicTip(); assert.equal(await C.closeTask(w.h, w.dep, w.id), null)
  assert.equal(sh(w.d, 'rev-list', '--count', `${old}..epic/p1-x`), '2', 'the squash and one hook commit')
  assert.deepEqual(w.subjects(2), [`docs(changelog): ${w.id}`, 'refactor: task 0']); assert.equal(sh(w.d, 'show', 'epic/p1-x:b.txt'), 'b')
  assert.match(sh(w.d, 'show', 'epic/p1-x:CHANGELOG.md'), new RegExp(`### Added\\n\\n- did it \\(${w.id}\\)`)); assert.equal((sh(w.d, 'show', 'epic/p1-x:CHANGELOG.md').match(/did it/g) ?? []).length, 1)
  assert.equal(sh(w.d, 'rev-parse', 'dev'), old); assert.equal(w.left(), 1); assert.deepEqual(await w.flags(), [])
})
test('a none decision, or empty hooks, commit nothing and the task still lands', async () => {
  const a = await world({ none: true, reason: 'internal' }), oldA = a.epicTip(); assert.equal(await C.closeTask(a.h, a.dep, a.id), null)
  assert.equal(sh(a.d, 'rev-list', '--count', `${oldA}..epic/p1-x`), '1')   // the hook ran and changed nothing
  const b = await world(); hooks({}); const oldB = b.epicTip(); assert.equal(await C.closeTask(b.h, b.dep, b.id), null)
  assert.equal(sh(b.d, 'rev-list', '--count', `${oldB}..epic/p1-x`), '1'); assert.equal((await b.h.board.read()).tasks[0].state, 'done'); assert.deepEqual(await b.flags(), [])
})
test('a hook that changes a path under .cadre/ or .git/, or moves the branch itself, is refused by the audit: nothing lands, hook-failed', async () => {
  for (const code of ["require('fs').mkdirSync('.cadre', { recursive: true }); require('fs').writeFileSync('.cadre/x.json', '{}')", "require('fs').writeFileSync('.mcp.json', '{}')",
    "require('child_process').execFileSync('git', ['-c', 'user.name=h', '-c', 'user.email=h@h', 'commit', '--allow-empty', '-qm', 'mine'])"]) {
    const w = await world(); hooks({ 'task.closed': [node(code, 'docs: ${id}')] }); const old = w.epicTip(); assert.equal(await C.closeTask(w.h, w.dep, w.id), null)   // the close itself stands
    assert.equal(sh(w.d, 'rev-list', '--count', `${old}..epic/p1-x`), '1', code); assert.deepEqual(await w.flags(), ['hook-failed']); assert.equal(w.left(), 1)
  }
})
test('a hook that changes files but has no commit message, exits non-zero, or writes a result of the wrong shape raises hook-failed', async () => {
  for (const x of [node("require('fs').writeFileSync('n.txt', 'x')"), node('process.exit(3)', 'x'), node("require('fs').writeFileSync(process.env.CADRE_RESULT, JSON.stringify({ colour: 1 }))", 'x'), node("require('fs').writeFileSync(process.env.CADRE_RESULT, JSON.stringify({ version: 'v1' }))", 'x')]) {
    const w = await world(); hooks({ 'task.closed': [x] }); const old = w.epicTip(); assert.equal(await C.closeTask(w.h, w.dep, w.id), null)
    assert.equal(sh(w.d, 'rev-list', '--count', `${old}..epic/p1-x`), '1', x.run[2]); assert.deepEqual(await w.flags(), ['hook-failed'])
  }
})
test('Retry clears the flag and the next tick runs the hook once more (a second failure raises it again); Skip gives it up', async () => {
  const w = await world(); hooks({ 'task.closed': [node('process.exit(1)', 'x')] }); await C.closeTask(w.h, w.dep, w.id); assert.deepEqual(await w.flags(), ['hook-failed'])
  await retryHooks(w.h, w.dirs); assert.deepEqual(await w.flags(), ['hook-failed'])   // the flag is open: nothing runs
  assert.equal((await C.resolveFlag(w.h, w.id, 'r')).ok, true); assert.deepEqual(await w.flags(), [])
  await retryHooks(w.h, w.dirs); assert.deepEqual(await w.flags(), ['hook-failed'])   // it ran again and failed again
  hooks({ 'task.closed': [node("require('fs').writeFileSync('n.txt', process.env.CADRE_INPUT.length ? 'x' : '')", 'docs: note for ${id}')] })
  assert.equal((await C.resolveFlag(w.h, w.id, 'r')).ok, true); await retryHooks(w.h, w.dirs)
  assert.deepEqual(await w.flags(), []); assert.equal(w.subjects(1)[0], `docs: note for ${w.id}`); assert.equal(sh(w.d, 'show', 'epic/p1-x:n.txt'), 'x')
  await retryHooks(w.h, w.dirs); assert.equal(sh(w.d, 'rev-list', '--count', 'epic/p1-x'), String(Number(sh(w.d, 'rev-list', '--count', 'epic/p1-x~1')) + 1))   // the record is gone: no third run
  const s = await world(); hooks({ 'task.closed': [node('process.exit(1)', 'x')] }); await C.closeTask(s.h, s.dep, s.id)
  assert.equal((await C.resolveFlag(s.h, s.id, 's')).ok, true); hooks({ 'task.closed': [node("require('fs').writeFileSync('n.txt', 'x')", 'x')] }); const at = s.epicTip(); await retryHooks(s.h, s.dirs)
  assert.deepEqual(await s.flags(), []); assert.equal(s.epicTip(), at)   // skipped: it never runs again
})
test('hooks run serially in order, each over what the one before committed; a version a hook names reaches the next as ${version}', async () => {
  const w = await world(); hooks({ 'task.closed': [node("require('fs').writeFileSync('one.txt', '1')", 'docs: one ${id} ${title}'), node("require('fs').writeFileSync('two.txt', require('fs').existsSync('one.txt') ? 'saw one' : 'blind')", 'docs: two')] })
  await C.closeTask(w.h, w.dep, w.id); assert.deepEqual(w.subjects(3), ['docs: two', `docs: one ${w.id} task 0`, 'refactor: task 0']); assert.equal(sh(w.d, 'show', 'epic/p1-x:two.txt'), 'saw one')
})
test('the input file holds the closed task: its id, title, type, branch and the profile fields it has', async () => {
  const w = await world(); hooks({ 'task.closed': [node("require('fs').writeFileSync('seen.json', require('fs').readFileSync(process.env.CADRE_INPUT, 'utf8'))", 'docs: seen')] }); await C.closeTask(w.h, w.dep, w.id)
  const seen = JSON.parse(sh(w.d, 'show', 'epic/p1-x:seen.json')); assert.deepEqual([seen.event, seen.id, seen.title, seen.type, seen.branch], ['task.closed', w.id, 'task 0', 'refactor', 'epic/p1-x']); assert.equal(JSON.parse(seen.fields.changelog).entry, 'did it')
})
