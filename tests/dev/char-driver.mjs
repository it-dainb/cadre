// Dev-only (node): the characterization driver (plan cadre-2.0 section 6). Replays tests/fixtures/char/<cell>.script.json through the CURRENT code and compares
// the transcript (state transitions only: no prose, ids that vary, or timestamps) with <cell>.golden.json. CHAR_RECORD=1 writes the golden instead.
// Worlds: life (tests/fixtures/replay/world.ts), native (tests/fixtures/native/world.ts), gate (tests/dev/tdd-world.mjs, real git + a real shell check), landing (real git, as tests/git/devmoved.test.mjs).
import './register.mjs'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('../fixtures/char/', import.meta.url).pathname
export const script = cell => JSON.parse(readFileSync(`${DIR}${cell}.script.json`, 'utf8'))
const kind = r => (/malformed report \d+\/\d+/.test(typeof r === 'string' ? r : '') ? 'refused:shape' : /^(error: |refused|usage|name the flag|no task|not )|not waiting|cannot be|could not|not recorded|is not blocked|still waiting|not reworked/.test(typeof r === 'string' ? r : (r?.text ?? r?.deny ?? '')) ? 'refused' : 'ok')   // a class, never the prose
const fill = b => Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, typeof v === 'string' && /^@x\d+$/.test(v) ? 'x'.repeat(+v.slice(2)) : v]))   // "@x900" = 900 chars
const setPath = (o, p, v) => { const k = p.split('.'); let x = o; for (const s of k.slice(0, -1)) x = x[s]; x[k.at(-1)] = v }

