// The gate primitive (plan 2.6): the verdict table, the jail a slot picks, the path of $CADRE_JUNIT, what stdout may not decide, adoption and the one repo-config writer.
// A fake runner answers every process; each case is well under a second.
import { describe, expect, test } from 'claude-code/testing'
import { adopt, find, probeOf, runGate, runSlot, verdict, type Declared, type GateResult } from '../core/gate'
import { CFG_LOCK_MS, writeRepoConfig } from '../config/route'
import { repoKeyOf } from '../commands/init'
import { fakeHost } from './support'
import type { Host } from '../types'
import { active, setProfile } from '../core/pipeline'
import { profile as DEFAULT } from '../profiles/default'

const X = (...rs: [string, GateResult['results'] extends (infer R)[] | undefined ? R['status'] : never][]) => rs.map(([name, status]) => ({ name, status }))
const R = (exit: number, results?: ReturnType<typeof X>, more: Partial<GateResult> = {}): GateResult => ({ exit, results, timedOut: false, ...more })
const dec = (...ids: string[][]): Declared => ids.map((i, n) => ({ name: 'abc'[n], ids: i }))
const fail = { expect: 'fail' as const }, pass = { expect: 'pass' as const }
const v = (r: GateResult, o: Parameters<typeof verdict>[1]) => { const x = verdict(r, o); return x.v === 'ok' ? 'ok' : `${x.v}: ${x.why}` }

describe('verdict: error = the check is broken (never a red), bad = the work fails the expectation', () => {
  test('exit 1, declared tests, no results file, expect fail: error, not ok; the same for malformed XML or a DOCTYPE (bad)', () => {
    expect(v(R(1), { ...fail, declared: dec(['S1']) })).toMatch(/^error: .*write JUnit XML to \$CADRE_JUNIT/)
    expect(v(R(1, undefined, { bad: 'the JUnit file is not valid: x' }), { ...fail, declared: dec(['S1']) })).toBe('error: the JUnit file is not valid: x')
    expect(v(R(1, undefined, { bad: 'a DOCTYPE or entity declaration is refused' }), fail)).toMatch(/^error: a DOCTYPE/)
  })
  test('exit 1 with no declared tests (a cover:report type): exit-only red is ok, the accepted weaker mode; exit 0 is bad', () => {
    expect(v(R(1), { ...fail, declared: [] })).toBe('ok'); expect(v(R(0), { ...fail, declared: [] })).toMatch(/^bad: the tests pass at the spec commit/)
  })
  test('an exit outside {0} + failExit is an error: exit 2 with failExit [1]; failExit [1, 2] makes 2 a failure', () => {
    expect(v(R(2), fail)).toMatch(/^error: the check could not run \(exit=2\)/); expect(v(R(127), pass)).toMatch(/^error: /)
    expect(v(R(2), { ...fail, failExit: [1, 2] })).toBe('ok')
  })
  test('results of 3 cases (1 fail, 2 pass): held [a, b] is ok; held [a] is bad naming b', () => {
    const r = R(1, X(['a', 'pass'], ['b', 'pass'], ['c', 'fail'])), d = dec(['a'], ['b'], ['c'])
    expect(v(r, { ...fail, declared: d, held: ['a', 'b'] })).toBe('ok')
    expect(v(r, { ...fail, declared: d, held: ['a'] })).toMatch(/^bad: test "b" passed at red; it must fail/)
    expect(verdict(r, { ...fail, declared: d, held: ['a'] })).toMatchObject({ passing: ['b'] })
  })
  test('B1: an error result under expect fail is bad ("make it compile and run"), not a gate error', () => {
    expect(v(R(1, X(['a', 'error'], ['c', 'fail'])), { ...fail, declared: dec(['a'], [], ['c']).slice(0, 1) })).toMatch(/^bad: errored instead of failing: a; make it compile and run/)
  })
  test('skip is ignored for the verdict and listed; a declared name missing from the results is bad ("not run")', () => {
    const r = R(1, X(['a', 'fail'], ['b', 'skip'])), x = verdict(r, { ...fail, declared: [{ name: 'a', ids: [] }] })
    expect(x).toEqual({ v: 'ok', skipped: ['b'] })
    expect(v(r, { ...fail, declared: [{ name: 'a', ids: [] }, { name: 'ghost', ids: [] }] })).toMatch(/^bad: test not run: ghost/)
    expect(v(R(1, X(['a', 'pass'], ['b', 'skip'])), fail)).toMatch(/^bad: no test failed/)
  })
  test('timedOut and malformed results are errors; exit 0 with a fail result under expect pass is bad', () => {
    expect(v(R(1, undefined, { timedOut: true }), fail)).toMatch(/^error: the check timed out/)
    expect(v(R(0, X(['a', 'fail'])), pass)).toMatch(/^bad: exit 0 but a failed/); expect(v(R(0, X(['a', 'error'])), pass)).toMatch(/^bad: /)
    expect(v(R(0, X(['a', 'pass'])), { ...pass, declared: dec([]) })).toBe('ok'); expect(v(R(1, X(['a', 'pass'])), pass)).toMatch(/^bad: the check fails \(exit=1\)/)
  })
  test('expect pass with declared names but no JUnit file is an error; without declared names it is exit-only', () => {
    expect(v(R(0), { ...pass, declared: dec([]) })).toMatch(/^error: /); expect(v(R(0), pass)).toBe('ok'); expect(v(R(0, X(['a', 'pass'])), { ...pass, declared: [{ name: 'ghost', ids: [] }] })).toMatch(/^bad: test not run: ghost/)
  })
  test('a spec change amended S4: the unamended tests must run and may pass; a held test must pass', () => {
    const d = [{ name: 'a', ids: ['S1'] }, { name: 'b', ids: ['S4'] }], r = R(1, X(['a', 'pass'], ['b', 'fail']))
    expect(v(r, { ...fail, declared: d, only: 'S4' })).toBe('ok'); expect(v(r, { ...fail, declared: d })).toMatch(/^bad: test "a" passed/)
    expect(v(R(1, X(['a', 'fail'], ['b', 'fail'])), { ...fail, declared: d, held: ['S1'] })).toMatch(/S1 already holds/)
  })
  test('names match the classname.name form or the bare name, exactly', () => {
    const rs = X(['pkg.S1 ok', 'pass']); expect(find(rs, 'S1 ok')?.name).toBe('pkg.S1 ok'); expect(find(rs, 'pkg.S1 ok')).toBeDefined(); expect(find(rs, '1 ok')).toBeUndefined()
  })
})

