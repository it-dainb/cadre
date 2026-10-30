// The init-end JUnit probe (D15, B18) and the none/unprobed states (D16): init runs each unit's test check once (the gate path) and stores one fact per unit;
// Doctor and the gate read it and never probe. A scripted runner stands in for bwrap: it writes the report where the real runner would.
import { describe, expect, test } from 'claude-code/testing'
import { initItems, repoKeyOf, scoped, wire } from '../commands/init'
import { probeOf } from '../core/gate'
const skeleton = () => '# Changelog\n\n## [Unreleased]\n'   // a file the init check finds (the format is the changelog hook's to check)
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fakeHost } from './support'
import type { Host } from '../types'

const ROOT = '/repo', HOME = '/hm/u', CFG = `${ROOT}/.cadre/config.json`, GOOD = '<testsuite><testcase name="a"><failure message="m"/></testcase></testsuite>'
const unit = (checks: Record<string, string[]>) => ({ root: '.', checks, tdd: { paths: ['test/**'] } })
// `report`: what the test check writes at $CADRE_JUNIT (undefined = an exit-only runner); `red`: inner argvs that exit 1
function mk(units: unknown[], report?: string, red: string[] = []) {
  const files: Record<string, string> = { [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, units }), [`${ROOT}/.git/info/exclude`]: '.cadre/state/\n.claude/settings.local.json\n', [`${ROOT}/CHANGELOG.md`]: skeleton() }, calls: string[][] = []
  const h = fakeHost({ files }) as Host; void h.store.set('cadre:prefs', { at: 0 }); let n = 0
  Object.assign(h, {
    rand: () => `n${++n}`.padEnd(16, '0'), cwd: async () => ROOT, home: async () => HOME, settings: async () => ({}),
    run: async (argv: string[]) => {
      calls.push(argv); const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
      if (argv[0] === 'stat') return files[argv[3]] === undefined ? { exitCode: 1, stdout: '', stderr: '' } : ok(`regular file ${files[argv[3]].length}\n`)
      if (argv[0] === 'bwrap' && !argv.includes('--')) return ok(argv[1] === '--help' ? '--overlay-src' : '')
      if (argv[0] === 'bwrap') {
        const inner = argv.slice(argv.indexOf('--', 3) + 1), sc = argv[argv.findIndex((a, k) => a === '--bind' && argv[k + 2] === '/tmp') + 1]
        if (inner[0] === 'test-runner' && report !== undefined) files[`${sc}/cadre/junit-test.xml`] = report
        return { exitCode: red.includes(inner.join(' ')) ? 1 : 0, stdout: '', stderr: '' }
      }
      if (argv[0] === 'find') return ok('')
      if (argv[0] !== 'git') return ok()
      const j = argv.join(' '); if (j === 'git rev-parse --git-path info/exclude') return ok('.git/info/exclude')
      return ok(argv[1] === 'rev-parse' ? '.git' : '')
    },
  })
  const s = new MemoryStore(); wire.store = async () => s; void s.init({ journal: true } as any); void h.board.update(b => ({ ...b, mission: 'm' }))
  return { h, files, calls }
}
const TEST = ['test-runner', '--out=$CADRE_JUNIT'], key = (root = '.') => `cadre:${repoKeyOf(ROOT)}:junit:${root}`
const probes = (calls: string[][]) => calls.filter(c => c[0] === 'bwrap' && c.includes('--') && c.includes('test-runner'))

describe('the probe: one run of the test check per unit through the gate path, one stored fact', () => {
  test('a runner that writes valid JUnit to $CADRE_JUNIT: stored ok:true with the probed argv; init lists the unit and says nothing to fix', async () => {
    const { h, calls } = mk([unit({ test: TEST })], GOOD), its = await initItems(h)
    expect(await h.store.get(key())).toEqual({ ok: true, argv: TEST }); expect(probes(calls)).toHaveLength(1); expect(its.find(i => i.name.includes('writes JUnit'))).toMatchObject({ st: 'ok' }); expect(its.some(i => i.why?.includes('wrote no valid JUnit'))).toBe(false)
  })
  test('an exit-only runner stores false; its note for main appears once, naming the unit and the fix', async () => {
    const { h } = mk([unit({ test: TEST })]), its = await initItems(h), no = its.filter(i => i.why?.includes('wrote no valid JUnit'))
    expect(await h.store.get(key())).toEqual({ ok: false, argv: TEST }); expect(no).toHaveLength(1); expect(no[0]).toMatchObject({ st: 'warn' }); expect(no[0].why).toBe('unit .: the test check wrote no valid JUnit at $CADRE_JUNIT, so red is exit-code only; change its test argv to write JUnit (install a reporter if needed), then rerun /cadre init')
  })
  test('invalid XML and a DOCTYPE file store false', async () => {
    for (const bad of ['<testsuite', '<!DOCTYPE x><testsuite/>', '<html/>']) { const { h } = mk([unit({ test: TEST })], bad); await initItems(h); expect(await h.store.get(key())).toEqual({ ok: false, argv: TEST }) }
  })
  test('the probe ignores expect: a failing suite with valid JUnit is still a yes', async () => {
    const { h } = mk([unit({ test: TEST })], GOOD, [TEST.join(' ').replace('$CADRE_JUNIT', '/tmp/cadre/junit-test.xml')]); await initItems(h)
    expect(await h.store.get(key())).toEqual({ ok: true, argv: TEST })
  })
  test('a changed test argv after the probe reads stale = no; a unit with a test check and no stored entry is unprobed (machine-local fact)', async () => {
    const { h } = mk([unit({ test: TEST })], GOOD); await initItems(h)
    expect(await probeOf(h, { root: '.', checks: { test: TEST } })).toBe('yes'); expect(await probeOf(h, { root: '.', checks: { test: [...TEST, '--x'] } })).toBe('no')
    expect(await probeOf(h, { root: 'other', checks: { test: TEST } })).toBe('unprobed')
  })
  test('a unit with no test check is none: no probe run, init tells main there is no test check yet, nothing stored', async () => {
    const { h, calls } = mk([unit({ lint: ['linter'] })]), its = await initItems(h)
    expect(probes(calls)).toHaveLength(0); expect(await h.store.get(key())).toBeUndefined(); expect(await probeOf(h, { root: '.', checks: { lint: ['linter'] } })).toBe('none')
    expect(its.find(i => i.name === 'unit .: test check')).toMatchObject({ st: 'ok', why: 'no test check yet: the first test-driven task sets one up, or use a pipeline that has no tests' })
  })
  test('the scoped key is per repo, so another clone starts unprobed', async () => {
    const { h } = mk([unit({ test: TEST })], GOOD); await initItems(h); expect(await scoped(h, 'junit:.')).toBe(key())
  })
})
