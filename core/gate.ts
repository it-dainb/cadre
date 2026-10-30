// The gate primitive (plan 2.6): run a unit's argv for a named check slot in the jail the slot picks, read the exit code and, when the runner wrote one, the JUnit file
// at $CADRE_JUNIT (core/junit), and judge it (verdict). stdout and stderr are never parsed: the agent gets the tail of them as data. No regex here.
import type { Host } from '../types'
import * as G from './git'
import { modeOf, rootOf, type Pkg } from './specview'
import { type Deps } from './admission'
import { emit } from './events'
import { readJunit, type Result } from './junit'
import { modelData } from './say'
import { scoped } from '../commands/init'
import { active } from './pipeline'

export type Declared = { name: string; ids: string[] }[]   // the tester's tests: name as its runner prints it, ids = the scenarios it checks
export interface GateResult { exit: number; results?: Result[]; bad?: string; timedOut: boolean; tail?: () => string }   // tail: the last of the runner's output, built (and lint-checked) only where a message uses it
export interface Opts { expect: 'pass' | 'fail'; failExit?: number[]; declared?: Declared; held?: string[]; only?: string /* the scenario a spec change amended: the other declared tests must run, and may pass */ }
// error = the CHECK is broken, not the work; bad = the work fails the expectation (passing: scenario ids whose test passed where red was needed)
export type Verdict = { v: 'ok'; skipped: string[] } | { v: 'bad' | 'error'; why: string; passing?: string[] }
const slotOf = (name: string): { network?: boolean; failExit?: number[]; timeoutS?: number } => (active().checks as Record<string, any>)[name] ?? {}
export const find = (rs: Result[], name: string) => rs.find(r => r.name === name || r.name.endsWith(`.${name}`))   // the runner prints classname.name; the tester may leave the class out
const list = (xs: string[]) => xs.slice(0, 5).join(', ')

export function verdict(r: GateResult, o: Opts): Verdict {
  const fx = o.failExit ?? [1], dec = o.declared ?? [], res = r.results, held = o.held ?? [], tail = () => (r.tail ? `: ${r.tail().slice(-300)}` : '')
  const bad = (why: string, passing?: string[]): Verdict => ({ v: 'bad', why, ...(passing?.length ? { passing } : {}) }), error = (why: string): Verdict => ({ v: 'error', why })
  if (r.timedOut) return error('the check timed out; it may be stuck, or the tests need more time')
  if (r.exit !== 0 && !fx.includes(r.exit)) return error(`the check could not run (exit=${r.exit})${tail()}`)
  if (r.bad) return error(r.bad)
  if (!res && dec.length) return error('its tests were declared but the check wrote no JUnit results: make the runner write JUnit XML to $CADRE_JUNIT')
  const ran = (d: Declared[number]) => res && find(res, d.name), skipped = res?.filter(x => x.status === 'skip').map(x => x.name) ?? [], miss = dec.filter(d => res && !ran(d)).map(d => d.name)
  if (miss.length) return bad(`test${miss.length > 1 ? 's' : ''} not run: ${list(miss)} (write each name exactly as the runner prints it)`)
  if (o.expect === 'pass') {
    if (r.exit) return bad(`the check fails (exit=${r.exit})${tail()}`)
    const f = res?.filter(x => x.status === 'fail' || x.status === 'error').map(x => x.name)
    return f?.length ? bad(`exit 0 but ${list(f)} failed: the check disagrees with itself`) : { v: 'ok', skipped }
  }
  const free = (d: Declared[number]) => (!!o.only && !d.ids.includes(o.only)) || (!!d.ids.length && d.ids.every(i => held.includes(i)))   // may pass at red: an unamended scenario's test, or one that already holds
  const stay = [...new Set(dec.filter(d => !free(d)).flatMap(d => d.ids))]
  if (!r.exit) return dec.length && res && dec.every(free) ? { v: 'ok', skipped } : bad(`the tests pass at the spec commit; red needs them failing${tail()}`, stay)   // exit 0 is red only when every declared test is one that already holds
  if (!res) return { v: 'ok', skipped }   // no declared tests: the exit code is all there is (the accepted weaker mode)
  const err = res.filter(x => x.status === 'error').map(x => x.name)
  if (err.length) return bad(`errored instead of failing: ${list(err)}; make it compile and run`)
  if (!res.some(x => x.status === 'fail')) return bad('no test failed; red needs a failing test')
  for (const d of dec) {
    const s = ran(d)!.status, hd = !!d.ids.length && d.ids.every(i => held.includes(i))
    if (hd && s !== 'pass' && s !== 'skip') return bad(`test "${d.name}" fails; ${d.ids[0]} already holds, so it must pass now`)
    if (s === 'pass' && !free(d)) return bad(`test "${d.name}" passed at red; it must fail`, d.ids)
  }
  return { v: 'ok', skipped }
}