// ---- the runner: a fake that answers bwrap probes and records the rest; files stand in for the host fs ----
function world(o: { files?: Record<string, string>; out?: { stdout?: string; stderr?: string; exitCode?: number }; write?: (path: string) => string } = {}) {
  const files: Record<string, string> = { ...o.files }, calls: string[][] = [], h = fakeHost({ files }) as Host & { logs: string[] }; let n = 0
  Object.assign(h, {
    rand: () => `r${++n}`, cwd: async () => '/repo',
    run: async (argv: string[], init?: { env?: Record<string, string> }) => {
      calls.push(argv)
      if (argv[0] === 'stat') return files[argv[3]] === undefined ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 0, stdout: `regular file ${files[argv[3]].length}\n`, stderr: '' }
      if (argv[0] === 'bwrap' && !argv.includes('--')) return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src' : '', stderr: '' }
      const jailed = argv[0] === 'bwrap', jx = jailed ? argv[argv.indexOf('CADRE_JUNIT') + 1] : init?.env?.CADRE_JUNIT, sc = argv[argv.findIndex((a, k) => a === '--bind' && argv[k + 2] === '/tmp') + 1]   // what the runner would write, and where core finds it
      if (o.write && jx) files[jailed ? `${sc}/cadre/junit-test.xml` : jx] = o.write(jx)
      return { exitCode: o.out?.exitCode ?? 0, stdout: o.out?.stdout ?? '', stderr: o.out?.stderr ?? '' }
    },
  })
  const d = { cfg: { jail: 'on', jailWritable: [] }, wtRoot: '/wt', key: 'k', root: '/repo', actor: 'a', session: 's', store: { record: async () => 'd-1' } } as any
  return { h, d, files, calls }
}
const pkg = { root: '.', checks: { test: ['run', '$CADRE_JUNIT'], setup: ['make', 'deps'] } } as any
const XML = '<testsuite><testcase classname="c" name="a"><failure message="m"/></testcase></testsuite>'

