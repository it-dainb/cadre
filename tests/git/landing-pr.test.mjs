// Dev-only: landing.mode pr (H6) against real git, a bare remote and a stub gh on PATH (no GitHub): one pull request per plan, the plan waits as integrating,
// it merges when the checks pass (and, with landing.review, once approved) and lands on dev; red checks take the red path; no gh pushes nothing.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { fakeHost } = await import('../support.ts')
const { defaults } = await import('../../config/index.ts')
const { integrateEpic, prPoll } = await import('../../core/integrate.ts')
const { skeleton } = await import('../../core/changelog.ts')
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const commit = (d, f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg) }
// the stub: pr create/view/checks/merge read and write $GHSTATE; merge does a --no-ff merge into dev on the bare remote
const GH = `#!/bin/sh
S=$GHSTATE
echo "$1 $2" >> $S/calls; [ -f $S/broken ] && [ "$1" = pr ] && { echo "HTTP 502" >&2; exit 1; }
case "$1 $2" in
  "--version "*) echo "gh version 2.60.0" ;;
  "auth status") exit 0 ;;
  "pr create") while [ $# -gt 0 ]; do [ "$1" = --head ] && echo "$2" > $S/head; shift; done; echo x >> $S/creates; echo "https://github.invalid/o/r/pull/7" ;;
  "pr view") printf '{"state":"%s","reviewDecision":"%s"}' "$(cat $S/state 2>/dev/null || echo OPEN)" "$(cat $S/review 2>/dev/null)" ;;
  "pr checks") cat $S/checks 2>/dev/null || echo '[]' ;;
  "pr merge") t=$(mktemp -d) && git clone -q "$REMOTE" $t && cd $t && git -c user.name=gh -c user.email=gh@x checkout -q dev && git -c user.name=gh -c user.email=gh@x merge -q --no-ff -m "Merge pull request #7" origin/$(cat $S/head) && git push -q origin dev && echo MERGED > $S/state ;;
  *) echo "stub gh: $*" >&2; exit 2 ;;
esac
`
async function world(o = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cadre-pr-')), R = `${d}-remote.git`, bin = `${d}-bin`, S = `${d}-gh`
  execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  commit(d, 'CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev'); sh(d, 'branch', 'epic/p3-auth', 'dev')
  sh(d, 'checkout', '-q', 'epic/p3-auth'); commit(d, 'c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  execFileSync('git', ['init', '-q', '--bare', R]); sh(d, 'remote', 'add', 'origin', R); sh(d, 'push', '-q', 'origin', 'main', 'dev')
  mkdirSync(bin); mkdirSync(S); if (o.gh !== false) { writeFileSync(join(bin, 'gh'), GH); chmodSync(join(bin, 'gh'), 0o755) } else symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
  const env = { ...process.env, PATH: o.gh === false ? bin : `${bin}:${process.env.PATH}`, GHSTATE: S, REMOTE: R }   // no gh: PATH holds git alone (never the host's own gh)
  const run = (argv, x = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: x.cwd, env }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 127) : 0, stdout, stderr })))
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.packages = [{ root: '.', setup: ['true'], checks: { test: ['true'] } }]; cfg.jail = 'off'; cfg.landing = { mode: 'pr', review: !!o.review, remote: 'origin' }
  const h = fakeHost(), clock = { t: 1_000_000 }
  Object.assign(h, { cwd: async () => d, home: async () => d, run, now: async () => clock.t, config: async () => cfg, readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t),
    taskStore: async () => ({ list: async () => [{ id: 'm-2', category: 'done', meta: { 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'Login' }) } }], control: async () => ({ revision: '0', doc: {} }), setControl: async () => ({ revision: '0', doc: {} }) }) })
  const task = { id: 'm-2', title: 'm-2', type: 'feature', kind: 'code', merges: true, state: 'done', step: '', phaseSince: 0, deps: [], flags: [] }
  await h.board.update(b => ({ ...b, epic: 'p3', plan: { id: 'p3', slug: 'auth', state: 'approved', epicBranch: 'epic/p3-auth' }, tasks: [task] }))
  const set = (k, v) => writeFileSync(join(S, k), v), poll = async () => { clock.t += 31_000; await prPoll(h) }
  const creates = () => { try { return readFileSync(join(S, 'creates'), 'utf8').split('\n').filter(Boolean).length } catch { return 0 } }
  return { d, R, S, h, set, poll, creates, plan: async () => (await h.board.read()).plan }
}
const remoteHas = (R, ref) => { try { execFileSync('git', ['--git-dir', R, 'rev-parse', '--verify', '-q', ref]); return true } catch { return false } }

