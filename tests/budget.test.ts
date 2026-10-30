import { expect, test } from 'claude-code/testing'
import { BUDGET } from './fixtures/budget.generated'
import { TOOLS } from '../tools/index'

// Numbers come from `node scripts/budget.mjs` (the kit has no fs); regenerate before committing. P9: raising a cap needs an ADR.
test('core LOC <= 7,250 (cap commit 2 of 2.0: S8 end 7109 + 141; non-test, excluding ui/, profiles/, modules/ and the test-only memory store)', async () => { expect(BUDGET.coreLoc).toBeLessThanOrEqual(7250) })
test('cap commit 1: modules/*.mjs <= 640 LOC and profiles/*.ts <= 350 LOC, each counted apart from core', async () => { expect(BUDGET.modulesLoc).toBeLessThanOrEqual(640); expect(BUDGET.profilesLoc).toBeLessThanOrEqual(350) })
test('ui/ LOC <= 1,300 (O3), counted separately', async () => { expect(BUDGET.uiLoc).toBeLessThanOrEqual(1300) })
test('memory store <= 150 LOC (test-only)', async () => { expect(BUDGET.memoryStoreLoc).toBeLessThanOrEqual(150) })
test('MCP tools = 3, skills = 0', async () => { expect([...TOOLS]).toEqual(['report', 'inspect', 'run_check']); expect(BUDGET.skills).toBe(0) })
test('every gating registration has a .catch (validate --json gatingHooks)', async () => { expect(BUDGET.gatingMissing).toBe(0) })
test('UI v2 files (first line `// UI v2`) hold no literal glyph, theme key or colour: they come from ui/tokens', async () => { expect(BUDGET.uiLiterals).toEqual([]) })
test('A4: every built-in role prompt <= 1536 B (cap commit 2 of 2.0: the planner is the largest at 1356 B; the cap only goes down)', async () => { for (const [r, n] of Object.entries(BUDGET.promptBytes)) expect([r, n <= 1536]).toEqual([r, true]) })
test('A4: agents/*.md + guides/* <= 16076 B (cap commit 2 of 2.0, lowered in the fix round: the measured size, the smallest that keeps every contract; the 15000 B target was not reached, ADR 0031; the cap only goes down)', async () => { expect(BUDGET.shippedBytes).toBeLessThanOrEqual(16076) })
test('the specifier prompt <= 1536 B (0.17 plan, slice 7)', async () => { expect(BUDGET.promptBytes.specifier).toBeLessThanOrEqual(1536) })
test('B5: the helper and need modules are gone from the module list', async () => {
  expect(Object.keys(BUDGET.modules).filter(m => /^core\/(helpers|needs)\.ts$/.test(m))).toEqual([])
  expect(Object.keys(BUDGET.modules).length).toBeGreaterThan(40)   // the list is the real one, not an empty scan
})
test('D14: the vendored xmldom matches the sha in VENDOR.json, its LICENSE ships, and only core/junit.ts imports it', async () => {
  expect(BUDGET.vendor.sha).toBe(BUDGET.vendor.pinned); expect(BUDGET.vendor.version).toBe('0.9.12'); expect(BUDGET.vendor.license).toBe(true); expect(BUDGET.vendor.importers).toEqual([])
  expect(Object.keys(BUDGET.modules).filter(m => m.startsWith('core/vendor/'))).toEqual([])   // outside the core cap
})
test('7(b): the NO_REGEX list holds the S2, S3 and S5 files (S5: pipeline, profile, machine) and is regex-free; no stdout/stderr read in gate code outside modelData(', async () => {
  expect(BUDGET.noRegex).toEqual(expect.arrayContaining(['core/gate.ts', 'core/junit.ts', 'core/tdd.ts', 'core/flags.ts', 'core/decide.ts', 'core/close.ts', 'core/pipeline.ts', 'core/profile.ts', 'core/machine.ts', 'core/hooks.ts', 'core/modrun.ts', 'core/integrate.ts', 'core/syncrun.ts', 'modules/sync.mjs', 'modules/changelog.mjs', 'modules/release.mjs', 'modules/landing-gh.mjs', 'profiles/default.ts', 'profiles/docs.ts', 'profiles/analysis.ts'])); expect(BUDGET.regexHits).toEqual([])
  expect(BUDGET.noStdio).toEqual(['core/gate.ts', 'core/tdd.ts']); expect(BUDGET.stdioReads).toEqual([])
})
test('S6: core imports nothing from modules/ (hooks, providers and the sync module run as processes); modules/ is outside the core cap and its own files are listed', async () => {
  expect(BUDGET.coreImportsModules).toEqual([]); expect(BUDGET.modulesLoc).toBeGreaterThan(0)
})
test('7(c): profiles/ is in the model-exit scan and counted apart from core (the fixture case is tests/git/budget-lint.test.mjs)', async () => {
  expect(BUDGET.profilesLoc).toBeGreaterThan(0); expect(BUDGET.profilesLoc).toBeLessThanOrEqual(350); expect(BUDGET.modelExits).toEqual([])
})
test('S6b: the adapter client and the sync engine left core (task-management/protocol.ts, task-management/sync-engine/); the sync module is in the module list; core imports no modules/', async () => {
  expect(Object.keys(BUDGET.modules).filter(m => m === 'task-management/protocol.ts' || m.startsWith('task-management/sync-engine/'))).toEqual([])
  expect(Object.keys(BUDGET.modules)).toContain('core/syncrun.ts'); expect(BUDGET.noRegex).toContain('modules/sync.mjs'); expect(BUDGET.coreImportsModules).toEqual([])
})
test('S7 exit check: core has no S<n> scenario-id regex; the NO_REGEX list gains the S7 files; exactly two engine-text exception lines, in drive.ts and queue.ts', async () => {
  expect(BUDGET.idRegex).toEqual([])
  expect(BUDGET.noRegex).toEqual(expect.arrayContaining(['core/drive.ts', 'core/queue.ts', 'core/git.ts', 'core/admission.ts', 'core/plantools.ts', 'core/planner.ts']))
  expect(BUDGET.engineExceptions).toHaveLength(2); expect(BUDGET.engineExceptions.map((l: string) => l.split(':')[0]).sort()).toEqual(['core/drive.ts', 'core/queue.ts']); expect(BUDGET.regexHits).toEqual([])
})
