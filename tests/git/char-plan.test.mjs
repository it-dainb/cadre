// Dev-only: characterization of cadre 1.0.1 (plan cadre-2.0 section 6), plan and landing cells: docs-task, plan-tools-full (main's plan tools), dev-moved and revert-epic (real git).
import '../dev/register.mjs'
import { test } from 'node:test'
const { transcript, check } = await import('../dev/char-driver.mjs')
for (const cell of ['docs-task', 'plan-tools-full', 'dev-moved', 'revert-epic']) test(`characterization ${cell}`, async () => check(cell, await transcript(cell)))