// One run of a check slot. `scratch` is this run's own folder (the jail binds it at /tmp): the in-jail $CADRE_JUNIT is /tmp/cadre/junit-<slot>.xml, core reads
// <scratch>/cadre/junit-<slot>.xml; with no jail the host path is passed. The slot's `network` (profile data, never the unit's) picks the jail.
export async function runSlot(h: Host, o: { mode: 'overlay' | 'copy' | 'none'; wt: string; scratch: string; pkgRoot: string; argv: readonly string[]; slot: string; writable?: readonly string[] }): Promise<GateResult & { ms: number }> {
  const s = slotOf(o.slot), file = `${o.scratch}/cadre/junit-${o.slot}.xml`, jx = o.mode === 'none' ? file : `/tmp/cadre/junit-${o.slot}.xml`, timeoutMs = (s.timeoutS ?? 600) * 1000
  await h.run(['mkdir', '-p', '-m', '700', `${o.scratch}/cadre`])
  const argv = o.argv.map(a => a.split('${CADRE_JUNIT}').join(jx).split('$CADRE_JUNIT').join(jx)), j = { wt: o.wt, scratch: o.scratch, pkgRoot: o.pkgRoot, argv, writable: o.writable, env: { CADRE_JUNIT: jx } }, t0 = await h.now()
  let r: { exitCode: number; stdout: string; stderr: string }, timedOut = false
  try { r = s.network ? await h.run(o.mode === 'none' ? argv : G.writableJail({ ...j, env: { ...(await G.jailEnv(h.run)), ...j.env } }), { cwd: o.pkgRoot, env: j.env, timeoutMs }) : await G.checkRun(h.run, o.mode, j, timeoutMs) } catch { r = { exitCode: -1, stdout: '', stderr: '' }; timedOut = true }
  const ms = (await h.now()) - t0, { results, bad } = await readJunit(h, file, o.scratch)
  return { exit: r.exitCode, results, bad, timedOut: timedOut || ms >= timeoutMs, ms, tail: () => modelData('tool-result', `${r.stdout}${r.stderr}`.split(o.wt).join('.').split(o.scratch).join('tmp').slice(-600)) }
}

