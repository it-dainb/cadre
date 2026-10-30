// Spec-first TDD gates (DESIGN 3.5): copy-in by path, red and green through the gate primitive (core/gate), lock, spec_change.
// Entry points for core/close: testerDone (tester report), green (worker report), specChange (owner report), lockedViolations (close), resolveSpec (/cadre resolve).
import { modOn, spawnIt } from './render'
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { active, covers, pipeOf } from './pipeline'
import { resolveDeps, type Deps } from './admission'
import { apply } from './machine'
import { emit } from './events'
import { ask, yoloOn } from './decide'
import { flagDecision } from './flags'
import { fnv1a64 } from './board'
import * as G from './git'
import { modelText } from './say'
import { baseOf } from './branches'
import { auditView, matches, pkgOf, rootOf, type Pkg } from './specview'
import { holdsOf, itemsOf, specScenario, specTestsOf, untested } from './validate'
import { adopt, find, runGate, type Declared } from './gate'
import type { Result } from './junit'
import { policyOf, setPolicy } from '../policy/guards'
import { reset, step } from './lifecycle'

export interface Gate { ok: boolean; why?: string; card: string; tests?: Declared; setup?: true; passing?: string[]; secs?: number; structural?: true }   // passing: the scenario ids whose test passed at red (the dialog offers them as already holding)   // setup: the check is broken, not the work (the config must change); the task blocks at once   // structural: red held through valid JUnit results

export const verifyOf = (p: Pkg) => (p.verify?.length ? p.verify : [p.checks.test ? 'test' : Object.keys(p.checks).find(k => k !== active().landing.prepare)!])
export const redOf = (p: Pkg) => p.tdd?.check ?? (verifyOf(p).includes('test') ? 'test' : verifyOf(p)[0])
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const names = (xs: string[]) => xs.slice(0, 5).join(', ')

// ---- red (5): the check (or the tester's own run, ADR 0023) at specCommit must fail for every declared test but the held ones; `pass`: the `test` type has no red, its tests must pass instead ----
// only: the scenario a spec_change Accept amended: the first red after it requires failing only for the tests that declare it (the others must still run), see the verdict's `only`
// `holds` (the plan's: scenarios whose behaviour already exists): their tests must PASS at red; each held scenario needs a test that declares it with held ids only
export interface TestRun { command: string[]; cwd?: string }
const holdsGapOf = (task: Task, dec: Declared) => { const hs = holdsOf(task), x = hs.find(id => !dec.some(t => t.ids.includes(id) && t.ids.every(i => hs.includes(i)))); return x ? `no test declares ${x} alone, which the plan says already holds: write a test for it that passes now, with that id` : null }
const amendedGap = (dec: Declared, only?: string) => only && !dec.some(t => t.ids.includes(only)) ? `no test declares ${only}, the scenario that was amended: write a test for it, with that id, that fails now` : null
export async function red(h: Host, d: Deps, task: Task, wt: string, pkg: Pkg, dec: Declared, o: { pass?: boolean; only?: string; run?: TestRun } = {}): Promise<Gate> {
  const slot = o.run ? 'test' : redOf(pkg), argv = o.run?.command ?? pkg.checks[slot], no = (why: string, x: Partial<Gate> = {}): Gate => ({ ok: false, why, card: `red ✗ ${why}`, ...x })
  if (!argv) throw new Error(`${pkg.root}: no check "${slot}"`)
  const gap = o.pass ? null : holdsGapOf(task, dec) ?? amendedGap(dec, o.only); if (gap) return no(gap)
  const { r, v } = await runGate(h, d, { task, wt, pkg, slot, argv, cwd: o.run?.cwd, expect: o.pass ? 'pass' : 'fail', declared: dec, held: holdsOf(task), only: o.only, phase: o.pass ? 'pass' : 'red', label: o.run ? 'spec tests' : undefined })
  if (v.v !== 'ok') return no(v.why, v.v === 'error' ? { setup: true } : { passing: v.passing })
  const rs = r.results, hs = holdsOf(task), t = secs(r.ms), s = (n: string) => rs && find(rs, n), structural = rs ? { structural: true as const } : {}, sk = Math.round(r.ms / 1000)
  if (o.pass) return { ok: true, card: `tests ✓ pass (${t})`, tests: dec, secs: sk, ...structural }
  const lines = dec.map(x => `- ${x.name}: ${s(x.name)?.status === 'fail' ? (s(x.name)?.text ?? '').slice(0, 120) : s(x.name)?.status === 'pass' ? `passed${x.ids.length && x.ids.every(i => hs.includes(i)) ? ` (${x.ids[0]} holds)` : ''}` : s(x.name)?.status}`), n = rs?.filter(x => x.status === 'fail').length
  return { ok: true, card: rs ? `red ✓ ${n} failing (${t})\n${lines.join('\n')}${v.skipped.length ? `\nskipped: ${names(v.skipped)}` : ''}` : `red ✓ exit=${r.exit} (${t})`, tests: dec, secs: sk, ...structural }
}