test('pr: one pull request, the plan waits while checks run, merges when green, dev lands at the merge; the head branch goes', async () => {
  const w = await world(), old = sh(w.d, 'rev-parse', 'dev')
  assert.match(await integrateEpic(w.h, 'p3'), /^pull request #7 opened: the plan lands on dev when its checks pass$/)
  assert.equal((await w.plan()).state, 'integrating'); assert.equal((await w.plan()).pr.n, 7); assert.ok(remoteHas(w.R, 'cadre/land/p3')); assert.equal(sh(w.d, 'rev-parse', 'dev'), old)
  assert.match(await integrateEpic(w.h, 'p3'), /already running/); assert.equal(w.creates(), 1)   // never a second pull request
  w.set('checks', '[{"name":"ci","bucket":"pending"}]'); await w.poll(); assert.equal((await w.plan()).state, 'integrating'); assert.equal(sh(w.d, 'rev-parse', 'dev'), old)
  w.set('checks', '[{"name":"ci","bucket":"pass"}]'); await w.poll()
  const dev = sh(w.d, 'rev-parse', 'dev'); assert.equal(dev, execFileSync('git', ['--git-dir', w.R, 'rev-parse', 'dev'], { encoding: 'utf8' }).trim()); assert.match(sh(w.d, 'log', '-1', '--format=%s', dev), /Merge pull request #7/)
  const p = await w.plan(); assert.equal(p.state, 'done-on-dev'); assert.equal(p.landed.sha, dev); assert.equal(p.pr, undefined)
  assert.equal(remoteHas(w.R, 'cadre/land/p3'), false); assert.equal(sh(w.d, 'branch', '--list', 'epic/p3-auth'), ''); assert.match(sh(w.d, 'show', 'dev:CHANGELOG.md'), /- Login \(m-2\)/)
})
test('pr: red checks take the red path: dev untouched, plan approved with integration-failed', async () => {
  const w = await world(), old = sh(w.d, 'rev-parse', 'dev'); await integrateEpic(w.h, 'p3')
  w.set('checks', '[{"name":"ci","bucket":"fail"},{"name":"lint","bucket":"pass"}]'); await w.poll()
  const p = await w.plan(); assert.equal(p.state, 'approved'); assert.deepEqual(p.flags, ['integration-failed']); assert.equal(p.pr, undefined); assert.equal(sh(w.d, 'rev-parse', 'dev'), old)
})
test('pr + landing.review: green waits for an approval, then merges', async () => {
  const w = await world({ review: true }); assert.match(await integrateEpic(w.h, 'p3'), /and it is approved$/)
  w.set('checks', '[{"name":"ci","bucket":"pass"}]'); await w.poll(); assert.equal((await w.plan()).state, 'integrating')
  w.set('review', 'APPROVED'); await w.poll(); assert.equal((await w.plan()).state, 'done-on-dev')
})
test('pr: polls at most every 30 s; a gh failure backs off', async () => {
  const w = await world(); await integrateEpic(w.h, 'p3'); w.set('checks', '[{"name":"ci","bucket":"pass"}]')
  await prPoll(w.h); assert.equal((await w.plan()).state, 'done-on-dev')   // the first poll is due at once
  const v = await world(); await integrateEpic(v.h, 'p3'); v.set('checks', '[{"name":"ci","bucket":"pending"}]'); await prPoll(v.h); v.set('checks', '[{"name":"ci","bucket":"pass"}]')
  await prPoll(v.h); assert.equal((await v.plan()).state, 'integrating')   // 0 s later: not polled
  const b = await world(); await integrateEpic(b.h, 'p3'); b.set('broken', ''); const views = () => readFileSync(join(b.S, 'calls'), 'utf8').split('\n').filter(l => l === 'pr view').length
  await b.poll(); assert.equal(views(), 1); assert.equal((await b.plan()).state, 'integrating')   // gh failed: logged, the plan waits
  await b.poll(); assert.equal(views(), 1)   // 31 s later: still backing off (60 s after the 1st failure)
  await b.poll(); assert.equal(views(), 2)
})
test('no gh: nothing is pushed, the plan stays approved with the reason', async () => {
  const w = await world({ gh: false })
  assert.match(await integrateEpic(w.h, 'p3'), /integration error: gh auth status: /); assert.equal(remoteHas(w.R, 'cadre/land/p3'), false); assert.equal((await w.plan()).state, 'approved')
})