// ---- life: one approved plan in a MemoryStore, scripted git, spawner/admission/close as registered ----
async function life(s) {
  const { world } = await import('../fixtures/replay/world.ts'), { arm } = await import('../../core/drive.ts'), { ROUTES } = await import('../../core/dispatch.ts')
  const { handleWith } = await import('../../tools/index.ts'), { exitStep, runOf, budgetOf } = await import('../../core/lifecycle.ts')
  let gm = 'plain', tip = 'e0e0e01'
  const files = {}   // s.junit: the test check the tester names fails and writes this report where core reads it (the fake runner answers every argv)
  const w = await world({ ...s.world, git: a => (s.junit && a[0] === 'find' ? { stdout: './test/a.test.js\0' } : s.junit && a[0] === 'stat' && files[a[3]] !== undefined ? { stdout: `regular file ${files[a[3]].length}\n` } : s.junit && a.some(x => x.endsWith('/junit-test.xml')) ? (files[a.find(x => x.endsWith('/junit-test.xml'))] = s.junit, { exitCode: 1 }) : gm !== 'moved' ? undefined : a.includes('merge-tree') ? { exitCode: 1, stdout: 'tree\nsrc/a.ts\n' } : a.join(' ').includes('epic/p1-service^{commit}') ? { stdout: `${tip}\n` } : undefined) })
  for (const [p, v] of Object.entries(s.cfg ?? {})) setPath(w.cfg, p, v)
  const PL = await import('../../core/pipeline.ts'), DP = await sessionProfile()
  PL.setProfile({ ...DP, hooks: {}, steps: Object.fromEntries(Object.entries(DP.steps).map(([k, st]) => [k, s.retry?.[k] === undefined ? st : { ...st, onFail: { ...st.onFail, retry: s.retry[k] } }])) })   // s.retry: a step's onFail.retry for this script ({red: 1}); the default profile otherwise
  w.h.readText = async p => files[p] ?? null
  if (s.acceptance) await w.store.update(w.ids[0], { acceptance: s.acceptance }, w.dep.actor)
  const out = [], seen = new Set()
  const project = async (op, res) => {
    const b = await w.h.board.read(), ctl = {}
    for (const t of b.tasks) ctl[t.id] = Object.keys((await w.store.get(t.id)).meta).filter(k => k.startsWith('cadre.')).sort()
    const budget = {}; for (const t of b.tasks) { const x = await budgetOf(w.h, t.id); const nz = Object.fromEntries(Object.entries(x).filter(([k, v]) => v && k !== 'epoch')); if (Object.keys(nz).length) budget[t.id] = nz }
    const runs = {}; for (const id of new Set([...seen, ...w.spawned.map(x => x[0])])) { const r = (await runOf(w.h, id))?.state; runs[id] = r ? [r.state, r.cause, r.on, r.n].filter(x => x !== undefined).join(':') : 'gone' }
    out.push({ op, res, tasks: b.tasks.map(t => ({ id: t.id, state: t.state, step: t.step, flags: t.flags, owned: !!t.owner })), decisions: (b.decisions ?? []).map(d => ({ id: d.id, optionKeys: d.options.map(o => o.key) })),
      spawned: w.spawned.map(x => x[2]), sent: w.sent.map(x => x[0]), runs, plan: b.plan ? { state: b.plan.state, flags: b.plan.flags ?? [] } : null, drive: { stopped: !!b.drive.stopped }, metaKeys: ctl, budget, commits: w.calls.flatMap(c => (/ commit .*?-m ([a-z]+)[(:]/.exec(c) ?? []).slice(1)) })
  }
  for (const o of s.ops) {
    let res
    switch (o.op) {
      case 'arm': await arm(w.h, o.mode ?? 'auto'); break
      case 'turn': await w.turn(); break
      case 'at': seen.add(o.agent); await w.at(o.agent, o.task === '$1' ? w.ids[0] : o.task, o.role, o.step); break
      case 'rep': res = kind(await w.rep(o.agent, fill(o.body))); break
      case 'hb': { const r = await w.hb(o.agent); res = r.deny ? 'deny' : 'ok'; break }
      case 'stop': await w.stop(o.agent, o.reason, o.answer); break
      case 'git': gm = o.mode; tip = o.tip ?? tip; break
      case 'resolve': res = kind(await ROUTES.resolve(w.h, { schemaVersion: 1, cmd: 'resolve', args: o.args.map(a => (a === '$1' ? w.ids[0] : a)), origin: { kind: 'dialog' } })); break
      case 'status': res = kind((await handleWith(w.h, w.dep, { tool: 'mcp__cadre__status', input: { id: o.id === '$1' ? w.ids[0] : o.id, ...o.input } })).result); break
      case 'meta': await w.store.setMeta(o.task === '$1' ? w.ids[0] : o.task, o.kv, w.dep.actor); break
      case 'tick': w.clock.now += o.ms; break
      case 'exitstep': {   // a turn.step of an agent whose report is in: does cadre answer it itself (asked = 0)?
        let asked = 0; const kinds = [], g = exitStep(w.h, { turnId: 't', index: 3, agentId: o.agent }, async function* () { asked++; return { answer: 'model', usage: { input_tokens: 9 } } })
        let r = await g.next(); while (!r.done) { kinds.push(r.value.kind); r = await g.next() }
        res = { asked, kinds, stop: r.value?.stopReason }; break
      }
      case 'call': {   // n identical calls of one tool by an agent through the guard: the verdict of the last one (the breaker trips at REPEAT)
        const { guard } = await import('../../policy/guards.ts'); let r
        for (let i = 0; i < (o.n ?? 1); i++) r = await guard(w.h, { tool: o.tool, agentId: o.agent, input: o.input, ...o.input }, async e => e)
        res = r?.deny ? 'deny' : 'ok'; break
      }
      case 'repeat': for (let i = 0; i < o.n; i++) { const r = kind(await w.rep(o.agent, fill(o.body))); res = [...(res ?? []), r] }; break
      default: throw new Error(`life: unknown op ${o.op}`)
    }
    await project(o.label ?? o.op, res)
  }
  return out
}

// ---- native: main's plan tools (plan, task, amend, approve) on a MemoryStore ----
async function native(s) {
  const { world } = await import('../fixtures/native/world.ts'), { viaEngine } = await import('../fixtures/engine.ts')
  const w = await world(), out = [], ids = {}
  const rev = async () => { const p = (await w.h.board.read()).plan; return p ? Number((await w.store.get(p.id)).meta['cadre.rev'] ?? 0) : 0 }
  const sub = async v => (v === '$rev' ? await rev() : typeof v === 'string' && v[0] === '$' ? (ids[v.slice(1)] ?? v) : Array.isArray(v) ? Promise.all(v.map(sub)) : v && typeof v === 'object' ? Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await sub(x)]))) : v)
  const project = async (op, res) => { const b = await w.h.board.read(); out.push({ op, res, plan: b.plan ? { state: b.plan.state, flags: b.plan.flags ?? [] } : null, tasks: b.tasks.map(t => ({ id: t.id, state: t.state, step: t.step, flags: t.flags, deps: t.deps.length })), decisions: (b.decisions ?? []).map(d => ({ optionKeys: d.options.map(o => o.key), kind: d.id.split(':')[0] })), rev: await rev() }) }
  for (const o of s.ops) {
    let res
    if (o.op === 'tool') {   // main's own tool, through the engine's result shape
      const r = await viaEngine(w.h, { tool: `mcp__cadre__${o.name}`, tool_use_id: 'u', ...(await sub(o.input)) })
      res = r.isError ? (/expectedRevision/.test(r.text) ? 'refused:stale' : 'refused') : 'ok'
      if (o.as && r.result?.id) ids[o.as] = r.result.id
    } else if (o.op === 'approve') res = kind(await w.text({ cmd: 'approve', args: [ids.plan] }))
    else throw new Error(`native: unknown op ${o.op}`)
    await project(o.label ?? o.op, res)
  }
  return out
}