// A task's gate: slot `slot` over `argv` (the unit's check, or the tester's run) at `wt`, judged by `verdict`. `phase` announces check.ran.
export async function runGate(h: Host, d: Deps, o: Opts & { task: { id: string }; wt: string; pkg: Pkg; slot: string; argv: readonly string[]; cwd?: string; phase?: 'red' | 'green' | 'pass'; label?: string }) {
  const mode = await modeOf(h, d), scratch = `${d.wtRoot}/${d.key}.scratch/${o.task.id}-${o.slot}-${h.rand(4)}`, at = rootOf(o.pkg) ? `${o.wt}/${o.pkg.root}` : o.wt
  try {
    const r = await runSlot(h, { mode, wt: o.wt, scratch, pkgRoot: o.cwd ? `${at}/${o.cwd}` : at, argv: o.argv, slot: o.slot, writable: d.cfg.jailWritable }), v = verdict(r, { ...o, failExit: slotOf(o.slot).failExit })
    const failing = r.results?.filter(x => x.status === 'fail' || x.status === 'error').length
    if (o.phase) await emit(h, 'check.ran', { taskId: o.task.id, name: o.label ?? o.slot, ok: (o.phase === 'red') === !!r.exit, phase: o.phase === 'pass' ? 'green' : o.phase, secs: Math.round(r.ms / 1000), ...(failing ? { failing } : {}), ...(o.label ? { exit: r.exit } : {}) }, { taskId: o.task.id })
    return { r, v }
  } finally { await h.run(['rm', '-rf', scratch]) }
}

// config/route fills this at load (like dispatch's ROUTES): the one serialized writer of .cadre/config.json (a static import would close an import cycle through core/dispatch)
export const REPO: { write?(h: Host, mut: (cur: any) => any): Promise<{ ok: true; text: string } | { ok: false; why: string }> } = {}

// ---- adoption (D16, B19): a unit with no test check takes the tester's run argv, with the literal $CADRE_JUNIT, as its "test" check once red held structurally
// (valid JUnit at $CADRE_JUNIT, declared tests failing). cadre writes it to the repo file (never Claude) and records the decision and the probe ----
export async function adopt(h: Host, d: Deps, pkg: Pkg, run: { command: string[]; cwd?: string }, files: string[], id: string): Promise<string | null> {
  if (run.cwd) { h.log(`test check not adopted for ${pkg.root}: the command starts in ${run.cwd}`); return null }   // a check has no cwd and no shell to cd
  const own = (a: string) => files.includes(a.split('::')[0]), keep = run.command.filter(a => !own(a)), test = keep.length && keep.length < run.command.length ? keep : run.command
  const patch = (p: Pkg & { testBy?: string }) => ({ ...p, checks: { ...p.checks, test }, ...(p.verify?.length && !p.verify.includes('test') ? { verify: [...p.verify, 'test'] } : {}), testBy: 'tester' })
  const w = await REPO.write!(h, j => {
    const cur: Pkg[] = Array.isArray(j.units) ? j.units : (d.cfg.units as Pkg[]).map(({ knownRed: _k, ...p }) => p)
    return { ...j, units: cur.some(p => p.root === pkg.root) ? cur.map(p => (p.root === pkg.root ? patch(p) : p)) : [...cur, patch(pkg)] }
  })
  if (!w.ok) { h.log(`test check not adopted for ${pkg.root}: ${w.why}`); return null }
  Object.assign(pkg, patch(pkg))   // this run sees it too (the next load reads the file)
  await h.store.set(await scoped(h, `junit:${pkg.root}`), { ok: true, argv: test })
  const text = `test check set from the tester: ${test.join(' ')}`
  await d.store.record('decision', text, `package ${pkg.root} had no test check; the tester's command for ${id} ran and failed as red needs, so it is now the package's "test" check.`, id).catch(() => undefined)
  await emit(h, 'drive.decided', { kind: 'setting', text, taskId: id }, { taskId: id, actor: 'mod' })
  return text
}

// the probe's four states for a unit (D15, D16): stored by init, read by Doctor and never run from there
export type Probe = 'yes' | 'no' | 'none' | 'unprobed'
export async function probeOf(h: Host, u: Pick<Pkg, 'root' | 'checks'>): Promise<Probe> {
  const t = u.checks.test; if (!t) return 'none'
  const p = (await h.store.get(await scoped(h, `junit:${u.root}`))) as { ok: boolean; argv: string[] } | undefined
  return !p ? 'unprobed' : p.ok && p.argv.join('\0') === t.join('\0') ? 'yes' : 'no'   // a later edit of the argv reads as stale = no
}
