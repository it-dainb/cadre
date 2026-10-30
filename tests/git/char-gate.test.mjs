// Dev-only: characterization of cadre 1.0.1 (plan cadre-2.0 section 6), gate cells on real git (tests/dev/tdd-world.mjs): holds-scenario, and the red and green legs of exit-every-role.
// Goldens: tests/fixtures/char/<cell>.golden.json (record once with CHAR_RECORD=1). A line may change only with a cited B row of the 2.0 plan.
import '../dev/register.mjs'
import { test } from 'node:test'
const { transcript, check } = await import('../dev/char-driver.mjs')
for (const cell of ['holds-scenario', 'holds-scenario-refused', 'exit-every-role-gate']) test(`characterization ${cell}`, async () => check(cell, await transcript(cell)))