// ---- landing: real git (a `main` checkout, `dev`, one approved epic whose branch adds c.txt), as tests/git/{devmoved,revert}.test.mjs build it ----
const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { cwd: o.cwd }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const shOk = (cwd, ...a) => { try { execFileSync('git', ['-C', cwd, ...a], { stdio: 'ignore' }); return true } catch { return false } }
const sessionProfile = async () => (await import('./register.mjs')).sessionProfile
async function landing(s) {
  (await import('../../core/pipeline.ts')).setProfile(await sessionProfile())   // real git: the delivery hooks run for real
  const { fakeHost } = await import('../support.ts'), { defaults } = await import('../../config/index.ts'), { integrateEpic } = await import('../../core/integrate.ts')
  const { ROUTES } = await import('../../core/dispatch.ts'), { pendingRef } = await import('../../core/branches.ts'), { skeleton } = await import('../../modules/changelog.mjs')
  await import('../../core/revert.ts')
  const d = mkdtempSync(join(tmpdir(), 'cadre-char-')); execFileSync('git', ['init', '-q', '-b', 'main', d]); sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t')
  const commit = (f, body, msg) => { writeFileSync(join(d, f), body); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', msg); return sh(d, 'rev-parse', 'HEAD') }
  commit('CHANGELOG.md', skeleton(), 'chore: init'); sh(d, 'branch', 'dev')
  const cfg = defaults(); cfg.worktrees.root = `${d}-wt`; cfg.units = [{ root: '.', checks: { setup: ['true'], test: ['true'] } }]; cfg.jail = 'off'
  const h = fakeHost(); Object.assign(h, { cwd: async () => d, home: async () => d, run, config: async () => cfg, stat: async p => (existsSync(p) ? { kind: 'dir', realPath: p } : undefined), readText: async p => { try { return readFileSync(p, 'utf8') } catch { return null } }, write: async (p, t) => writeFileSync(p, t) })
  await h.secret.update(x => ({ ...x, session: 's1' }))
  const store = await h.taskStore(), epic = await store.createEpic('auth', 'goal'), br = `epic/${epic}-auth`
  sh(d, 'branch', br, 'dev'); sh(d, 'checkout', '-q', br); commit('c.txt', 'c\n', 'feat: login'); sh(d, 'checkout', '-q', 'main')
  const t = await store.createDraft({ title: 'login', description: 'd', type: 'feature', parent: epic, meta: { 'cadre.branch': 'feat/t1-login', 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'login' }) } })
  await store.approve([epic, t.id]); await store.claim(t.id, 'x'); await store.close(t.id, { outcome: 'done' })
  sh(d, 'branch', 'feat/t1-login', 'main'); sh(d, 'branch', 'feat/t9-unrecorded', 'main')
  await h.board.update(b => ({ ...b, seq: 1, epic, plan: { id: epic, slug: 'auth', state: 'approved', epicBranch: br }, tasks: [{ id: t.id, title: 'login', type: 'feature', kind: 'code', merges: true, state: 'done', step: '', phaseSince: 0, deps: [], flags: [] }] }))
  const commits = {}, out = [], sub = v => String(v).replace('$epic', epic)
  const ans = async (id, key) => { const x = ((await h.board.read()).decisions ?? []).find(y => y.id === id); if (!x) return { text: `refused: no dialog ${id}` }; const [cmd, ...args] = x.options.find(o => o.key === key).run.split(' '); return ROUTES[cmd](h, { schemaVersion: 1, cmd, args, origin: { kind: 'dialog' } }) }
  const project = async (op, res) => {
    const files = sh(d, 'ls-tree', '-r', '--name-only', 'dev').split('\n').filter(Boolean)
    out.push({ op, res, checkedOut: sh(d, 'symbolic-ref', '--short', 'HEAD'), devFiles: files, devSubjects: sh(d, 'log', 'dev', '--first-parent', '--format=%s').split('\n').map(x => x.replaceAll(epic, '$epic')), pending: shOk(d, 'rev-parse', '--verify', '-q', pendingRef('dev')),
      branches: sh(d, 'branch', '--format=%(refname:short)').split('\n').sort().map(x => x.replaceAll(epic, '$epic')), status: sh(d, 'status', '--porcelain').split('\n').filter(Boolean),
      worktrees: sh(d, 'worktree', 'list').split('\n').length, userCommitsOnDev: Object.fromEntries(Object.entries(commits).map(([k, v]) => [k, shOk(d, 'merge-base', '--is-ancestor', v, 'dev')])),
      decisions: ((await h.board.read()).decisions ?? []).map(x => x.id.replaceAll(epic, '$epic')), epicReverted: !!(await store.get(epic)).meta['cadre.reverted'] })
  }
  for (const o of s.ops) {
    let res
    switch (o.op) {
      case 'checkout': sh(d, 'checkout', '-q', o.branch); break
      case 'commit': { const c = commit(o.file, o.body, o.msg); if (o.as) commits[o.as] = c; break }
      case 'branch': sh(d, 'branch', sub(o.name), o.from); break
      case 'record': await store.setMeta(t.id, { 'cadre.branch': sub(o.name) }, 'x'); break
      case 'integrate': res = (await integrateEpic(h, epic)) === null ? 'null' : 'text'; break
      case 'land': res = kind(await ROUTES.land(h, { schemaVersion: 1, cmd: 'land', args: ['dev'], origin: { kind: 'dialog' } })); break
      case 'press': res = kind(await ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [sub(o.id)], origin: { kind: 'press' } })); break
      case 'ans': res = kind(await ans(sub(o.id), o.key)); break
      default: throw new Error(`landing: unknown op ${o.op}`)
    }
    await project(o.label ?? o.op, res)
  }
  return out
}

