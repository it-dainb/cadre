import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, DEFAULT_CONFIG, cancelTask } from './config.mjs';
import { classifyCommand } from './merge.mjs';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cadre-cfg-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('config — chosen at setup, never hardcoded', () => {
  it('returns defaults when nothing has been configured', () => {
    assert.deepEqual(readConfig(root), DEFAULT_CONFIG);
  });

  it('round-trips a written config', async () => {
    await writeConfig(root, { mode: 'automatron', threshold: 7 });
    const got = readConfig(root);
    assert.equal(got.mode, 'automatron');
    assert.equal(got.threshold, 7);
  });

  it('rejects an unknown mode rather than silently defaulting', async () => {
    await assert.rejects(() => writeConfig(root, { mode: 'yolo' }), /mode/i);
  });

  it('rejects a non-numeric threshold', async () => {
    await assert.rejects(() => writeConfig(root, { threshold: 'lots' }), /threshold/i);
  });

  it('survives a corrupt config file by falling back to defaults', () => {
    mkdirSync(join(root, '.cadre'), { recursive: true });
    writeFileSync(join(root, '.cadre', 'config.json'), '{not json');
    assert.deepEqual(readConfig(root), DEFAULT_CONFIG);
  });

  it('ships adaptive as the default — autonomy is opt-in', () => {
    assert.equal(DEFAULT_CONFIG.mode, 'adaptive');
  });
});

describe('mode switch changes the gate, not the reviewer', () => {
  const push = { command: 'git push origin main' };

  it('adaptive gates a push', () => {
    const cfg = DEFAULT_CONFIG;
    const r = classifyCommand(push, { threshold: cfg.threshold, autonomous: cfg.mode === 'automatron' });
    assert.equal(r.gate, true);
  });

  it('automatron does not gate the same push', () => {
    const r = classifyCommand(push, { threshold: 3, autonomous: true });
    assert.equal(r.gate, false);
  });

  // Round 5-6: autonomy removes the human, never the review pass.
  it('neither mode reports the reviewer as skippable', () => {
    for (const autonomous of [false, true]) {
      assert.notEqual(classifyCommand(push, { autonomous }).skipReview, true);
    }
  });

  it('a configured threshold moves the gate in both modes', () => {
    assert.equal(classifyCommand({ command: 'ls', filesTouched: 5 }, { threshold: 10 }).gate, false);
    assert.equal(classifyCommand({ command: 'ls', filesTouched: 5 }, { threshold: 3 }).gate, true);
  });
});

describe('cancel — leaves nothing dangling', () => {
  const seed = state => {
    const t = join(root, '.cadre', 'tasks', '01_x');
    mkdirSync(t, { recursive: true });
    writeFileSync(join(root, '.cadre', 'active-task'), '01_x');
    writeFileSync(join(t, 'status.json'), JSON.stringify({ state }));
    return t;
  };

  it('clears the active-task pointer so the session reads idle', async () => {
    seed('in_progress');
    await cancelTask(root);
    assert.equal(existsSync(join(root, '.cadre', 'active-task')), false);
  });

  it('records a terminal state rather than deleting the record', async () => {
    const t = seed('in_progress');
    await cancelTask(root);
    assert.equal(JSON.parse(
      (await import('node:fs')).readFileSync(join(t, 'status.json'), 'utf8')).state, 'cancelled');
  });

  it('removes stale lock files instead of waiting out their TTL', async () => {
    const t = seed('in_progress');
    writeFileSync(join(t, 'status.json.lock'), 'held');
    await cancelTask(root);
    assert.deepEqual(readdirSync(t).filter(n => n.endsWith('.lock')), []);
  });

  it('reports the worktree to remove — git ops belong to the caller, not the module', async () => {
    seed('in_progress');
    const r = await cancelTask(root, { worktree: '/r/.claude/worktrees/agent-x' });
    assert.equal(r.worktreeToRemove, '/r/.claude/worktrees/agent-x');
  });

  it('is a no-op when nothing is active', async () => {
    const r = await cancelTask(root);
    assert.equal(r.cancelled, null);
  });
});