// the held scenarios' tests on a task's tree, after its base moved: the names that no longer pass (the plan said they already hold)
export async function holdsRed(h: Host, d: Deps, task: Task, wt: string): Promise<string[]> {
  const hs = holdsOf(task), pkg = pkgOf(d, task); if (!hs.length || !pkg?.tdd) return []
  const mine = (specTestsOf(task) ?? []).filter(t => t.ids.some(i => hs.includes(i))), slot = redOf(pkg), { r } = await runGate(h, d, { task, wt, pkg, slot, argv: pkg.checks[slot], expect: 'pass', declared: mine })
  return r.results ? mine.map(t => t.name).filter(n => find(r.results!, n)?.status !== 'pass') : r.exit ? mine.map(t => t.name) : []   // no results: the exit is all there is
}

// ---- failure baseline (ADR 0014 G, generalises knownRed): a check that was red when the plan started gates only on NEW failures. Measured once per plan and
// check, lazily (the first time it fails), at the plan's start commit (merge-base of the plan branch and dev) in a throwaway worktree; kept in epic meta cadre.baseline ----
type Base = { exit: number; fails?: string[] }
const failing = (rs?: Result[]) => rs?.filter(x => x.status === 'fail' || x.status === 'error').map(x => x.name)
async function baseline(h: Host, d: Deps, pkg: Pkg, name: string): Promise<Base | null> {
  const s = await h.board.read(), br = s.plan?.epicBranch; if (!s.epic || !br) return null
  const key = `${pkg.root}:${name}`, all = JSON.parse((await d.store.get(s.epic)).meta['cadre.baseline'] || '{}') as Record<string, Base>
  if (all[key]) return all[key]
  const start = (await G.git(h.run, d.root, ['merge-base', br, await baseOf(h, d.cfg.branches.dev)])).trim(), tmp = `${d.wtRoot}/${d.key}.scratch/baseline`, root = rootOf(pkg) ? `${tmp}/${pkg.root}` : tmp
  await h.run(['git', '-C', d.root, 'worktree', 'add', '-f', '--detach', tmp, start]); await h.run(['mkdir', '-p', `${tmp}-s`])
  const sub = await G.subInit(h.run, d.root, tmp); if (sub) { h.log(`baseline: ${sub}`); await h.run(['git', '-C', d.root, 'worktree', 'remove', '--force', tmp]); return null }   // no baseline: every red is the task's
  try {
    const su = pkg.checks[active().landing.prepare ?? '']; if (su?.length) await h.run(d.cfg.jail === 'off' ? su : G.writableJail({ wt: tmp, scratch: `${tmp}-s`, pkgRoot: root, argv: su, writable: d.cfg.jailWritable }), { cwd: root })
    const { r } = await runGate(h, d, { task: { id: 'baseline' }, wt: tmp, pkg, slot: name, argv: pkg.checks[name], expect: 'pass' }); all[key] = { exit: r.exit, ...(r.results ? { fails: failing(r.results) } : {}) }
  } finally { await h.run(['git', '-C', d.root, 'worktree', 'remove', '--force', tmp]); await h.run(['rm', '-rf', `${tmp}-s`]) }
  await d.store.setMeta(s.epic, { 'cadre.baseline': JSON.stringify(all) }, d.actor)
  return all[key]
}
// null = a new failure (the gate fails); else why it is not new. With results: fails no test that passed at the start; without: the check was red then too
async function tolerated(h: Host, d: Deps, pkg: Pkg, name: string, rs?: Result[]): Promise<string | null> {
  const b = await baseline(h, d, pkg, name).catch(() => null); if (!b?.exit) return null
  const now = failing(rs); if (now && b.fails) return now.some(n => !b.fails!.includes(n)) ? null : `${name} fails only where it failed before the plan`
  return now ? null : `${name} was already red before the plan`
}

