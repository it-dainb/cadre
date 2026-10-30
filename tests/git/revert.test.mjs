// Dev-only: H9 revert against real git. node --experimental-transform-types --test tests/git/revert.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { integrateEpic } = await import('../../core/integrate.ts')
const { ROUTES } = await import('../../core/dispatch.ts')
await import('../../core/revert.ts')
const { cut, insert, skeleton } = await import('../../modules/changelog.mjs')
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }

// a repo with an epic (adds c.txt), landed on dev through integrate; the epic is a store record with the task under it
async function world(land = true, noRecord = false) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-rev-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.units = [{ root: '.', checks: { setup: ['true'], test: ['true'] } }]; cfg.jail = 'off'
  const h = fakeHost(); Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  const store = await h.taskStore(), epic = await store.createEpic('auth', 'goal'), br = `epic/${epic}-auth`
  sh(d, 'branch', br, 'dev'); sh(d, 'checkout', '-q', br); commit(d, 'c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  const t = await store.createDraft({ title: 'login', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'feat/t1-login' } }); sh(d, 'branch', 'feat/t1-login', 'main'); sh(d, 'branch', 'feat/t9-unrecorded', 'main')
  await h.board.update(b => ({ ...b, epic, plan: { id: epic, slug: 'auth', state: 'approved', epicBranch: br }, tasks: [{ id: t.id, title: 'login', type: 'feature', kind: 'code', merges: true, state: 'done', step: '', phaseSince: 0, deps: [], flags: [] }] }))
  if (noRecord) { const was = store.setMeta.bind(store); store.setMeta = async (id, kv, ...r) => { if (kv['cadre.landed']) throw new Error('store down'); return was(id, kv, ...r) } }
  if (land) assert.equal(await integrateEpic(h, epic), null)
  const ans = async (id, key) => { const x = ((await h.board.read()).decisions ?? []).find(y => y.id === id); assert.ok(x, `no dialog ${id}`); const [cmd, ...args] = x.options.find(o => o.key === key).run.split(' '); return ROUTES[cmd](h, { schemaVersion: 1, cmd, args, origin: { kind: 'dialog' } }) }
  return { d, h, store, epic, t, ans, press: id => ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [id], origin: { kind: 'press' } }), cfg }
}
const decisions = async h => ((await h.board.read()).decisions ?? []).map(x => x.id).filter(i => i.startsWith('revert'))

test('a revert lands through integrate: new merge on dev, files gone, recorded branches removed, an unrecorded one kept, nothing left behind', async () => {
  const { d, h, store, epic, ans, press } = await world(), before = sh(d, 'rev-parse', 'dev')
  assert.equal(sh(d, 'show', 'dev:c.txt'), 'c')
  await press(epic); await ans(`revert:${epic}`, 'c')
  assert.equal(sh(d, 'rev-parse', 'dev'), before, 'one confirm moves nothing'); assert.deepEqual(await decisions(h), [`revert-sure:${epic}`])
  const out = await ans(`revert-sure:${epic}`, 'y'); assert.match(out.text, /reverted/)
  const dev = sh(d, 'rev-parse', 'dev'); assert.notEqual(dev, before)
  assert.equal(sh(d, 'rev-list', '--parents', '-n1', dev).split(' ').length, 3, 'a --no-ff merge of the revert branch (mergeEpic + landDev)'); assert.match(sh(d, 'log', '-1', '--format=%s', dev), /^revert /)
  assert.equal(existsSync(join(d, 'c.txt')), false); assert.throws(() => sh(d, 'show', 'dev:c.txt'))
  assert.equal(sh(d, 'show', 'dev:CHANGELOG.md'), skeleton().trim())   // the changelog is the hooks': a revert adds no line of its own (B6)
  assert.equal(sh(d, 'branch', '--list', `revert/${epic}`), ''); assert.equal(sh(d, 'branch', '--list', 'feat/t1-login'), '', 'recorded branch removed'); assert.match(sh(d, 'branch', '--list', 'feat/t9-unrecorded'), /t9-unrecorded/)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.deepEqual(await decisions(h), [])
  const e = await store.get(epic); assert.ok(e.meta['cadre.reverted']); assert.match((await press(e.meta['cadre.reverted'])).text, /revert-of-revert/)
})
test('dev checked out by the user: the revert waits as the pending landing (move), dev itself is not touched', async () => {
  const { d, h, epic, ans, press } = await world(); sh(d, 'checkout', '-q', 'dev'); const before = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'c'); await ans(`revert-sure:${epic}`, 'y')
  assert.equal(sh(d, 'rev-parse', 'dev'), before); assert.notEqual(sh(d, 'rev-parse', 'refs/cadre/pending/dev'), before); assert.ok(((await h.board.read()).decisions ?? []).some(x => x.id === 'pending:dev'))
  assert.equal(existsSync(join(d, 'c.txt')), true, 'the user\'s checkout is untouched until Land')
})
test('a conflicting revert blocks with one dialog, a clean tree and no leftovers', async () => {
  const { d, h, epic, ans, press } = await world(); sh(d, 'checkout', '-q', 'dev'); commit(d, 'c.txt', 'c changed later\n', 'feat: more'); sh(d, 'checkout', '-q', 'main'); const before = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'c'); const out = await ans(`revert-sure:${epic}`, 'y'); assert.match(out.text, /refused: .*conflicts/)
  assert.deepEqual(await decisions(h), [`revert-fail:${epic}`]); assert.equal(sh(d, 'rev-parse', 'dev'), before)
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal(sh(d, 'worktree', 'list').split('\n').length, 1); assert.equal(sh(d, 'branch', '--list', `revert/${epic}`), '')
  assert.equal(existsSync(join(d, '.git', 'REVERT_HEAD')), false)
  await ans(`revert-fail:${epic}`, 'k'); assert.deepEqual(await decisions(h), [])
})

