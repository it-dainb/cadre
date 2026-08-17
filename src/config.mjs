/**
 * `.cadre/config.json` — the two knobs the user chooses at `/cadre setup`.
 *
 * Round 5-6 locked these as user-chosen rather than hardcoded, so the values
 * live in config and the gate reads them. Until this shipped, P5's threshold
 * was a hardcoded default and that build was internal-only.
 */
import { readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic, readJson, activeTaskPath, taskDir, statusPath } from './state.mjs';

export const MODES = ['adaptive', 'automatron'];

/** Autonomy is opt-in: the default gates by blast radius. */
export const DEFAULT_CONFIG = { mode: 'adaptive', threshold: 3 };

const configPath = root => join(root, '.cadre', 'config.json');

/** Falls back to defaults on a missing or corrupt file — config must not brick a session. */
export function readConfig(root) {
  const raw = readJson(configPath(root));
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const mode = MODES.includes(raw.mode) ? raw.mode : DEFAULT_CONFIG.mode;
  const threshold = Number.isFinite(raw.threshold) ? raw.threshold : DEFAULT_CONFIG.threshold;
  return { mode, threshold };
}

/** Validates on the way in, so a typo surfaces at setup rather than at merge time. */
export async function writeConfig(root, patch) {
  const next = { ...readConfig(root), ...patch };
  if (!MODES.includes(next.mode)) {
    throw new Error(`unknown mode "${next.mode}" — expected one of: ${MODES.join(', ')}`);
  }
  if (!Number.isFinite(next.threshold) || next.threshold < 0) {
    throw new Error(`threshold must be a non-negative number, got "${next.threshold}"`);
  }
  await writeJsonAtomic(configPath(root), next);
  return next;
}

/**
 * Cancel the active task.
 *
 * Records a terminal state rather than deleting the record — the worktree may
 * still hold work worth recovering, and a deleted task is indistinguishable
 * from one that never ran. Removes lock files directly instead of waiting out
 * the stale-lock TTL, since a clean cancel shouldn't leave the next session
 * blocked for 30 seconds.
 *
 * Git operations are the caller's: this reports the worktree to remove rather
 * than shelling out, so the module stays pure and testable.
 */
export async function cancelTask(root, { worktree = null } = {}) {
  const pointer = activeTaskPath(join(root, '.cadre'));
  if (!existsSync(pointer)) return { cancelled: null, worktreeToRemove: worktree };

  const task = readFileSync(pointer, 'utf8').trim();
  if (task) {
    const dir = taskDir(join(root, '.cadre'), task);
    const status = readJson(statusPath(join(root, '.cadre'), task)) ?? {};
    await writeJsonAtomic(statusPath(join(root, '.cadre'), task), { ...status, state: 'cancelled' });

    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name.endsWith('.lock')) {
          try { unlinkSync(join(dir, name)); } catch { /* already gone */ }
        }
      }
    }
  }

  unlinkSync(pointer);
  return { cancelled: task || null, worktreeToRemove: worktree };
}