// ---- gate: the red/holds/green gates on real git and a real shell check (tests/dev/tdd-world.mjs); a case is a json file the check reads ----
async function gate(s) {
  const W = await import('./tdd-world.mjs'), { writeFileSync: wf, mkdirSync: mk } = await import('node:fs')
  const w = W.world({ acceptance: s.acceptance, cover: s.cover }), out = [], st = {}
  if (s.holds) w.meta['cadre.holds'] = JSON.stringify(s.holds)
  const cases = o => Object.fromEntries(Object.entries(o).map(([f, c]) => [f, W.tc(c.name, c.status, c.text ?? '')]))
  const project = (op, res) => out.push({ op, res, meta: Object.keys(w.meta).filter(k => k.startsWith('cadre.')).sort(), specCommit: !!w.meta['cadre.specCommit'], blocked: w.meta['cadre.blocked'] ?? null })
  for (const o of s.ops) {
    let res
    switch (o.op) {
      case 'tester': {   // the tester's report at the red gate
        const r = await W.tester(w, cases(o.files), o.tests); Object.assign(st, { wt: r.wt }); w.meta['cadre.worktree'] = r.wt
        const card = r.res.card ?? ''
        res = { ok: r.res.ok, passing: r.res.passing ?? null, setup: !!r.res.setup, failing: Number(/red ✓ (\d+) failing/.exec(card)?.[1] ?? 0), held: [...card.matchAll(/\((S\d+) holds\)/g)].map(m => m[1]) }; break
      }
      case 'write': for (const [f, c] of Object.entries(cases(o.files))) { mk(st.wt, { recursive: true }); wf(`${st.wt}/${f}`, c) }; break
      case 'green': { const g = await W.T.green(w.h, w.d, await W.mkTask(w), st.wt); res = { ok: g.ok }; break }
      case 'holdsRed': res = { red: (await W.T.holdsRed(w.h, w.d, await W.mkTask(w), st.wt)).length }; break
      default: throw new Error(`gate: unknown op ${o.op}`)
    }
    project(o.label ?? o.op, res)
  }
  return out
}

export const RUNNERS = { life, native, landing, gate }
export async function transcript(cell) { const s = script(cell); return RUNNERS[s.kind](s) }
// record: CHAR_RECORD=1 (once, on d0f4cc0); otherwise the transcript must equal the golden
export async function check(cell, t) {
  const f = `${DIR}${cell}.golden.json`, got = t
  if (process.env.CHAR_RECORD) { writeFileSync(f, JSON.stringify(got, null, 1) + '\n'); return }
  assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(readFileSync(f, 'utf8')), `${cell}: transcript differs from ${cell}.golden.json`)
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(await transcript(process.argv[2]), null, 1))
