#!/usr/bin/env node
/**
 * SessionStart. Early-exits to empty when idle.
 *
 * Injected bytes budget:
 *   idle path    = 0 (no active task -> suppressOutput, nothing added)
 *   restore path = 0 by design — it surfaces a pointer the lead reads with a
 *                  tool call, rather than pushing a summary into transcript
 *                  history where it would be paid on every later turn.
 */
import { recoverActive } from '../state.mjs';
import { join } from 'node:path';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

let evt = {};
try { evt = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* idle */ }

const cwd = evt.cwd ?? process.cwd();
const silent = () => { process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true })); process.exit(0); };

let active = null;
try { active = recoverActive(join(cwd, '.cadre')); } catch { /* idle */ }
if (!active) silent();

// One line naming where the state is. Not the state itself.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `cadre: task ${active.task} is ${active.state}. State in .cadre/tasks/${active.task}/.`,
  },
}));