const testRunOf = (d: Deps, task: Task): TestRun | null => { try { return task.meta['cadre.testRun'] ? JSON.parse(task.meta['cadre.testRun']) : null } catch { return null } }
// ---- green (9): verify at the current tree passes (or fails only as it did before the plan); the spec tests present and passing (skipped != passed); knownRed runs but never gates ----
export async function green(h: Host, d: Deps, task: Task, wt: string): Promise<Gate> {
  const pkg = pkgOf(d, task); if (!pkg) return { ok: false, why: 'no package', card: 'green ✗ no package' }
  const spec = specTestsOf(task) ?? [], tr = testRunOf(d, task), vf = verifyOf(pkg), checks = [...new Set([...vf, ...(spec.length && !tr ? [redOf(pkg)] : [])])]
  const no = (why: string): Gate => ({ ok: false, why, card: `green ✗ ${why}` }), notPassed = (rs?: Result[]) => spec.map(t => t.name).filter(n => find(rs ?? [], n)?.status !== 'pass')
  let ms = 0; const kr: string[] = []
  if (tr) {   // the worker's step runs the tester's command too, now expected to pass, plus the package checks
    const { r, v } = await runGate(h, d, { task, wt, pkg, slot: 'test', argv: tr.command, cwd: tr.cwd, expect: 'pass', declared: spec, phase: 'green', label: 'spec tests' }); ms += r.ms
    if (v.v !== 'ok') return no(`the spec tests fail: ${v.why}`)
    const bad = notPassed(r.results); if (bad.length) return no(`spec test(s) not passed: ${names(bad)}`)
  }
  for (const n of checks) {
    const sp = n === redOf(pkg) && !tr ? spec : [], { r, v } = await runGate(h, d, { task, wt, pkg, slot: n, argv: pkg.checks[n], expect: 'pass', declared: sp, phase: vf.includes(n) ? 'green' : undefined }); ms += r.ms
    if (v.v === 'error') return no(`${n}: ${v.why}`)
    if (v.v === 'bad' && vf.includes(n)) { const k = await tolerated(h, d, pkg, n, r.results); if (!k) return no(`${n}: ${v.why}`); kr.push(k) }
    const bad = sp.length ? notPassed(r.results) : []; if (bad.length) return no(`spec test(s) not passed: ${names(bad)}`)   // skipped != passed
  }
  for (const n of pkg.knownRed ?? []) if (pkg.checks[n]) kr.push(`${n}=${(await runGate(h, d, { task, wt, pkg, slot: n, argv: pkg.checks[n], expect: 'pass' })).r.exit}`)
  return { ok: true, secs: Math.round(ms / 1000), card: `green ✓ ${[...(tr ? ['spec tests'] : []), ...checks].join('+')} (${secs(ms)})${kr.length ? ` · knownRed ${kr.join(' ')}` : ''}` }
}

