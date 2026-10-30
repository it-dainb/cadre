// Dev-only: the docs profile end to end on real git + MemoryStore: writer -> critic -> integrate. No tester, no checks, no changelog hook; the task lands on its epic branch.
// The profile is the built-in `docs` one, loaded by core/profile.loadProfile like any layer (generality proof, plan 2.12).
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost, task } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { MemoryStore } = await import('../../task-management/adapters/memory/store.ts')
const { admitWith } = await import('../../core/admission.ts')
const C = await import('../../core/close.ts')
const { handleWith } = await import('../../tools/index.ts')
const { loadProfile, resetProfile } = await import('../../core/profile.ts')
const PL = await import('../../core/pipeline.ts'), { sessionProfile: DEFAULT } = await import('../dev/register.mjs')

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()

async function world() {
  const d = mkdtempSync(join(tmpdir(), 'cadre-docs-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  writeFileSync(join(d, 'a.txt'), 'a\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p1-x', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.jail = 'off'; cfg.profile = 'docs'; cfg.units = [{ root: '.' }]
  const store = new MemoryStore(); await store.init({ types: {}, journal: true })
  const epic = await store.createEpic('E', 'goal'), ids = [(await store.createDraft({ title: 'write the guide', description: 'a guide for new readers', acceptance: 'S1: Given a reader When they follow it Then they can install', type: 'doc', parent: epic, meta: { 'cadre.package': '.' } })).id]
  await store.approve([epic, ...ids])
  const h = fakeHost(); let tick = 0
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => (tick += 1000), stat: async p => (existsSync(p) ? { kind: 'dir' } : undefined), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) }, readText: async p => (existsSync(p) ? readFileSync(p, 'utf8') : null) })
  h.config = async () => cfg; h.taskStore = async () => store
  const loaded = await loadProfile(h); PL.setProfile(loaded.profile)
  const dep = { store, cfg, root: d, home: d, wtRoot: `${d}-wt`, key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  await h.secret.update(x => ({ ...x, session: 's1' }))
  const ts = await Promise.all(ids.map(async id => { const t = await store.get(id); return task(id, { title: t.title, type: t.type }) }))
  await h.board.update(s => ({ ...s, seq: 1, epic, plan: { id: 'p1', slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: ts }))
  let n2 = 0; const next = async e => ({ agentId: `ag${++n2}`, model: 'm', echo: e })
  const spawn = id => admitWith(h, dep, { prompt: `work on ${id}` }, next)
  const rep = (agentId, body) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result)
  return { d, h, dep, store, ids, spawn, rep, loaded }
}

test('writer -> critic -> integrate: the doc task lands on its epic branch with no tester, no gate call and no changelog', async () => {
  const w = await world(), id = w.ids[0], { h, store, d } = w
  try {
    assert.deepEqual(w.loaded.profile.types.doc.pipeline, ['write', 'review', 'land']); assert.equal(w.loaded.name, 'docs'); assert.equal('tester' in w.loaded.profile.roles, false)
    const a = await w.spawn(id); assert.equal(a.agentId, 'ag1'); assert.equal(a.echo.subagentType, 'cadre:writer')
    let t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['active', 'write'])
    const wt = (await store.get(id)).meta['cadre.worktree']; writeFileSync(join(wt, 'GUIDE.md'), '# Guide\nInstall it.\n')
    assert.match(await w.rep('ag1', { role: 'writer', outcome: 'done', summary: 'wrote the guide' }), /report accepted/)
    t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'review'])
    const b = await w.spawn(id); assert.equal(b.echo.subagentType, 'cadre:critic'); assert.match(b.echo.prompt, /GUIDE\.md/)
    assert.match(await w.rep('ag2', { role: 'critic', verdict: 'pass', summary: 'clear', findings: [] }), /pass@/)
    t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['review', 'land'])
    const old = sh(d, 'rev-parse', 'epic/p1-x'); assert.equal(await C.closeTask(h, w.dep, id), null)
    assert.notEqual(sh(d, 'rev-parse', 'epic/p1-x'), old); assert.equal(sh(d, 'show', 'epic/p1-x:GUIDE.md'), '# Guide\nInstall it.')
    assert.match(sh(d, 'log', '-1', '--format=%s', 'epic/p1-x'), /^docs: write the guide/); assert.equal(existsSync(join(d, 'CHANGELOG.md')), false)
    assert.deepEqual([(await h.board.read()).tasks[0].state, (await store.get(id)).category], ['done', 'done'])
    const ev = Object.values((await h.events.read()).epics).flat(); assert.equal(ev.some(e => e.type === 'check.ran'), false)   // no gate ran
  } finally { PL.setProfile(DEFAULT); resetProfile() }
})

test('a critic that asks for changes sends the task back to the writer (onFail: retry 2, back to write); the third ask raises the rework flag', async () => {
  const w = await world(), id = w.ids[0], { h, store } = w
  try {
    await w.spawn(id); const wt = (await store.get(id)).meta['cadre.worktree']; writeFileSync(join(wt, 'GUIDE.md'), 'v1\n'); await w.rep('ag1', { role: 'writer', outcome: 'done', summary: 'v1' })
    for (const k of [1, 2, 3]) {
      if (k === 1) await w.spawn(id)   // the critic (ag2) and the writer (ag1) are resumed by each other's report
      const out = await w.rep('ag2', { role: 'critic', verdict: 'changes', summary: 'unclear', findings: [{ severity: 'major', file: 'GUIDE.md', line: 1, issue: 'say how' }] })
      assert.match(out, new RegExp(`changes \\(${k}/2\\)`)); const t = (await h.board.read()).tasks[0]; assert.deepEqual([t.state, t.step], ['active', 'write'])
      assert.equal(t.flags.includes('rework:3/2'), k === 3)
      if (k < 3) { writeFileSync(join(wt, 'GUIDE.md'), `v${k + 1}\n`); assert.match(await w.rep('ag1', { role: 'writer', outcome: 'done', summary: `v${k + 1}` }), /report accepted/) }
    }
  } finally { PL.setProfile(DEFAULT); resetProfile() }
})
