#!/usr/bin/env node
/**
 * The skills' entry point into these modules.
 *
 * A skill body is prose, not code, and the plugin installs outside the project
 * tree — so `cancel` and `setup` could name `cancelTask()` and `writeConfig()`
 * all they liked and nothing could reach them. That was the shape of the bug:
 * three skills documenting functions with no caller and no callable path.
 *
 * Skills invoke this as `node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" <cmd>`, which
 * Claude Code substitutes inside skill content. Output is JSON on stdout so the
 * caller reads a value rather than parsing prose.
 *
 * Deliberately thin. Every decision stays in the modules; this only maps
 * argv onto them and prints the result.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, writeConfig, cancelTask } from './config.mjs';
import { readJson, activeTaskPath, statusPath } from './state.mjs';

const out = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** `--mode automatron --threshold 5` → `{ mode: 'automatron', threshold: 5 }` */
function flags(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) parsed[key] = argv[i + 1];
  }
  return parsed;
}

const [command, ...rest] = process.argv.slice(2);

// The project, not the plugin. Every path these modules touch is under the
// project's `.cadre/`, and the plugin directory is ephemeral across updates.
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

switch (command) {
  case 'setup': {
    const { mode, threshold } = flags(rest);
    const patch = {};
    if (mode !== undefined) patch.mode = mode;
    // Passed as a string on argv; writeConfig rejects anything non-finite, so a
    // typo surfaces here rather than at merge time.
    if (threshold !== undefined) patch.threshold = Number(threshold);
    try {
      out(await writeConfig(root, patch));
    } catch (err) {
      fail(err.message);
    }
    break;
  }

  case 'cancel': {
    // Git operations stay with the caller: this reports the worktree to remove
    // rather than shelling out, so config.mjs stays pure and testable.
    out(await cancelTask(root, { worktree: flags(rest).worktree ?? null }));
    break;
  }

  case 'status': {
    // What `hud` needs, in one call instead of three file reads.
    const cadre = join(root, '.cadre');
    const pointer = activeTaskPath(cadre);
    const task = existsSync(pointer) ? readFileSync(pointer, 'utf8').trim() : '';
    out({
      config: readConfig(root),
      task: task || null,
      status: task ? readJson(statusPath(cadre, task)) : null,
    });
    break;
  }

  default:
    fail(`usage: cli.mjs <setup|cancel|status> [--flag value ...]\nunknown command: ${command ?? '(none)'}`);
}