const shown = async (h, id) => ((await h.board.read()).decisions ?? []).find(x => x.id === id)
test('a stale re-created branch with unmerged work, a branch recorded as dev, and a moved one are kept after a revert; the report says so', async () => {
  const { d, h, store, epic, ans, press } = await world(); const dev0 = sh(d, 'rev-parse', 'dev')
  sh(d, 'checkout', '-q', '-b', 'feat/t1-login-again', 'main'); commit(d, 'mine.txt', 'unmerged\n', 'wip: mine'); sh(d, 'checkout', '-q', 'main'); sh(d, 'branch', '-D', 'feat/t1-login'); sh(d, 'branch', 'feat/t1-login', 'feat/t1-login-again')
  await store.createDraft({ title: 'odd', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'dev' } })
  await press(epic); await ans(`revert:${epic}`, 'c'); const out = await ans(`revert-sure:${epic}`, 'y')
  assert.match(out.text, /kept: .*feat\/t1-login \(changed or not merged\).*dev \(protected\)|kept: .*dev \(protected\).*feat\/t1-login/); assert.match(sh(d, 'branch', '--list', 'feat/t1-login'), /t1-login/); assert.notEqual(sh(d, 'rev-parse', 'dev'), dev0)
  assert.equal(existsSync(join(d, 'mine.txt')), false); assert.equal(sh(d, 'show', 'feat/t1-login:mine.txt'), 'unmerged')
})
test('abandon: only the recorded branches go; decoys by name, a protected record and a branch that moved after the card stay; a busy repo deletes nothing; a plan that runs is refused', async () => {
  const { d, h, store, epic, t, ans, press } = await world(false), Q = x => sh(d, 'branch', '--list', x)
  sh(d, 'branch', 'epic/zz-decoy', 'main'); sh(d, 'branch', 'feat/zz-unrecorded', 'main'); sh(d, 'branch', 'feat/t2-moves', 'main')
  await store.createDraft({ title: 'two', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'feat/t2-moves' } }); await store.createDraft({ title: 'odd', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'main' } })
  await h.board.update(b => ({ ...b, tasks: b.tasks.map(x => ({ ...x, state: 'active' })) })); assert.match((await press(epic)).text, /refused \(busy\)/)   // the board still runs it
  await h.board.update(b => ({ ...b, tasks: b.tasks.map(x => ({ ...x, state: 'done' })) }))
  await press(epic); assert.match((await shown(h, `revert:${epic}`)).lines.join('\n'), /removes .*feat\/t1-login/); await ans(`revert:${epic}`, 'a')
  sh(d, 'checkout', '-q', 'feat/t2-moves'); commit(d, 'later.txt', 'x\n', 'wip: moved after the card'); sh(d, 'checkout', '-q', 'main')
  assert.match((await ans(`revert-sure:${epic}`, 'z')).text, /changed since the card/); assert.ok(await shown(h, `revert:${epic}`))   // refused, the card is back
  await ans(`revert:${epic}`, 'a'); await h.git.update(g => ({ ...g, busy: true })); const busy = await ans(`revert-sure:${epic}`, 'z')   // every delete goes through op(): nothing is deleted outside it
  assert.match(busy.text, /not fully abandoned/); for (const b of [`epic/${epic}-auth`, 'feat/t1-login', 'feat/t2-moves']) assert.ok(Q(b)); assert.equal((await store.get(epic)).meta['cadre.reverted'], undefined)
  await h.git.update(g => ({ ...g, busy: false })); await press(epic); await ans(`revert:${epic}`, 'a')   // the card shows the moved tip now
  const out = await ans(`revert-sure:${epic}`, 'z'); assert.match(out.text, /abandoned: 3 recorded branches removed; kept: .*main \(protected\)/)
  assert.equal(Q('epic/zz-decoy').trim(), 'epic/zz-decoy'); assert.match(Q('feat/zz-unrecorded'), /unrecorded/); assert.match(Q('feat/t9-unrecorded'), /unrecorded/); assert.match(Q('main'), /main/); assert.match(Q('dev'), /dev/)
  assert.equal(Q(`epic/${epic}-auth`), ''); assert.equal(Q('feat/t1-login'), ''); assert.equal(Q('feat/t2-moves'), '', 'the branch the card showed after it moved is the confirmed one')
  assert.equal(sh(d, 'status', '--porcelain'), ''); assert.equal((await store.get(epic)).meta['cadre.reverted'], 'abandoned')
})
test('a landing that could not be recorded does not fail the integration; the revert says it has no recorded landing', async () => {
  const { h, epic, press } = await world(true, true); assert.ok(h.logs.some(l => /landed not recorded/.test(l)))
  assert.match((await press(epic)).text, /refused \(not-landed\)/)
})