describe('jail selection and the path of $CADRE_JUNIT', () => {
  test('the setup slot runs the writable jail (network on), test runs the offline overlay; the wrapper is the one argv a fake runner sees', async () => {
    const w = world(); const base = { task: { id: 't' }, wt: '/wt/t', pkg, ...fail }
    await runGate(w.h, w.d, { ...base, slot: 'setup', argv: pkg.checks.setup }); await runGate(w.h, w.d, { ...base, slot: 'test', argv: pkg.checks.test })
    const jailed = w.calls.filter(c => c[0] === 'bwrap' && c.includes('--')), [setup, test] = jailed
    expect(setup).not.toContain('--unshare-net'); expect(setup).toContain('--bind'); expect(test).toContain('--unshare-net'); expect(test).toContain('--overlay-src')
    expect(setup.slice(setup.indexOf('--') + 1)).toEqual(['make', 'deps'])
  })
  test('F3: a slot a layer declares (network, failExit, timeoutS) is read from the active profile, not the built-in default', async () => {
    const before = active()
    try {
      setProfile({ ...DEFAULT, checks: { ...DEFAULT.checks, fetch: { network: true, timeoutS: 7 }, test: { ...DEFAULT.checks.test, network: true } } } as any)
      const w = world(); const base = { task: { id: 't' }, wt: '/wt/t', pkg: { ...pkg, checks: { ...pkg.checks, fetch: ['get'] } }, ...fail }
      await runGate(w.h, w.d, { ...base, slot: 'fetch', argv: ['get'] }); await runGate(w.h, w.d, { ...base, slot: 'test', argv: pkg.checks.test })
      const jailed = w.calls.filter(c => c[0] === 'bwrap' && c.includes('--'))
      expect(jailed).toHaveLength(2); for (const j of jailed) { expect(j).not.toContain('--unshare-net'); expect(j).not.toContain('--overlay-src') }   // the writable, network-on jail
    } finally { setProfile(before) }
  })
  test('the network key is read from the profile, never from the unit: a unit that says network:true still gets the offline jail', async () => {
    const w = world(); await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg: { ...pkg, network: true, checks: { ...pkg.checks, test: ['run'], network: true } }, slot: 'test', argv: ['run'], ...fail })
    expect(w.calls.find(c => c[0] === 'bwrap' && c.includes('--'))).toContain('--unshare-net')
  })
  test('in a jail the runner gets /tmp/cadre/junit-test.xml (env and argv); core reads <scratch>/cadre/junit-test.xml; the file is read back as per-test results', async () => {
    const w = world({ write: () => XML, out: { exitCode: 1 } }), x = await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg, slot: 'test', argv: ['run', '--out=$CADRE_JUNIT', '${CADRE_JUNIT}'], ...fail, declared: [{ name: 'a', ids: [] }] })
    const j = w.calls.find(c => c[0] === 'bwrap' && c.includes('--'))!
    expect(j.slice(j.indexOf('--') + 1)).toEqual(['run', '--out=/tmp/cadre/junit-test.xml', '/tmp/cadre/junit-test.xml']); expect(j[j.indexOf('CADRE_JUNIT') + 1]).toBe('/tmp/cadre/junit-test.xml')
    expect(x.r.results).toEqual([{ name: 'c.a', status: 'fail', text: 'm' }]); expect(x.v.v).toBe('ok')
  })
  test('with no jail (mode none) the host path is passed directly', async () => {
    const w = world({ write: p => (p.startsWith('/wt/k.scratch/t-test-r1/cadre/') ? XML : '') }); w.d.cfg.jail = 'off'
    const x = await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg, slot: 'test', argv: ['run', '$CADRE_JUNIT'], ...fail })
    const c = w.calls.find(a => a[0] === 'run')!; expect(c[1]).toBe('/wt/k.scratch/t-test-r1/cadre/junit-test.xml'); expect(x.r.results?.[0].name).toBe('c.a')
  })
  test('two runs of one gate get two different $CADRE_JUNIT paths; a stale file of run 1 is never read in run 2', async () => {
    const w = world({ write: p => (p.includes('-r1/') ? XML : '') }); w.d.cfg.jail = 'off'
    const a = await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg, slot: 'test', argv: ['run', '$CADRE_JUNIT'], ...fail }); w.calls.length = 0
    w.files['/wt/k.scratch/t-test-r1/cadre/junit-test.xml'] = XML   // run 1's file is still lying there
    const b = await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg, slot: 'test', argv: ['run', '$CADRE_JUNIT'], ...fail })
    expect(a.r.results).toHaveLength(1); expect(w.calls.find(c => c[0] === 'run')![1]).toBe('/wt/k.scratch/t-test-r2/cadre/junit-test.xml'); expect(b.r.results).toBeUndefined()
  })
  test('stdout decides nothing: a runner printing FAIL FAIL not ok with exit 0 under expect pass is ok', async () => {
    const w = world({ out: { stdout: 'FAIL FAIL not ok 1 - x', stderr: 'failed' } }), x = await runGate(w.h, w.d, { task: { id: 't' }, wt: '/wt/t', pkg, slot: 'test', argv: ['run'], ...pass })
    expect(x.v.v).toBe('ok'); expect(x.r.results).toBeUndefined()
  })
  test('the slot timeout is data: a thrown run is timedOut', async () => {
    const w = world(); w.h.run = async a => { if (a[0] === 'mkdir') return { exitCode: 0, stdout: '', stderr: '' }; throw new Error('timeout') }
    expect((await runSlot(w.h, { mode: 'none', wt: '/wt', scratch: '/s', pkgRoot: '/wt', argv: ['x'], slot: 'test' })).timedOut).toBe(true)
  })
})

