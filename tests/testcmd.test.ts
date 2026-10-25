// The tester proposes the command that runs its tests; cadre verifies it (ADR 0023): the report schema, the brief, the collect-error line, Settings' source.
import { describe, expect, test } from 'claude-code/testing'
import { SPECS } from '../tools/index'
import { runShape, validateReport } from '../core/validate'
import { RUN_ASK, brief } from '../core/briefs'
import { collectLine, junit, missing } from '../core/tdd'
import { defaults, rows } from '../config/index'

const rep = { schemaVersion: 1, role: 'tester', outcome: 'done', summary: 's', tests: [{ path: 'test/a.test.mjs', name: 'S1 ok', scenario: 'S1' }] }
describe('the tester report carries run', () => {
  test('schema: run is a declared property; the description names it', () => {
    expect((SPECS[0].inputSchema as any).properties.run).toEqual({ type: 'object' })
    expect(SPECS[0].description).toContain('run{command[],junit?,cwd?}')
  })
  test('a well-formed run passes; run stays optional', () => {
    expect(validateReport({ ...rep, run: { command: ['node', '--test', 'test/a.test.mjs'], junit: '$CADRE_JUNIT' } })).toBe(null)
    expect(validateReport({ ...rep, run: { command: ['pytest', '-q', 'tests/test_a.py'], cwd: 'api' } })).toBe(null)
    expect(validateReport(rep)).toBe(null)
  })
  test('refused: no argv, a shell or a non-runner, a cwd outside the folder, a junit that is not text', () => {
    expect(validateReport({ ...rep, run: { command: 'npm test' } })).toMatch(/^run\.command: expected the argument list/)
    expect(validateReport({ ...rep, run: { command: [] } })).toMatch(/^run\.command/)
    expect(runShape({ command: ['bash', '-c', 'npm test'] })).toMatch(/"bash" is not a test runner/)
    expect(runShape({ command: ['/usr/bin/rm', '-rf', '.'] })).toMatch(/is not a test runner/)
    expect(runShape({ command: ['node', '--test'], cwd: '../x' })).toMatch(/^run\.cwd/)
    expect(runShape({ command: ['node', '--test'], cwd: '/etc' })).toMatch(/^run\.cwd/)
    expect(runShape({ command: ['node', '--test'], junit: true })).toMatch(/^run\.junit/)
  })
})

describe('the tester brief asks for the command', () => {
  const b = { id: 'bd-a1', title: 'Add login', type: 'feature', scenarios: 'S1: x', testPaths: ['test/**'] }
  test('runAsk adds the section in task language; without it the brief is unchanged', () => {
    const on = brief('tester', { ...b, runAsk: true }), off = brief('tester', b)
    expect(on).toContain('## How your tests run'); expect(on).toContain(RUN_ASK); expect(on).toContain('$CADRE_JUNIT')
    expect(off).not.toContain('How your tests run')
  })
})

describe('collect errors', () => {
  const pats = defaults().tdd.collectErrors
  test('pytest, node, jest and go setup failures are named by their line; an assertion failure is not', () => {
    expect(collectLine('==== ERRORS ====\nERROR collecting tests/test_a.py\nE   ModuleNotFoundError: No module named "app"', pats)).toBe('ERROR collecting tests/test_a.py')
    expect(collectLine("# Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'x.mjs'", pats)).toBe("Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'x.mjs'")
    expect(collectLine(' FAIL  src/a.test.ts\n  ● Test suite failed to run', pats)).toBe('● Test suite failed to run')
    expect(collectLine('FAIL\tex.com/a [build failed]', pats)).toBe('FAIL\tex.com/a [build failed]')
    expect(collectLine('not ok 1 - S1 ok\n  error: 2 == 3', pats)).toBe(null)
  })
  test('the setting is checked: a list of valid regular expressions', () => {
    const r = rows([{ name: '.cadre/config.json', trust: 'repo', value: { tdd: { collectErrors: ['('] } } }]).find(x => x.key === 'tdd.collectErrors')!
    expect(r.src).toBe('default')
  })
})

describe('missing runner or module', () => {
  test('exit 127, command not found and execvp name the runner; a module nobody installed names the module', () => {
    expect(missing(127, '', [], false)).toMatch(/missing runner, exit=127/)
    expect(missing(1, 'sh: 1: pytest: command not found', [], false)).toMatch(/missing runner.*pytest: command not found/)
    expect(missing(1, 'execvp(3) failed: No such file or directory', [], false)).toMatch(/missing runner/)
    expect(missing(1, 'E   ModuleNotFoundError: No module named "my_project_dep"', [], false)).toMatch(/missing module.*my_project_dep/)
    expect(missing(1, "Error: Cannot find module 'left-pad'", [], false)).toMatch(/missing module.*left-pad/)
  })
  test('not these: a relative import, an assertion failure, and an import of a new contract symbol', () => {
    expect(missing(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'nope.mjs'", [], false)).toBe(null)
    expect(missing(1, "Cannot find module '../src/a'", [], false)).toBe(null)
    expect(missing(1, 'not ok 1 - S1 ok', [], false)).toBe(null)
    expect(missing(1, 'No module named "my_project.signin"', [{ name: 'signin', kind: 'function', status: 'new' }], false)).toBe(null)
  })
})

describe('Settings: an adopted test check shows its source', () => {
  test('packages from the repo file with a test check the tester proposed read as source "tester"', () => {
    const by = (v: unknown) => rows([{ name: '.cadre/config.json', trust: 'repo', value: { units: v } }]).find(x => x.key === 'units')!.src
    expect(by([{ root: '.', checks: { test: ['node', '--test'] }, testBy: 'tester' }])).toBe('tester')
    expect(by([{ root: '.', checks: { test: ['node', '--test'] } }])).toBe('repo')
  })
})

describe('the JUnit reader decodes test names the way the reporters write them', () => {
  const one = (name: string) => junit(`<testsuite><testcase name="${name}" classname="" time="0"/></testsuite>`)[0].name
  test('a quote escaped twice by node (&amp;quot;) matches the name with the quote; a single &quot; and a plain &amp; still match', () => {
    expect(one('a &amp;quot;b&amp;quot;')).toBe('a "b"'); expect(one('a &quot;b&quot;')).toBe('a "b"'); expect(one('a &amp; b')).toBe('a & b'); expect(one('x &lt;y&gt;')).toBe('x <y>')
    expect(junit('<testcase name="S1: given &amp;quot;hello world&amp;quot;"><failure message="m"/></testcase>')[0].status).toBe('failure')
  })
})