// `@{-1}` / `@{-2}` are revision spellings: git expands them to the branches the user was on before. A record must never reach them.
const alias = async (w, mode) => {
  const { d, store, epic } = w; sh(d, 'checkout', '-q', '-b', 'prev2', 'main'); sh(d, 'checkout', '-q', 'dev'); sh(d, 'checkout', '-q', 'main')   // @{-1} = dev, @{-2} = prev2
  assert.equal(sh(d, 'rev-parse', '--abbrev-ref', '@{-1}'), 'dev'); assert.equal(sh(d, 'rev-parse', '--abbrev-ref', '@{-2}'), 'prev2')
  for (const b of ['@{-1}', '@{-2}', '-D', 'feat/a..b']) await store.createDraft({ title: b, description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': b } })
}
test('a record spelled @{-1} or @{-2} (or -D, a..b) is not a branch name: dev and the user\'s previous branch survive a revert', async () => {
  const w = await world(), { d, h, epic, ans, press } = w; await alias(w); const dev0 = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'c'); const out = await ans(`revert-sure:${epic}`, 'y')
  assert.match(out.text, /@\{-1\} \(not a branch name\)/); assert.match(out.text, /@\{-2\} \(not a branch name\)/); assert.match(out.text, /1 recorded branch removed/)
  assert.ok(sh(d, 'rev-parse', 'dev')); assert.notEqual(sh(d, 'rev-parse', 'dev'), dev0, 'dev only moved by the revert landing'); assert.match(sh(d, 'branch', '--list', 'prev2'), /prev2/); assert.equal(sh(d, 'branch', '--list', 'feat/t1-login'), '')
})
test('the same records in an abandon: dev and the previous branch survive, the report names them', async () => {
  const w = await world(false), { d, epic, ans, press } = w; await alias(w); const dev0 = sh(d, 'rev-parse', 'dev')
  await press(epic); await ans(`revert:${epic}`, 'a'); const out = await ans(`revert-sure:${epic}`, 'z')
  assert.match(out.text, /abandoned: 2 recorded branches removed.*@\{-1\} \(not a branch name\)/); assert.equal(sh(d, 'rev-parse', 'dev'), dev0); assert.match(sh(d, 'branch', '--list', 'prev2'), /prev2/)
  assert.equal(sh(d, 'branch', '--list', `epic/${epic}-auth`), '')
})
test('a recorded branch that moves after the confirm (during the delete) stays: the delete is compare-and-swap', async () => {
  for (const land of [true, false]) {
    const { d, h, epic, ans, press } = await world(land), r0 = h.run, moved = sh(d, 'commit-tree', '-p', 'main', '-m', 'moved', 'main^{tree}')
    h.run = (argv, o) => { if (argv.includes('update-ref') && argv.includes('-d') && argv.includes('refs/heads/feat/t1-login')) sh(d, 'branch', '-f', 'feat/t1-login', moved); return r0(argv, o) }
    await press(epic); await ans(`revert:${epic}`, land ? 'c' : 'a'); const out = await ans(`revert-sure:${epic}`, land ? 'y' : 'z')
    assert.match(out.text, /feat\/t1-login \(changed or not merged\)/); assert.equal(sh(d, 'rev-parse', 'feat/t1-login'), moved)
  }
})

// security review (ADR 0030): R-01 shape of the recorded landing, R-02 allowlist of deletable branches, R-04 a branch of the user's, R-05 changelog path, R-07 what the confirm covers
test('R-01: a recorded landing that is not branch@40-hex-sha on a landing branch is refused before it reaches git', async () => {
  const { d, store, epic, press } = await world(), good = (await store.get(epic)).meta['cadre.landed'], sha = good.split('@')[1], before = sh(d, 'rev-parse', 'dev')
  for (const bad of ['dev@--output=owned.txt', `dev@${sha.slice(0, 7)}`, `-x@${sha}`, `release/1.0@${sha}`, `a..b@${sha}`, `dev@${sha}\n-x`]) {
    await store.setMeta(epic, { 'cadre.landed': bad }, 'cadre'); assert.match((await press(epic)).text, /refused \(unknown\)/, bad)
  }
  assert.equal(existsSync(join(d, 'owned.txt')), false); assert.equal(sh(d, 'rev-parse', 'dev'), before)
  await store.setMeta(epic, { 'cadre.landed': good }, 'cadre'); assert.doesNotMatch((await press(epic)).text, /refused/)
})
test('R-02: a recorded branch that is not cadre\'s own (a user branch at the same tip) is never deleted, even in an abandon', async () => {
  const { d, store, epic, ans, press } = await world(false)
  sh(d, 'branch', 'release/1.0', 'main'); await store.createDraft({ title: 'odd', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'release/1.0' } })
  await press(epic); await ans(`revert:${epic}`, 'a'); const out = await ans(`revert-sure:${epic}`, 'z')
  assert.match(out.text, /abandoned: .*release\/1\.0 \(not a branch name\)/); assert.match(sh(d, 'branch', '--list', 'release/1.0'), /release/); assert.equal(sh(d, 'branch', '--list', 'feat/t1-login'), '')
})
test('R-04: a branch revert/<id> that cadre did not make is not deleted: the revert is refused as busy', async () => {
  const { d, epic, ans, press } = await world(), mine = sh(d, 'commit-tree', '-p', 'main', '-m', 'mine', 'main^{tree}'), before = sh(d, 'rev-parse', 'dev')
  sh(d, 'branch', `revert/${epic}`, mine); await press(epic); await ans(`revert:${epic}`, 'c')
  assert.match((await ans(`revert-sure:${epic}`, 'y')).text, /refused \(busy\)/); assert.equal(sh(d, 'rev-parse', `revert/${epic}`), mine); assert.equal(sh(d, 'rev-parse', 'dev'), before)
})
test('R-05: a protected file the revert conflicts on (the changelog, changed by a later release) stays as dev has it and never blocks the revert', async () => {
  const { d, h, epic, ans, press } = await world(false), br = `epic/${epic}-auth`
  sh(d, 'checkout', '-q', br); commit(d, 'CHANGELOG.md', insert(skeleton(), 'Added', 'login', 'm-1'), 'docs(changelog): m-1'); sh(d, 'checkout', '-q', 'main')
  assert.equal(await integrateEpic(h, epic), null)
  sh(d, 'checkout', '-q', 'dev'); const released = cut(sh(d, 'show', 'dev:CHANGELOG.md') + '\n', '0.1.0', '2026-01-01'); commit(d, 'CHANGELOG.md', released, 'chore(release): v0.1.0'); sh(d, 'checkout', '-q', 'main')
  await press(epic); await ans(`revert:${epic}`, 'c'); assert.match((await ans(`revert-sure:${epic}`, 'y')).text, /reverted/)
  assert.equal(existsSync(join(d, 'c.txt')), false); assert.equal(sh(d, 'show', 'dev:CHANGELOG.md'), released.trim())
})
test('R-07: the confirm covers the recorded commits and the merge flag: a change between the confirms re-asks', async () => {
  const { store, t, epic, ans, press } = await world()
  await press(epic); await ans(`revert:${epic}`, 'c'); await store.setMeta(t.id, { 'cadre.sourceCommit': 'f'.repeat(40) }, 'cadre')
  assert.match((await ans(`revert-sure:${epic}`, 'y')).text, /changed since the card/)
})