describe('adoption (D16, B19) and the one repo-config writer', () => {
  const CFG = '/repo/.cadre/config.json', mkw = () => { const w = world({ files: { [CFG]: JSON.stringify({ branches: { main: 'main' }, units: [{ root: '.', checks: { lint: ['x'] } }] }) } }); return w }
  const RUN = { command: ['node', '--test', '--test-reporter-destination=$CADRE_JUNIT', 'test/a.test.mjs'] }
  test('the tester run, minus its own file, is written once with the literal $CADRE_JUNIT through writeRepoConfig; a decision is recorded and the probe is yes; no tdd.report', async () => {
    const w = mkw(), recs: string[] = []; w.d.store.record = async (...a: string[]) => { recs.push(a[1]); return 'd' }; w.d.cfg.units = [{ root: '.', checks: { lint: ['x'] } }]
    const text = await adopt(w.h, w.d, w.d.cfg.units[0], RUN, ['test/a.test.mjs'], 'm-1'), u = JSON.parse(w.files[CFG]).units[0]
    expect(text).toBe('test check set from the tester: node --test --test-reporter-destination=$CADRE_JUNIT'); expect(u.checks.test).toEqual(['node', '--test', '--test-reporter-destination=$CADRE_JUNIT']); expect(u.tdd).toBeUndefined(); expect(u.testBy).toBe('tester')
    expect(recs).toEqual([text]); expect(await probeOf(w.h, u)).toBe('yes'); expect(w.files[`${CFG}.bak`]).toContain('"lint"')
  })
  test('probe states: none without a test check, unprobed without a store entry, no for a stale argv', async () => {
    const w = world(); expect(await probeOf(w.h, { root: '.', checks: { lint: ['x'] } })).toBe('none'); expect(await probeOf(w.h, { root: '.', checks: { test: ['t'] } })).toBe('unprobed')
    await w.h.store.set(`cadre:${repoKeyOf('/repo')}:junit:.`, { ok: true, argv: ['t'] })
    expect(await probeOf(w.h, { root: '.', checks: { test: ['t'] } })).toBe('yes'); expect(await probeOf(w.h, { root: '.', checks: { test: ['t', '-x'] } })).toBe('no')
  })
  test('two writers lose no update: both mutations land, each seeing the other\'s file', async () => {
    const w = mkw(); await Promise.all([writeRepoConfig(w.h, c => ({ ...c, a: 1 })), writeRepoConfig(w.h, c => ({ ...c, b: 2 }))])
    expect(JSON.parse(w.files[CFG])).toMatchObject({ a: 1, b: 2 })
  })
  test('a crash between acquire and release: the next writer steals the lapsed lock; a live lock of another session is waited for', async () => {
    const w = mkw(), store = await (w.h as any).taskStore(), now = await w.h.now()
    await store.setControl({ cfgLock: { session: 'dead', until: now + CFG_LOCK_MS } })   // held by a session that crashed
    const waits = w.h.run; let n = 0; w.h.run = async (a: string[]) => { if (a[0] === 'sleep') { w.h.clock.advance(CFG_LOCK_MS); n++; return { exitCode: 0, stdout: '', stderr: '' } } return waits(a) }
    const r = await writeRepoConfig(w.h, c => ({ ...c, stolen: true })); expect(r.ok).toBe(true); expect(n).toBeGreaterThan(0); expect(JSON.parse(w.files[CFG]).stolen).toBe(true)
    expect((await store.control()).doc.cfgLock ?? null).toBeNull()   // released
  })
  test('F7: the lock stolen between its read and the write: the write is refused, the file is untouched and the thief keeps its lock (a one-read window remains)', async () => {
    const w = mkw(), store = await (w.h as any).taskStore(), before = w.files[CFG], real = store.control.bind(store); let calls = 0
    store.control = async () => { if (++calls === 2) await store.setControl({ cfgLock: { session: 'thief', until: (await w.h.now()) + CFG_LOCK_MS } }); return real() }   // call 1 = the acquire read, call 2 = the re-check before the write
    const r = await writeRepoConfig(w.h, c => ({ ...c, lost: true }))
    expect(r).toEqual({ ok: false, why: '.cadre/config.json is being written by another session; try again' }); expect(w.files[CFG]).toBe(before)
    expect(((await real()).doc.cfgLock as { session: string }).session).toBe('thief')
  })
  test('a refusal string from the mutation writes nothing and releases the lock; a file that is not JSON is refused', async () => {
    const w = mkw(), before = w.files[CFG]; expect(await writeRepoConfig(w.h, () => 'no')).toEqual({ ok: false, why: 'no' }); expect(w.files[CFG]).toBe(before)
    w.files[CFG] = '{nope'; expect(await writeRepoConfig(w.h, c => c)).toMatchObject({ ok: false, why: '.cadre/config.json is not valid JSON' })
  })
})
