// The tester proposes the command that runs its tests; cadre verifies it (ADR 0023): the report schema and the brief. The JUnit reader and the verdict are in junit.test.ts and gate.test.ts.
import { describe, expect, test } from 'claude-code/testing'
import { SPECS } from '../tools/index'
import { runShape, reportRefusal } from '../core/validate'
const validateReport = (r: any): string | null => reportRefusal(r)?.msg ?? null
import { RUN_ASK, brief } from '../core/briefs'
import { roleSpec } from '../core/roles'

const rep = { schemaVersion: 1, role: 'tester', outcome: 'done', summary: 's', tests: [{ path: 'test/a.test.mjs', name: 'S1 ok', ids: ['S1'] }] }
describe('the tester report carries run', () => {
  test('schema: run is a declared property; the description names it', () => {
    expect((SPECS[0].inputSchema as any).properties.run).toEqual({ type: 'object' })
    expect(SPECS[0].description).toContain('run{command[],cwd?}')
  })
  test('a well-formed run passes; run stays optional', () => {
    expect(validateReport({ ...rep, run: { command: ['node', '--test', 'test/a.test.mjs'] } })).toBe(null)
    expect(validateReport({ ...rep, run: { command: ['pytest', '-q', 'tests/test_a.py'], cwd: 'api' } })).toBe(null)
    expect(validateReport(rep)).toBe(null)
  })
  test('refused: no argv, a cwd outside the folder; ids are a list of short strings; the old scenario field is gone', () => {
    expect(validateReport({ ...rep, run: { command: 'npm test' } })).toMatch(/^run\.command: expected the argument list/)
    expect(validateReport({ ...rep, run: { command: [] } })).toMatch(/^run\.command/)
    expect(runShape({ command: ['node', '--test'], cwd: '../x' })).toMatch(/^run\.cwd/)
    expect(runShape({ command: ['node', '--test'], cwd: '/etc' })).toMatch(/^run\.cwd/)
    expect(validateReport({ ...rep, tests: [{ path: 't', name: 'n', scenario: 'S1' }] })).toMatch(/^tests\[0\]\.scenario: unknown field/)
    expect(validateReport({ ...rep, tests: [{ path: 't', name: 'n', ids: 'S1' }] })).toMatch(/^tests\[0\]\.ids: expected an array/)
  })
})

describe('S8: core names no runner; the worked example is the tester role\'s own data', () => {
  test('the default profile\'s example reaches the brief and the refusal; a role without one gets neither', () => {
    const eg = roleSpec('tester')!.report.eg!.run
    expect(eg).toContain('$CADRE_JUNIT'); expect(runShape({ command: [] }, eg)).toContain(eg); expect(runShape({ command: ['x'], slot: 'setup' }, eg)).toContain(eg)
    expect(RUN_ASK(eg)).toContain(eg); expect(runShape({ command: [] }, eg)).not.toContain('pytest'); expect(runShape({ command: ['x'], slot: 'a' }, eg)).toBe(`run: only command and cwd (${eg}); the check that runs it is not yours to pick`); expect(RUN_ASK()).not.toContain('e.g.'); expect(RUN_ASK()).toContain('$CADRE_JUNIT'); expect(runShape({ command: [] })).toBe('run.command: expected the argument list that runs only your tests, no shell')
  })
})

describe('the tester brief asks for the command', () => {
  const b = { id: 'bd-a1', title: 'Add login', type: 'feature', scenarios: 'S1: x', testPaths: ['test/**'] }
  test('runAsk adds the section in task language; without it the brief is unchanged', () => {
    const on = brief('tester', { ...b, runAsk: true }), off = brief('tester', b)
    expect(on).toContain('## How your tests run'); expect(on).toContain(RUN_ASK(roleSpec('tester')?.report.eg?.run, roleSpec('tester')?.report.eg?.runHint)); expect(on).toContain('$CADRE_JUNIT')
    expect(off).not.toContain('How your tests run')
  })
})