// ---- copy-in (4): view files under tdd.paths, only those, by path; skeleton for contract items with status new; one commit = specCommit ----
export async function copyIn(h: Host, d: Deps, task: Task, wt: string, view: string, pkg: Pkg): Promise<string> {
  const root = rootOf(pkg), scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}-in`, paths = pkg.tdd?.paths ?? []
  const files = (await G.must(h.run, ['find', '.', '-type', 'f', '-print0'], { cwd: view }, 'listing the view failed', '\0')).map(p => (p.startsWith('./') ? p.slice(2) : p)).filter(p => matches(paths, p) && p !== 'SCENARIOS.md' && p !== 'INTERFACE.md')
  if (!files.length) throw new Error('the tester wrote no files under tdd.paths')
  await h.run(['mkdir', '-p', scratch]); const dest = root ? `${wt}/${root}` : wt
  for (const [argv, o] of [[['tar', '-cf', `${scratch}/in.tar`, '-C', view, '-T', '-'], { stdin: files.join('\n') }], [['tar', '-xf', `${scratch}/in.tar`, '-C', dest], {}]] as const) {
    await G.must(h.run, argv, { cwd: view, ...o }, 'copy-in failed')
  }
  await h.run(['rm', '-rf', scratch])
  if (pkg.tdd?.skeleton && itemsOf(task.design).some(x => x.status === 'new')) {   // signature-only stubs, writable jail, network off is not required (3.10)
    const sc = `${d.wtRoot}/${d.key}.scratch/${task.id}`, env = { CADRE_CONTRACT: `${view}/INTERFACE.md` }, pkgRoot = root ? `${wt}/${pkg.root}` : wt
    await h.run(['mkdir', '-p', sc])
    await (d.cfg.jail === 'off' ? G.must(h.run, pkg.tdd.skeleton, { cwd: pkgRoot, env }, 'skeleton failed') : G.must(h.run, G.writableJail({ wt, scratch: sc, pkgRoot, argv: pkg.tdd.skeleton, writable: d.cfg.jailWritable, env }), {}, 'skeleton failed'))
  }
  const sha = await G.op(h, () => G.commitAll(h.run, wt, `wip(${task.id}): spec tests`))
  if (!sha) throw new Error('the spec tests are identical to the base; nothing to lock')
  return sha
}

// ---- lock (7): spec files = diff base..specCommit under tdd.paths; the fence reads absolute paths from $.store policy.locks ----
export async function lockedOf(run: G.Run, wt: string, base: string, spec: string, pkg: Pkg): Promise<string[]> {
  const root = rootOf(pkg)
  return (await G.git(run, wt, ['diff', '--name-only', `${base}..${spec}`])).split('\n').filter(p => p && (!root || p.startsWith(`${root}/`)) && matches(pkg.tdd?.paths ?? [], root ? p.slice(root.length + 1) : p))
}
export async function setLocks(h: Host, id: string, abs: string[]): Promise<void> {
  await setPolicy(h, { locks: { ...(await policyOf(h)).locks, [id]: abs } })
}
// close refuses M/D/R of a locked file since specCommit (adds are fine); returns the offending paths
export async function lockedViolations(run: G.Run, wt: string, spec: string, locked: string[], to = 'HEAD'): Promise<string[]> {
  const out = await G.git(run, wt, ['diff', '--name-status', `${spec}..${to}`])
  return out.split('\n').filter(l => l && 'MDRT'.includes(l[0])).flatMap(l => l.split('\t').slice(1)).filter(p => locked.includes(p))
}

// ---- tester report (3.4 tester -> red✓): audit, copy-in, red, lock, advance. A refused gate leaves the task at the tester step (caller counts the retry). ----
export async function testerDone(h: Host, d: Deps, task: Task, wt: string, view: string, tests: { path: string; name: string; ids?: string[] }[], agentId?: string, run?: TestRun): Promise<Gate> {
  const pkg = pkgOf(d, task); if (!pkg?.tdd) return { ok: false, setup: true, why: 'its package has no tdd config', card: 'red ✗ no tdd config' }
  // live 0.12.1: a package with only a compile check, so red ran compile, it passed, and every report was refused as "the tests pass": the tests never ran. Red needs a check that runs them
  const use = run, noTest = !pkg.tdd.check && redOf(pkg) !== 'test'
  if (noTest && !use) return { ok: false, setup: true, why: `package ${pkg.root} has no test check, so the tests never ran (red would run only "${redOf(pkg)}"); add a "test" check (or tdd.check) to its package in .cadre/config.json`, card: 'red ✗ no test check' }
  const steps = pipeOf(task.type, task.meta['cadre.lane']), hasRed = steps.includes('red'), au = await auditView(h, d, task, view, agentId), dec: Declared = tests.map(t => ({ name: t.name, ids: t.ids ?? [] }))
  if (hasRed && !dec.length) return { ok: false, why: 'tests: declare every test you wrote, as tests[{path,name,ids}] with the scenario ids it checks', card: 'red ✗ no tests declared' }
  const pre = await G.tip(h.run, wt, 'HEAD'), undo = () => G.op(h, async () => { await G.git(h.run, wt, ['reset', '--hard', '-q', pre]); await G.git(h.run, wt, ['clean', '-fdq']) }).catch(() => {})   // a refused gate must not leave the copy-in behind (a retry would see "identical")
  let spec: string
  try { spec = await copyIn(h, d, task, wt, view, pkg) } catch (e) { await undo(); return { ok: false, why: String((e as Error).message), card: `red ✗ ${(e as Error).message}` } }
  const only = hasRed ? task.meta['cadre.redOnly'] || undefined : undefined, g = await red(h, d, task, wt, pkg, dec, { pass: !hasRed, only, run: use }), card = `${g.card}\n${au.text}`
  if (!g.ok) { await undo(); return { ...g, card } }
  const miss = covers(task.type) ? untested(task.acceptance, dec) : []   // ADR 0022: a scenario no test declares never reaches the worker
  if (miss.length) { await undo(); return { ok: false, why: `no test declares ${miss.join(', ')}: write a test for every scenario and list its id in that test's ids (e.g. ids ["${miss[0]}"])`, card: `red ✗ no test for ${miss.join(', ')}` } }
  const base = task.meta['cadre.base'] ?? spec, locked = await lockedOf(h.run, wt, base, spec, pkg)
  await setLocks(h, task.id, locked.map(p => `${wt}/${p}`))
  await d.store.setMeta(task.id, { 'cadre.specCommit': spec, 'cadre.redOnly': '', 'cadre.red': card, 'cadre.specTests': JSON.stringify(dec), 'cadre.coverVia': g.structural ? 'results' : 'report',   // effective coverage: the gate's results, else the reviewer's coverage list
     'cadre.locked': JSON.stringify(locked), 'cadre.testRun': use ? JSON.stringify(use) : '', ...(steps.includes('worker') ? {} : { 'cadre.sourceCommit': spec }) }, d.actor)
  const adopted = use && noTest && !pkg.checks.test && g.structural && use.command.some(a => a.includes('CADRE_JUNIT')) ? await adopt(h, d, pkg, use, tests.map(t => t.path), task.id) : null
  for (let i = 0; i < (hasRed ? 2 : 1); i++) await apply(h, { kind: 'advance', id: task.id, at: await h.now(), actor: 'mod' })   // tester -> red -> worker
  const nx = (await h.board.read()).tasks.find(x => x.id === task.id)?.step; if (nx) await d.store.setMeta(task.id, { 'cadre.step': nx }, d.actor)   // the store keeps the step: a /clear rebuilds the board from it (a worker's report was refused 'active·tester')
  if (adopted) h.log(adopted)   // the human's (Activity, decisions); the tester is not told
  return { ...g, card }
}

