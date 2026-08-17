#!/usr/bin/env node
/**
 * UserPromptSubmit — the /automatron keyword.
 *
 * This is the ONLY ephemeral injection point: UserPromptSubmit context is not
 * written into transcript history, so it is paid once rather than on every
 * later turn. Every other event persists, which is why the rest of cadre's
 * hooks deny instead of speaking.
 *
 * Toggling writes to .cadre/config.json so the merge gate — a different hook,
 * in a different process — reads it. Config is the channel between them.
 */
import { readConfig, writeConfig } from '../config.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

const silent = () => { process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true })); process.exit(0); };

let evt = {};
try { evt = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { silent(); }

const prompt = typeof evt.prompt === 'string' ? evt.prompt : '';
const cwd = typeof evt.cwd === 'string' ? evt.cwd : process.cwd();

const wants = /(^|\s)\/?automatron\b/i.test(prompt);
const wantsOff = /(^|\s)\/?(adaptive|careful)\b/i.test(prompt);
if (!wants && !wantsOff) silent();

const mode = wants ? 'automatron' : 'adaptive';
try {
  if (readConfig(cwd).mode === mode) silent();
  await writeConfig(cwd, { mode });
} catch {
  silent(); // never block a prompt over a config write
}

// Short and one-time. Autonomy removes the human gate, never the reviewer, so
// say so once here rather than restating it in every agent body.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: mode === 'automatron'
      ? 'cadre: automatron on — merge gate will not ask for approval. Reviewer pass still runs.'
      : 'cadre: adaptive mode on — large or destructive work will stop for approval.',
  },
}));
