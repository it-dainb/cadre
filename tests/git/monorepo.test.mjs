// Dev-only, REAL git + the file store (live 0.9.1, a monorepo whose package is in kit/): the checks and the task store read the repo root, never main's shell folder;
// a board pointer to an epic the store does not have is dropped, one the store has is resumed. node --experimental-transform-types --test tests/git/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const I = await import('../../commands/init.ts')
const { rehydrate } = await import('../../core/session.ts')
const { load } = await import('../../config/index.ts')
const { FileStore } = await import('../../task-management/adapters/file/store.ts')
const { fakeHost } = await import('../support.ts')

const run = (argv, o = {}) => new Promise(res => { const p = execFile(argv[0], argv.slice(1), { cwd: o.cwd, env: { ...process.env, ...o.env }, timeout: 60000 }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })); p.stdin.on('error', () => {}); p.stdin.end(o.stdin ?? '') })   // a child that exits before reading its stdin: EPIPE is not a failure
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const put = (d, p, t) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), t) }
const CHANGELOG = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\n\n## [Unreleased]\n'
// a monorepo's shape: the package in kit/, main and dev already there, cadre's files at the root
function monorepo() {
  const d = mkdtempSync(join(tmpdir(), 'cadre-mono-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  put(d, 'kit/package.json', '{"name":"kit","scripts":{"test":"node -e 0"}}\n'); put(d, 'kit/src/a.js', 'export const a = 1\n'); put(d, 'README.md', '# my_project\n')
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'chore: initial commit'); sh(d, 'branch', 'dev', 'main')
  put(d, '.git/info/exclude', '.cadre/state/\n.claude/settings.local.json\n')
  put(d, '.cadre/config.json', JSON.stringify({ branches: { main: 'main', dev: 'dev' }, units: [{ root: 'kit', checks: { test: ['npm', 'test'] } }] }) + '\n'); put(d, 'CHANGELOG.md', CHANGELOG)
  return d
}
const storeAt = async (h, root) => new FileStore({ run, now: async () => Date.now(), rand: (n = 16) => Math.random().toString(16).slice(2).padEnd(n * 2, '0'), write: async (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t) } }, `${root}/.cadre/state`, 's')
// a host whose root is `at` (what h.cwd() resolves to), with real files, git and the store
function hostAt(at) {
  const h = fakeHost()
  Object.assign(h, { cwd: async () => at, home: async () => mkdtempSync(join(tmpdir(), 'cadre-home-')), run, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, stat: async (p, o) => (existsSync(p) ? { kind: 'dir', realPath: o?.resolve ? p : undefined } : undefined), write: async (p, t) => writeFileSync(p, t) })
  h.config = async () => (await load(h, { home: await h.home(), root: at, repoKey: I.repoKeyOf(at) })).config
  h.taskStore = async () => storeAt(h, at)
  return h
}

test('the checks read the repo root: config, packages and changelog pass there; from kit/ they fail exactly as reported live', async () => {
  const d = monorepo(); I.wire.store = (h, _c, root) => storeAt(h, root); await (await storeAt(hostAt(d), d)).init({ types: { feature: {}, task: {} }, journal: true })
  const at = async root => Object.fromEntries((await I.progress(hostAt(root))).map(p => [p.name, p.done]))
  const top = await at(d)
  for (const n of ['repository', 'task store', 'build and test commands', 'changelog']) assert.equal(top[n], true, n)
  const kit = await at(join(d, 'kit'))   // the old resolution: main's shell folder
  for (const n of ['repository', 'task store', 'build and test commands', 'changelog']) assert.equal(kit[n], false, n)
})

test('resume after /clear with the real store: a pointer (control doc) to an epic it has is resumed; one it does not have is dropped; no store under kit/ resumes nothing', async () => {
  const d = monorepo(), h0 = hostAt(d), s = await storeAt(h0, d); await s.init({ types: { feature: {}, task: {} }, journal: true })
  const epic = await s.createEpic('Homepage', 'goal')
  const ptr = id => ({ mission: null, epic: id, plan: { id, slug: 'homepage', state: 'draft', epicBranch: '' }, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, bind: {} })
  const cleared = async id => { await s.setControl({ board: ptr(id) }); return hostAt(d) }

  const gone = await cleared('my_project-zzz')
  assert.equal(await rehydrate(gone), false); assert.equal((await s.control()).doc.board, undefined); assert.equal((await gone.board.read()).plan, null)

  const kept = await cleared(epic)
  assert.equal(await rehydrate(kept), true); assert.equal((await kept.board.read()).plan.id, epic)

  const kit = hostAt(join(d, 'kit'))   // main's shell folder: no store there, nothing to resume
  assert.equal(await rehydrate(kit), false); assert.equal((await kit.board.read()).plan, null)
})

test('the tree names no private project: tests use generic names (my_project)', () => {
  const root = new URL('../../', import.meta.url).pathname, bad = ['dg' + 'tx', 'fr' + 'ek'].join('|')
  const r = spawnSync('git', ['-C', root, 'grep', '-n', '-i', '-E', bad], { encoding: 'utf8' })
  assert.equal(r.status, 1, r.stdout)   // 1: no match
})