// ---- spec_change (8): owner report -> blocked; the human decides with /cadre resolve <id> accept|reject ----
// the spec_change card (the worker's reason on it); also re-asked after /clear from the task's own record (core/session)
// A task with no tester step (a lite or feature task) cannot take Accept (resolveSpec refuses it): its card offers Reject or Cancel task, never an answer that
// is refused and re-asked (quick tier continue-after-quit: Accept on a feature task, refused and shown again until the budget ran out).
export async function specAsk(h: Host, id: string, why: string, scenario = ''): Promise<void> {
  const t = (await h.board.read()).tasks.find(x => x.id === id)
  const stuck = !!t && (await resolveDeps(h).then(async d => !!(await d.store.get(id)).meta['cadre.specReset']).catch(() => false))   // Accept already failed on a real conflict
  const acc = !stuck && (!t || (await resolveDeps(h).then(d => pipeOf(t.type, t.lane).includes('tester')).catch(() => true)))
  await ask(h, flagDecision(id, 'spec_change', undefined, { hash: fnv1a64(why), lines: ['the worker asks to change the locked spec', ...why.slice(0, 400).split('\n').filter(Boolean), ...(scenario ? [`new scenario wording: ${scenario.slice(0, 300)}`] : []), acc ? 'Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.' : `${stuck ? 'The spec change could not be applied to its working folder (a conflict).' : 'This task has no step that rewrites its tests.'} Reject: it conforms to the brief and its tests. Cancel task: it ends here.`], keys: acc ? undefined : ['x', 'c'] })!)   // the reason is on the card; emit's generic flag decision then keeps this one
}
export async function specChange(h: Host, d: Deps, id: string, why: string, scenario = ''): Promise<void> {
  await apply(h, { kind: 'block', id, at: await h.now(), actor: 'mod' }); await d.store.move(id, 'blocked', d.actor).catch(() => undefined)
  await d.store.setMeta(id, { 'cadre.blocked': 'spec_change', 'cadre.specChange': why.slice(0, 1500), 'cadre.specScenario': scenario.slice(0, 300) }, d.actor)
  if (yoloOn((await h.board.read()).drive)) return   // yolo: main decides it (core/drive asks main, core/close.decide applies it)
  await specAsk(h, id, why, scenario)
  h.toast(`${id} spec change · press 1`)
}
// accept: back to the tester step (the view is rebuilt from the spec commit when it is spawned: new red, amended specCommit); reject: the worker resumes and conforms
export async function resolveSpec(h: Host, id: string, how: string, by: 'human' | 'main' = 'human', reason = ''): Promise<{ text: string; ok?: boolean }> {   // main: yolo's own decision
  const d = await resolveDeps(h), t = (await h.board.read()).tasks.find(x => x.id === id), task = t && (await d.store.get(id))
  if (!t || t.state !== 'blocked' || task?.meta['cadre.blocked'] !== 'spec_change') return { text: `${id} is not waiting on a spec change` }
  if (how !== 'accept' && how !== 'reject') return { text: `/cadre resolve ${id} accept|reject` }
  const acc = how === 'accept', sp = (x: string) => spawnIt(snap, x), snap = await h.board.read()
  if (acc && !pipeOf(t.type, t.lane).includes('tester')) return { text: `${id}: type ${t.type} has no tester step; reject instead` }
  if (acc && task!.meta['cadre.specReset']) return { text: modelText('tool-result', `${id}: the spec change could not be applied to its working folder; reject instead, or cancel the task.`) }
  // the red gate runs on the worktree: with the worker's commits still in it the amended tests pass (live: "the tests pass at the spec commit" after an Accept), so drop them; the spec commit is the tree the tester amends.
  // Before the board moves: a refused or failed reset leaves the task blocked, to answer again. A rework merge of the plan tip (core/rebase) came after the spec: it is put back, or the landed tasks vanish from the tree
  if (acc) {
    const wt = task!.meta['cadre.worktree'], sc = task!.meta['cadre.specCommit'], base = task!.meta['cadre.base']
    if (!wt || !sc) return { text: modelText('tool-result', `${id}: its spec tests or its working folder are not recorded, so the spec cannot be amended; reject instead, or cancel the task.`) }
    let pre = ''
    try {
      await G.op(h, async () => {
        pre = await G.tip(h.run, wt, 'HEAD')   // a failed step puts the worktree back exactly here
        await G.git(h.run, wt, ['reset', '--hard', '-q', sc]); await G.git(h.run, wt, ['clean', '-fdq'])
        if (base && (await h.run(['git', '-C', wt, 'merge-base', '--is-ancestor', base, 'HEAD'])).exitCode) await G.git(h.run, wt, ['merge', '--no-ff', '--no-edit', '-q', '-m', `merge the plan tip into ${id}`, base])
      })
    } catch (e) { h.log(`${id}: reset for the spec change failed: ${e}`)
      const conflict = await G.ok(h.run, wt, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])   // a fact of the worktree, not parsed text: a real conflict never passes by waiting
      await h.run(['git', '-C', wt, 'merge', '--abort'])
      if (pre) await G.op(h, async () => { await G.git(h.run, wt, ['reset', '--hard', '-q', pre]); await G.git(h.run, wt, ['clean', '-fdq']) }).catch((x: Error) => h.log(`${id}: the worktree could not be put back: ${x}`))   // the worker's code stays: the task stays blocked, spec unamended
      if (conflict) {   // deterministic: ask again with a card that offers no Accept, so the same answer cannot loop
        await d.store.setMeta(id, { 'cadre.specReset': 'conflict' }, d.actor); await specAsk(h, id, `${task!.meta['cadre.specChange'] ?? ''}\nThe spec change could not be applied: the working folder conflicts with the reset.`, task!.meta['cadre.specScenario'] ?? '')
        return { text: modelText('tool-result', `${id}: the spec change could not be applied to its working folder; the human decides: reject, or cancel the task.`) } }
      return { text: modelText('tool-result', `${id}: the working folder could not be reset right now; answer again in a moment.`) } }
    await d.store.setMeta(id, { 'cadre.sourceCommit': '' }, d.actor)
  }
  const r = await apply(h, acc ? { kind: 'rewind', id, at: await h.now(), actor: by, on: 'tester' } : { kind: 'unblock', id, at: await h.now(), actor: by })
  if (!r.ok) return { text: r.error }
  await d.store.resume(id, d.actor)   // the store follows the board out of blocked (as unblock does), or the next report cannot move it
  if (acc) await reset(h, id, 'red')   // the refusals before the change were for the old tests: the amended ones get their own rounds
  // The scenario the worker proposed goes into the spec as it stands (the tester reads the scenarios, never the worker's reason). The tester's own note holds only
  // what the decider said (main under yolo; the human's dialog has no text): the worker's reason is implementation talk and never crosses to the tester
  const sc = specScenario(task!.meta['cadre.specScenario'] ?? '')   // the guard: report time already refused anything else
  if (acc && sc) { const lines = (task!.acceptance ?? '').split('\n'), at = lines.findIndex(l => l.startsWith(`${sc[0]}:`)); at >= 0 ? (lines[at] = `${sc[0]}: ${sc[1]}`) : lines.push(`${sc[0]}: ${sc[1]}`); await d.store.update(id, { acceptance: lines.join('\n') }, d.actor) }
  const note = acc ? `spec change accepted: ${task!.meta['cadre.specChange'] ?? ''}` : 'spec change rejected: the locked tests stay; conform to them'
  await d.store.setMeta(id, { 'cadre.blocked': '', 'cadre.specReset': '', 'cadre.decision': note.slice(0, 1500), ...(acc ? { 'cadre.redOnly': sc ? sc[0] : '', 'cadre.specDecision': `The spec change was accepted${sc ? ' and the scenarios above are the amended ones' : ''}${reason ? `: ${reason.slice(0, 300)}` : ''}. Change the tests in your test paths to match the scenarios; they must differ from the ones there now.${sc ? ` A test named after ${sc[0]} must fail now; the other tests must still run, and may pass.` : ''}` } : {}) }, d.actor)
  const bind = await h.bind.read(), w = acc ? undefined : Object.keys(bind).find(a => !a.startsWith('~') && bind[a].taskId === id && bind[a].role === 'worker')
  if (w) await step(h, w, { type: 'resume', text: 'The spec change was rejected: the locked tests stay. Make them pass, then report done.' })   // as unblock does: the worker that asked is waiting
  return { ok: true, text: acc ? `${id}: accepted${modOn(snap) ? '; the tester amends' : '; spawn it for the tester to amend'} the spec (new red, amended specCommit)` : w ? `${id}: rejected; the worker is resumed to conform to the locked tests` : `${id}: rejected${sp('spawn it to resume the worker')}` }
}
