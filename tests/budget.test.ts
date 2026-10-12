import { expect, test } from 'claude-code/testing'
import { BUDGET } from './fixtures/budget.generated'
import { TOOLS } from '../tools/index'

// Numbers come from `node scripts/budget.mjs` (the kit has no fs); regenerate before committing. P9: raising a cap needs an ADR.
test('core LOC <= 5,000 (non-test, excluding ui/ and the test-only memory store)', async () => { expect(BUDGET.coreLoc).toBeLessThanOrEqual(5000) })
test('ui/ LOC <= 1,500 while v1 and v2 coexist (drops to 900 when the v1 code is deleted), counted separately', async () => { expect(BUDGET.uiLoc).toBeLessThanOrEqual(1500) })
test('memory store <= 150 LOC (test-only)', async () => { expect(BUDGET.memoryStoreLoc).toBeLessThanOrEqual(150) })
test('MCP tools = 3, skills = 0', async () => { expect([...TOOLS]).toEqual(['report', 'inspect', 'run_check']); expect(BUDGET.skills).toBe(0) })
test('every gating registration has a .catch (validate --json gatingHooks)', async () => { expect(BUDGET.gatingMissing).toBe(0) })
test('UI v2 files (first line `// UI v2`) hold no literal glyph, theme key or colour: they come from ui/tokens', async () => { expect(BUDGET.uiLiterals).toEqual([]) })
