// Dev-only: characterization of cadre 1.0.1 (plan cadre-2.0 section 6), lifecycle cells on tests/fixtures/replay/world.ts: exit-every-role (worker, reviewer, landing), forced-exit, report-less-end, shape-refusal-budget.
import '../dev/register.mjs'
import { test } from 'node:test'
const { transcript, check } = await import('../dev/char-driver.mjs')
for (const cell of ['exit-every-role', 'forced-exit', 'report-less-end', 'shape-refusal-budget']) test(`characterization ${cell}`, async () => check(cell, await transcript(cell)))
