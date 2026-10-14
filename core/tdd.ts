// Spec-first TDD gates (DESIGN 3.5): copy-in by path, red (JUnit + the <error> rule), lock, green (skipped != passed, knownRed never gates), spec_change.
// Entry points for core/close: testerDone (tester report), green (worker report), specChange (owner report), lockedViolations (close), resolveSpec (/cadre resolve).
import type { Host } from '../types'
import type { Task } from '../task-management/store'
import { pipeOf } from '../task-management/registry'
import { resolveDeps, type Deps } from './admission'
import { apply } from './machine'
import { emit } from './events'
import { ask, yoloOn } from './decide'
import { fnv1a64 } from './board'
import * as G from './git'
import { auditView, matches, modeOf, pkgOf, rootOf, type Pkg } from './specview'
import { untested } from './validate'
import { policyOf, setPolicy } from '../policy/guards'
import { step } from './lifecycle'

export interface Gate { ok: boolean; why?: string; card: string; tests?: string[]; setup?: true }   // setup: the tester cannot fix it (the config must change); the task blocks at once
export interface Case { name: string; status: 'passed' | 'failure' | 'error' | 'skipped'; text: string }
export interface Sym { name: string; status: string }

// ---- JUnit reader: <testcase> elements; a child <failure> / <error> / <skipped> decides the status; text = the child's message + body ----
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
export function junit(xml: string): Case[] {
  const attr = (s: string, k: string) => unxml(new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1] ?? '')
  return [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(m => {
    const body = m[2] ?? '', k = /<(failure|error|skipped)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body), cls = attr(m[1], 'classname'), name = attr(m[1], 'name')
    return { name: cls ? `${cls}.${name}` : name, status: (k?.[1] === 'failure' ? 'failure' : k?.[1] === 'error' ? 'error' : k ? 'skipped' : 'passed') as Case['status'], text: k ? unxml(`${attr(k[2], 'message')} ${k[3] ?? ''}`).trim() : '' }
  })
}
const find = (cs: Case[], n: string) => cs.find(c => c.name === n || c.name.endsWith(`.${n}`) || c.name.endsWith(n))
export const symbolsOf = (design?: string): Sym[] => { try { return (JSON.parse(design ?? '{}').symbols ?? []) as Sym[] } catch { return [] } }
// 5: an <error> is a legitimate red only with no skeleton and only when the text names a status:new contract symbol and no existing one (token match on our own data, P6)
export function errorOk(text: string, syms: Sym[], skeleton: boolean): boolean {
  const last = (n: string) => n.split(/[.:#/]+/).filter(Boolean).pop() ?? n, tok = new Set(text.match(/[A-Za-z_$][\w$]*/g))
  return !skeleton && syms.some(s => s.status === 'new' && tok.has(last(s.name))) && !syms.some(s => s.status !== 'new' && tok.has(last(s.name)))
}

// a runner or a module that is not installed is a machine problem no tester round fixes (exit 127, "command not found", execvp, "No module named", "Cannot find module"):
// (a relative or file import is the tester's own path: it stays a tester round) the gate sets `setup`, so the task blocks at once with one dialog naming it. An import of a status:new symbol (no skeleton) is still the right red (errorOk).
export function missing(exit: number, out: string, syms: Sym[], sk: boolean): string | null {
  const l = out.split('\n').find(x => /command not found|execvp/.test(x))
  if (exit === 127 || l) return `the test runner is not installed (missing runner, exit=${exit}): ${(l ?? out.trim().split('\n').pop() ?? '').slice(0, 200)}; install it, then run again`
  const m = out.split('\n').find(x => /No module named|Cannot find module '(?![./])[^']*(?<!\.[cm]?[jt]sx?)'/.test(x) && !errorOk(x, syms, sk))
  return m ? `a module the tests need is not installed (missing module): ${m.trim().slice(0, 200)}; install it, then run again` : null
}

// ---- running a package check offline (G.checkRun: overlay, else a copy of the tree) ----
export const verifyOf = (p: Pkg) => (p.verify?.length ? p.verify : [p.checks.test ? 'test' : Object.keys(p.checks)[0]])
export const redOf = (p: Pkg) => p.tdd?.check ?? (verifyOf(p).includes('test') ? 'test' : verifyOf(p)[0])
async function runCheck(h: Host, d: Deps, task: Task, wt: string, pkg: Pkg, name: string, gate?: 'red' | 'green' | 'pass') {   // gate: the phase whose result is announced (check.ran)
  const argv = pkg.checks[name]; if (!argv) throw new Error(`${pkg.root}: no check "${name}"`)
  const mode = await modeOf(h, d), scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}-chk`, rp = pkg.tdd?.report
  await h.run(['rm', '-rf', scratch]); await h.run(['mkdir', '-p', `${scratch}/cadre`])
  if (rp && mode === 'none') await h.run(['rm', '-f', rp])   // unjailed: the report path is shared across tasks; a stale file must not pass the gate
  const t0 = await h.now(), r = await G.checkRun(h.run, mode, { wt, scratch, pkgRoot: rootOf(pkg) ? `${wt}/${pkg.root}` : wt, argv, writable: d.cfg.jailWritable })
  const xml = rp && name === redOf(pkg) ? await h.readText(mode === 'none' ? rp : `${scratch}${rp.slice(4)}`) : null
  await h.run(['rm', '-rf', scratch])
  const ms = (await h.now()) - t0, cases = xml === null ? undefined : junit(xml), failing = cases?.filter(c => c.status === 'failure' || c.status === 'error').length
  if (gate) await emit(h, 'check.ran', { taskId: task.id, name, ok: (gate === 'red') === !!r.exitCode, phase: gate === 'pass' ? 'green' : gate, secs: Math.round(ms / 1000), ...(failing ? { failing } : {}) }, { taskId: task.id })
  return { exit: r.exitCode, ms, tail: `${r.stdout}${r.stderr}`.slice(-600), cases }
}
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

// ---- red (5): tdd.check at specCommit must fail; with a report every listed test is a <failure>. `pass`: the `test` type has no red; its tests must pass instead ----
export async function red(h: Host, d: Deps, task: Task, wt: string, pkg: Pkg, tests: { name: string }[], pass = false): Promise<Gate> {
  const r = await runCheck(h, d, task, wt, pkg, redOf(pkg), pass ? 'pass' : 'red'), no = (why: string): Gate => ({ ok: false, why, card: `red ✗ ${why}` })
  const mis = r.exit ? missing(r.exit, r.tail, symbolsOf(task.design), !!pkg.tdd?.skeleton) : null; if (mis) return { ok: false, setup: true, why: mis, card: `red ✗ ${mis}` }
  if (pass) return r.exit ? no(`its tests must pass (test task) but exit=${r.exit}: ${r.tail.slice(-300)}`) : { ok: true, card: `tests ✓ pass (${secs(r.ms)})`, tests: r.cases?.map(c => c.name) ?? tests.map(t => t.name) }
  if (!r.exit) return no('the tests pass at the spec commit; red needs them failing')
  if (!pkg.tdd?.report) return { ok: true, card: `red ✓ exit=${r.exit} (${secs(r.ms)})`, tests: tests.map(t => t.name) }
  if (!r.cases) return no('no JUnit report was produced; fix test setup')
  const syms = symbolsOf(task.design), lines: string[] = []
  for (const t of tests) {
    const c = find(r.cases, t.name)
    if (!c) return no(`test "${t.name}" is not in the report`)
    if (c.status === 'passed' || c.status === 'skipped') return no(`test "${t.name}" ${c.status} at red; it must fail`)
    if (c.status === 'error' && !errorOk(c.text, syms, !!pkg.tdd.skeleton)) return no(`errors, not failures: fix test setup ("${t.name}": ${c.text.slice(0, 160)})`)
    lines.push(`- ${t.name}: ${c.text.slice(0, 120)}`)
  }
  return { ok: true, card: `red ✓ ${tests.length} failing (${secs(r.ms)})\n${lines.join('\n')}`, tests: tests.map(t => find(r.cases!, t.name)!.name) }
}

// ---- the tester's own command (ADR 0023: the tester proposes, cadre verifies). Run like a check (offline sandbox, writes discarded, timeout), at the spec
// commit; $CADRE_JUNIT (env, and substituted in the argv: no shell expands it) is where a runner writes JUnit, read back from the scratch ----
export interface TestRun { command: string[]; junit?: string; cwd?: string }
const ABS = /(?<![\w.~-])(?:file:\/\/)?\/(?:[^\s'"\/:]+\/)+/g   // a runner's output names files by absolute path: the tester reads only names relative to its folder
const JX = /\$\{?CADRE_JUNIT\}?/g
async function runTests(h: Host, d: Deps, task: Task, wt: string, pkg: Pkg, run: TestRun, gate: 'red' | 'green' | 'pass') {
  const mode = await modeOf(h, d), scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}-run`, jx = mode === 'none' ? `${scratch}/cadre/junit.xml` : '/tmp/cadre/junit.xml'   // jailed: the scratch is /tmp
  await h.run(['rm', '-rf', scratch]); await h.run(['mkdir', '-p', `${scratch}/cadre`])
  const at = rootOf(pkg) ? `${wt}/${pkg.root}` : wt, t0 = await h.now()
  const r = await G.checkRun(h.run, mode, { wt, scratch, pkgRoot: run.cwd ? `${at}/${run.cwd}` : at, argv: run.command.map(a => a.replace(JX, jx)), writable: d.cfg.jailWritable, env: { CADRE_JUNIT: jx } }, 600000)
  const xml = await h.readText(`${scratch}/cadre/junit.xml`); await h.run(['rm', '-rf', scratch])
  const ms = (await h.now()) - t0, cases = xml === null ? undefined : junit(xml), out = `${r.stdout}\n${r.stderr}`.replace(ABS, '')
  await emit(h, 'check.ran', { taskId: task.id, name: 'spec tests', ok: (gate === 'red') === !!r.exitCode, phase: gate === 'pass' ? 'green' : gate, secs: Math.round(ms / 1000), exit: r.exitCode }, { taskId: task.id })
  return { exit: r.exitCode, ms, out: out.slice(-65536), tail: out.slice(-600), cases }
}
// the first output line that says the tests never ran (tdd.collectErrors), or null
export const collectLine = (out: string, pats: readonly string[]): string | null => {   // pattern order is priority: the first pattern that matches any line names it
  const ls = out.split('\n').map(l => l.replace(/^#\s*/, '').trim())
  for (const p of pats) { const re = new RegExp(p), l = ls.find(x => re.test(x)); if (l) return l.slice(0, 200) }
  return null
}
// without JUnit: some output line names the test and says it failed (node:test "not ok", pytest "FAILED", go "--- FAIL", jest "✕").
// ponytail: a word match on the runner's text; a runner that prints neither the name nor a failure word needs JUnit
const FAILED = /\bnot ok\b|\bFAIL(?:ED|URE|S)?\b|\bfail(?:ed|ing|ure|s)?\b|✕|✗|×/
const failsIn = (out: string, name: string) => { const tail = name.split(/::|[#>]/).pop()!.trim(); return out.split('\n').some(l => (l.includes(name) || (tail.length > 2 && l.includes(tail))) && FAILED.test(l)) }
async function redRun(h: Host, d: Deps, task: Task, wt: string, pkg: Pkg, tests: { name: string }[], run: TestRun, pass: boolean): Promise<Gate> {
  const r = await runTests(h, d, task, wt, pkg, run, pass ? 'pass' : 'red'), no = (why: string): Gate => ({ ok: false, why, card: `red ✗ ${why}` })
  const col = collectLine(r.out, d.cfg.tdd?.collectErrors ?? []), syms = symbolsOf(task.design), sk = !!pkg.tdd?.skeleton
  const didNot = col && !errorOk(col, syms, sk) ? no(`the tests did not run: ${col}`) : null   // an import of a status:new symbol (no skeleton) is the right red, as an <error> is
  const mis = r.exit ? missing(r.exit, r.out, syms, sk) : null; if (mis) return { ok: false, setup: true, why: mis, card: `red ✗ ${mis}` }
  if (pass) return r.exit ? didNot ?? no(`its tests must pass (test task) but exit=${r.exit}: ${r.tail.slice(-300)}`) : { ok: true, card: `tests ✓ pass (${secs(r.ms)})`, tests: r.cases?.map(c => c.name) ?? tests.map(t => t.name) }
  if (!r.exit) return no('the tests pass at the spec commit; red needs them failing')
  if (r.cases) {
    const lines: string[] = []
    for (const t of tests) {
      const c = find(r.cases, t.name)
      if (!c) return didNot ?? no(`test "${t.name}" is not in the JUnit report`)
      if (c.status === 'passed' || c.status === 'skipped') return no(`test "${t.name}" ${c.status} at red; it must fail`)
      if (c.status === 'error' && !errorOk(c.text, syms, sk)) return didNot ?? no(`errors, not failures: fix test setup ("${t.name}": ${c.text.slice(0, 160)})`)
      lines.push(`- ${t.name}: ${c.text.slice(0, 120)}`)
    }
    return { ok: true, card: `red ✓ ${tests.length} failing (${secs(r.ms)})\n${lines.join('\n')}`, tests: tests.map(t => find(r.cases!, t.name)!.name) }
  }
  if (col) return didNot ?? { ok: true, card: `red ✓ exit=${r.exit}: ${col} (${secs(r.ms)})`, tests: tests.map(t => t.name) }
  if (run.junit) return no('no JUnit report was written to $CADRE_JUNIT; make the runner write it there, or leave junit out')
  const miss = tests.find(t => !failsIn(r.out, t.name)); if (miss) return no(`the output does not show test "${miss.name}" failing (exit=${r.exit}): ${r.tail.slice(-300)}`)
  return { ok: true, card: `red ✓ exit=${r.exit}, ${tests.length} failing (${secs(r.ms)})`, tests: tests.map(t => t.name) }
}

// ---- adoption: a package with no test check takes the verified command (minus this task's own test files, when they are separate arguments) as its "test"
// check. cadre writes it to the repo file (never Claude) and records the decision; Settings shows the packages row's source as "tester" ----
export async function adopt(h: Host, d: Deps, pkg: Pkg, run: TestRun, files: string[], id: string): Promise<string | null> {
  if (run.cwd) { h.log(`test check not adopted for ${pkg.root}: the command starts in ${run.cwd}`); return null }   // a check has no cwd and no shell to cd
  const own = (a: string) => files.includes(a.split('::')[0]), keep = run.command.filter(a => !own(a)), argv = keep.length && keep.length < run.command.length ? keep : run.command
  const rp = pkg.tdd?.report ?? '/tmp/cadre/junit.xml', test = argv.map(a => a.replace(JX, rp)), uses = argv.some(a => a.includes('CADRE_JUNIT'))
  const patch = (p: Pkg & { testBy?: string }) => ({ ...p, checks: { ...p.checks, test }, ...(p.verify?.length && !p.verify.includes('test') ? { verify: [...p.verify, 'test'] } : {}), ...(uses && !p.tdd?.report ? { tdd: { ...p.tdd!, report: rp } } : {}), testBy: 'tester' })
  const file = `${d.root}/.cadre/config.json`; let j: any = {}
  try { j = JSON.parse((await h.readText(file)) ?? '{}') } catch { j = {} }
  const list: Pkg[] = Array.isArray(j.packages) ? j.packages : (d.cfg.packages as Pkg[]).map(({ knownRed: _k, ...p }) => p)
  j.packages = list.some(p => p.root === pkg.root) ? list.map(p => (p.root === pkg.root ? patch(p) : p)) : [...list, patch(pkg)]
  await h.write(file, `${JSON.stringify(j, null, 2)}\n`)
  Object.assign(pkg, patch(pkg))   // this run sees it too (the next load reads the file)
  const text = `test check set from the tester: ${test.join(' ')}`
  await d.store.record('decision', text, `package ${pkg.root} had no test check; the tester's command for ${id} ran and failed as red needs, so it is now the package's "test" check.`, id).catch(() => undefined)
  await emit(h, 'drive.decided', { kind: 'setting', text, taskId: id }, { taskId: id, actor: 'mod' })
  return text
}

// ---- failure baseline (ADR 0014 G, generalises knownRed): a check that was red when the plan started gates only on NEW failures. Measured once per plan and
// check, lazily (the first time it fails), at the plan's start commit (merge-base of the plan branch and dev) in a throwaway worktree; kept in epic meta cadre.baseline ----
type Base = { exit: number; fails?: string[] }
const failing = (cs?: Case[]) => cs?.filter(c => c.status === 'failure' || c.status === 'error').map(c => c.name)
async function baseline(h: Host, d: Deps, pkg: Pkg, name: string): Promise<Base | null> {
  const s = await h.board.read(), br = s.plan?.epicBranch; if (!s.epic || !br) return null
  const key = `${pkg.root}:${name}`, all = JSON.parse((await d.store.get(s.epic)).meta['cadre.baseline'] || '{}') as Record<string, Base>
  if (all[key]) return all[key]
  const start = (await G.git(h.run, d.root, ['merge-base', br, d.cfg.branches.dev])).trim(), tmp = `${d.wtRoot}/${d.key}.scratch/baseline`, root = rootOf(pkg) ? `${tmp}/${pkg.root}` : tmp
  await h.run(['git', '-C', d.root, 'worktree', 'add', '-f', '--detach', tmp, start]); await h.run(['mkdir', '-p', `${tmp}-s`])
  try {
    if (pkg.setup?.length) await h.run(d.cfg.jail === 'off' ? pkg.setup : G.writableJail({ wt: tmp, scratch: `${tmp}-s`, pkgRoot: root, argv: pkg.setup, writable: d.cfg.jailWritable }), { cwd: root })
    const r = await runCheck(h, d, { id: 'baseline' } as Task, tmp, pkg, name); all[key] = { exit: r.exit, ...(r.cases ? { fails: failing(r.cases) } : {}) }
  } finally { await h.run(['git', '-C', d.root, 'worktree', 'remove', '--force', tmp]); await h.run(['rm', '-rf', `${tmp}-s`]) }
  await d.store.setMeta(s.epic, { 'cadre.baseline': JSON.stringify(all) }, d.actor)
  return all[key]
}
// null = a new failure (the gate fails); else why it is not new. With a JUnit report: fails no test that passed at the start; without one: the check was red then too
export async function oldFailure(h: Host, d: Deps, pkg: Pkg, name: string, cases?: Case[]): Promise<string | null> {
  const b = await baseline(h, d, pkg, name).catch(() => null); if (!b?.exit) return null
  const now = failing(cases); if (now && b.fails) return now.some(n => !b.fails!.includes(n)) ? null : `${name} fails only where it failed before the plan`
  return now ? null : `${name} was already red before the plan`
}

const testRunOf = (d: Deps, task: Task): TestRun | null => { try { return d.cfg.tdd?.testerCommand.use !== false && task.meta['cadre.testRun'] ? JSON.parse(task.meta['cadre.testRun']) : null } catch { return null } }
// ---- green (9): verify at the current tree passes (or fails only as it did before the plan); spec tests present and passed (skipped != passed); knownRed runs but never gates ----
export async function green(h: Host, d: Deps, task: Task, wt: string): Promise<Gate> {
  const pkg = pkgOf(d, task); if (!pkg) return { ok: false, why: 'no package', card: 'green ✗ no package' }
  const no = (why: string): Gate => ({ ok: false, why, card: `green ✗ ${why}` }), names = [...new Set([...verifyOf(pkg), ...(pkg.tdd?.report ? [redOf(pkg)] : [])])]
  let ms = 0, cases: Case[] | undefined; const kr: string[] = []
  const tr = testRunOf(d, task)
  if (tr) {   // the worker's step runs the tester's command too, now expected to pass, plus the package checks
    const r = await runTests(h, d, task, wt, pkg, tr, 'green'); ms += r.ms
    if (r.exit) return no(`the spec tests fail (exit=${r.exit}): ${r.tail.slice(-300)}`)
    const spec = JSON.parse(task.meta['cadre.specTests'] ?? '[]') as string[], bad = r.cases ? spec.filter(n => find(r.cases!, n)?.status !== 'passed') : []
    if (bad.length) return no(`spec test(s) not passed: ${bad.slice(0, 5).join(', ')}`)
  }
  for (const n of names) {
    const r = await runCheck(h, d, task, wt, pkg, n, verifyOf(pkg).includes(n) ? 'green' : undefined); ms += r.ms; if (n === redOf(pkg)) cases = r.cases
    if (verifyOf(pkg).includes(n) && r.exit) { const k = await oldFailure(h, d, pkg, n, r.cases); if (!k) return no(`${n} fails (exit=${r.exit}): ${r.tail.slice(-300)}`); kr.push(k) }
  }
  if (pkg.tdd?.report && !tr) {   // with the tester's command, its own run checked the spec tests (the names are its runner's)
    const spec = JSON.parse(task.meta['cadre.specTests'] ?? '[]') as string[], bad = spec.filter(n => find(cases ?? [], n)?.status !== 'passed')
    if (bad.length) return no(`spec test(s) not passed: ${bad.slice(0, 5).join(', ')}`)
  }
  for (const n of pkg.knownRed ?? []) if (pkg.checks[n]) kr.push(`${n}=${(await runCheck(h, d, task, wt, pkg, n)).exit}`)
  return { ok: true, card: `green ✓ ${[...(tr ? ['spec tests'] : []), ...names].join('+')} (${secs(ms)})${kr.length ? ` · knownRed ${kr.join(' ')}` : ''}` }
}

// ---- copy-in (4): view files under tdd.paths, only those, by path; skeleton for status:new symbols; one commit = specCommit ----
export async function copyIn(h: Host, d: Deps, task: Task, wt: string, view: string, pkg: Pkg): Promise<string> {
  const root = rootOf(pkg), scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}-in`, paths = pkg.tdd?.paths ?? []
  const files = (await h.run(['find', '.', '-type', 'f', '-print0'], { cwd: view })).stdout.split('\0').filter(Boolean).map(p => p.replace(/^\.\//, '')).filter(p => matches(paths, p) && p !== 'SCENARIOS.md' && p !== 'INTERFACE.md')
  if (!files.length) throw new Error('the tester wrote no files under tdd.paths')
  await h.run(['mkdir', '-p', scratch]); const dest = root ? `${wt}/${root}` : wt
  for (const [argv, o] of [[['tar', '-cf', `${scratch}/in.tar`, '-C', view, '-T', '-'], { stdin: files.join('\n') }], [['tar', '-xf', `${scratch}/in.tar`, '-C', dest], {}]] as const) {
    const r = await h.run(argv, { cwd: view, ...o }); if (r.exitCode) throw new Error(`copy-in failed: ${r.stderr.slice(0, 200)}`)
  }
  await h.run(['rm', '-rf', scratch])
  if (pkg.tdd?.skeleton && symbolsOf(task.design).some(s => s.status === 'new')) {   // signature-only stubs, writable jail, network off is not required (3.10)
    const sc = `${d.wtRoot}/${d.key}.scratch/${task.id}`, env = { CADRE_CONTRACT: `${view}/INTERFACE.md` }, pkgRoot = root ? `${wt}/${pkg.root}` : wt
    await h.run(['mkdir', '-p', sc])
    const r = d.cfg.jail === 'off' ? await h.run(pkg.tdd.skeleton, { cwd: pkgRoot, env }) : await h.run(G.writableJail({ wt, scratch: sc, pkgRoot, argv: pkg.tdd.skeleton, writable: d.cfg.jailWritable, env }))
    if (r.exitCode) throw new Error(`skeleton failed: ${r.stderr.slice(-200)}`)
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
  return out.split('\n').filter(l => /^[MDRT]/.test(l)).flatMap(l => l.split('\t').slice(1)).filter(p => locked.includes(p))
}

// ---- tester report (3.4 tester -> red✓): audit, copy-in, red, lock, advance. A refused gate leaves the task at the tester step (caller counts the retry). ----
export async function testerDone(h: Host, d: Deps, task: Task, wt: string, view: string, tests: { path: string; name: string }[], agentId?: string, run?: TestRun): Promise<Gate> {
  const pkg = pkgOf(d, task); if (!pkg?.tdd) return { ok: false, setup: true, why: 'its package has no tdd config', card: 'red ✗ no tdd config' }
  // live 0.12.1: a package with only a compile check, so red ran compile, it passed, and every report was refused as "the tests pass": the tests never ran. Red needs a check that runs them
  const use = run && d.cfg.tdd?.testerCommand.use !== false ? run : undefined, noTest = !pkg.tdd.check && redOf(pkg) !== 'test'
  if (noTest && !use) return { ok: false, setup: true, why: `package ${pkg.root} has no test check, so the tests never ran (red would run only "${redOf(pkg)}"); add a "test" check (or tdd.check) to its package in .cadre/config.json`, card: 'red ✗ no test check' }
  const pipe = pipeOf(d.reg), steps = pipe(task.type, task.meta['cadre.lane']), hasRed = steps.includes('red'), au = await auditView(h, d, task, view, agentId)
  const pre = await G.tip(h.run, wt, 'HEAD'), undo = () => G.op(h, async () => { await G.git(h.run, wt, ['reset', '--hard', '-q', pre]); await G.git(h.run, wt, ['clean', '-fdq']) }).catch(() => {})   // a refused gate must not leave the copy-in behind (a retry would see "identical")
  let spec: string
  try { spec = await copyIn(h, d, task, wt, view, pkg) } catch (e) { await undo(); return { ok: false, why: String((e as Error).message), card: `red ✗ ${(e as Error).message}` } }
  const g = use ? await redRun(h, d, task, wt, pkg, tests, use, !hasRed) : await red(h, d, task, wt, pkg, tests, !hasRed), card = `${g.card}\n${au.text}`
  if (!g.ok) { await undo(); return { ...g, card } }
  const miss = d.cfg.review.coverage.enforce ? untested(task.acceptance, g.tests ?? []) : []   // ADR 0022: a scenario no test is named after never reaches the worker
  if (miss.length) { await undo(); return { ok: false, why: `no test is named after ${miss.join(', ')}: write a test for every scenario and name it after the scenario id (e.g. "${miss[0]}: …")`, card: `red ✗ no test for ${miss.join(', ')}` } }
  const base = task.meta['cadre.base'] ?? spec, locked = await lockedOf(h.run, wt, base, spec, pkg)
  await setLocks(h, task.id, locked.map(p => `${wt}/${p}`))
  await d.store.setMeta(task.id, { 'cadre.specCommit': spec, 'cadre.red': card, 'cadre.specTests': JSON.stringify(g.tests ?? []), 'cadre.locked': JSON.stringify(locked), 'cadre.testRun': use ? JSON.stringify(use) : '', ...(steps.includes('worker') ? {} : { 'cadre.sourceCommit': spec }) }, d.actor)
  const adopted = use && noTest && !pkg.checks.test && d.cfg.tdd?.testerCommand.adopt !== false ? await adopt(h, d, pkg, use, tests.map(t => t.path), task.id) : null
  for (let i = 0; i < (hasRed ? 2 : 1); i++) await apply(h, { kind: 'advance', id: task.id, at: await h.now(), actor: 'mod' }, pipe)   // tester -> red -> worker
  const nx = (await h.board.read()).tasks.find(x => x.id === task.id)?.step; if (nx) await d.store.setMeta(task.id, { 'cadre.step': nx }, d.actor)   // beads keeps the step: a /clear rebuilds the board from it (a worker's report was refused 'active·tester')
  if (adopted) h.log(adopted)   // the human's (Activity, decisions); the tester is not told
  return { ...g, card }
}

// ---- spec_change (8): owner report -> blocked; the human decides with /cadre resolve <id> accept|reject ----
// the spec_change card (the worker's reason on it); also re-asked after /clear from the task's own record (core/session)
export async function specAsk(h: Host, id: string, why: string): Promise<void> {
  const f = 'spec_change', r = (how: string) => `resolve ${id} ${how}`
  await ask(h, { id: `flag:${id}:${f}`, kind: 'flag', title: `${id} flagged ${f}`, tab: 'epic', sel: id, hash: fnv1a64(why), lines: ['the worker asks to change the locked spec', ...why.slice(0, 400).split('\n').filter(Boolean), 'Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.'],
    options: [{ key: 'a', label: 'Accept', verb: 'accept', run: r('accept') }, { key: 'x', label: 'Reject', verb: 'reject', run: r('reject') }] })   // the reason is on the card; emit's generic flag decision then keeps this one
}
export async function specChange(h: Host, d: Deps, id: string, why: string): Promise<void> {
  await apply(h, { kind: 'block', id, at: await h.now(), actor: 'mod' }, pipeOf(d.reg)); await d.store.move(id, 'blocked', d.actor).catch(() => undefined)
  await d.store.setMeta(id, { 'cadre.blocked': 'spec_change', 'cadre.specChange': why.slice(0, 1500) }, d.actor)
  if (yoloOn((await h.board.read()).drive)) return   // yolo: main decides it (core/drive asks main, core/close.decide applies it)
  await specAsk(h, id, why)
  h.toast(`${id} spec change · press 1`)
}
// accept: back to the tester step (the view is rebuilt from the spec commit when it is spawned: new red, amended specCommit); reject: the worker resumes and conforms
export async function resolveSpec(h: Host, id: string, how: string, by: 'human' | 'main' = 'human'): Promise<{ text: string }> {   // main: yolo's own decision
  const d = await resolveDeps(h), t = (await h.board.read()).tasks.find(x => x.id === id), task = t && (await d.store.get(id))
  if (!t || t.state !== 'blocked' || task?.meta['cadre.blocked'] !== 'spec_change') return { text: `${id} is not waiting on a spec change` }
  if (how !== 'accept' && how !== 'reject') return { text: `/cadre resolve ${id} accept|reject` }
  const pipe = pipeOf(d.reg), acc = how === 'accept'
  if (acc && !pipe(t.type, t.lane).includes('tester')) return { text: `${id}: type ${t.type} has no tester step; reject instead` }
  const r = await apply(h, acc ? { kind: 'rewind', id, at: await h.now(), actor: by, on: 'tester' } : { kind: 'unblock', id, at: await h.now(), actor: by }, pipe)
  if (!r.ok) return { text: r.error }
  await d.store.resume(id, d.actor)   // beads follows the board out of blocked (as unblock does), or the next report cannot move it
  const note = acc ? `spec change accepted: ${task!.meta['cadre.specChange'] ?? ''}` : 'spec change rejected: the locked tests stay; conform to them'
  await d.store.setMeta(id, { 'cadre.blocked': '', 'cadre.decision': note.slice(0, 1500) }, d.actor); await d.store.comment(id, `[cadre:decision v1] ${note}`, d.actor)
  const bind = await h.bind.read(), w = acc ? undefined : Object.keys(bind).find(a => !a.startsWith('~') && bind[a].taskId === id && bind[a].role === 'worker')
  if (w) await step(h, w, { type: 'resume', text: 'The spec change was rejected: the locked tests stay. Make them pass, then report done.' })   // as unblock does: the worker that asked is waiting
  return { text: acc ? `${id}: accepted; spawn it for the tester to amend the spec (new red, amended specCommit)` : w ? `${id}: rejected; the worker is resumed to conform to the locked tests` : `${id}: rejected; spawn it to resume the worker` }
}
