import { expect, test } from 'claude-code/testing'
import { BUDGET } from './fixtures/budget.generated'
import { TOOLS } from '../tools/index'

// Numbers come from `node scripts/budget.mjs` (the kit has no fs); regenerate before committing. P9: raising a cap needs an ADR.
test('core LOC <= 7,400 (core cap 7400; non-test, excluding ui/ and the test-only memory store)', async () => { expect(BUDGET.coreLoc).toBeLessThanOrEqual(7400) })
test('ui/ LOC <= 1,100, counted separately', async () => { expect(BUDGET.uiLoc).toBeLessThanOrEqual(1100) })
test('memory store <= 150 LOC (test-only)', async () => { expect(BUDGET.memoryStoreLoc).toBeLessThanOrEqual(150) })
test('MCP tools = 3, skills = 0', async () => { expect([...TOOLS]).toEqual(['report', 'inspect', 'run_check']); expect(BUDGET.skills).toBe(0) })
test('every gating registration has a .catch (validate --json gatingHooks)', async () => { expect(BUDGET.gatingMissing).toBe(0) })
test('UI v2 files (first line `// UI v2`) hold no literal glyph, theme key or colour: they come from ui/tokens', async () => { expect(BUDGET.uiLiterals).toEqual([]) })
test('A4: every built-in role prompt <= 1472 B (the audited largest, rounded up to 64 B; the cap only goes down)', async () => { for (const [r, n] of Object.entries(BUDGET.promptBytes)) expect([r, n <= 1472]).toEqual([r, true]) })
test('A4: agents/*.md + guides/* <= 17401 B (the audited total; the cap only goes down)', async () => { expect(BUDGET.shippedBytes).toBeLessThanOrEqual(17401) })
test('the specifier prompt <= 1536 B (0.17 plan, slice 7)', async () => { expect(BUDGET.promptBytes.specifier).toBeLessThanOrEqual(1536) })
