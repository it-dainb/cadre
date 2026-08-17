#!/usr/bin/env node
/**
 * Stop drift guard. Blocks; injects nothing.
 *
 * If a task is still in progress with no result recorded, stopping loses the
 * thread — the worktree holds changes nobody has read back. This blocks the
 * stop rather than injecting a reminder, because a reminder would be written
 * into transcript history and paid on every later turn.
 *
 * Budget: 0 injected bytes, always.
 */
import { recoverActive } from '../state.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

let evt = {};
try { evt = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* allow */ }

const silent = () => { process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true })); process.exit(0); };

// Claude Code sets this when a Stop hook already fired for this stop — without
// honouring it a blocking guard traps the session in a loop.
if (evt.stop_hook_active) silent();

const cwd = evt.cwd ?? process.cwd();
let active = null;
try { active = recoverActive(join(cwd, '.cadre')); } catch { /* idle */ }
if (!active || active.state !== 'in_progress') silent();

if (existsSync(join(cwd, '.cadre', 'tasks', active.task, 'result.md'))) silent();

// Bounded, so the guard cannot trap a session on its own.
//
// stop_hook_active is the host's loop-breaker, but relying on it alone means a
// version that omits the field — or a genuinely stuck model that cannot produce
// result.md — turns this into an unbounded block. Persist the count so it
// survives the fresh process each Stop spawns, and stand down past the limit:
// a guard that will not let go stops being a safeguard.
const MAX_BLOCKS = 3;
const counter = join(cwd, '.cadre', 'tasks', active.task, '.stop-blocks');
let blocks = 0;
try { blocks = Number(readFileSync(counter, 'utf8')) || 0; } catch { /* first time */ }

if (blocks >= MAX_BLOCKS) silent();

try { writeFileSync(counter, String(blocks + 1)); } catch { /* best effort */ }

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `Task ${active.task} is still in_progress with no result.md. Read it back, or mark it blocked/completed before stopping. (${blocks + 1}/${MAX_BLOCKS})`,
}));
