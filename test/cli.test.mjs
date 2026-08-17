/**
 * cli.mjs is the only path a skill has into these modules, so it is tested by
 * running it — an in-process import would pass even if argv parsing, the exit
 * codes or the JSON envelope were broken, which is the whole of what it does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../src/cli.mjs', import.meta.url).pathname;

/** Returns { code, stdout }. Never throws — a non-zero exit is a result here. */
function run(cwd, ...args) {
  try {
    return { code: 0, stdout: execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '' };
  }
}

const project = () => mkdtempSync(join(tmpdir(), 'cadre-cli-'));

describe('cli setup', () => {
  it('writes the config the skill asks for', () => {
    const dir = project();
    const r = run(dir, 'setup', '--mode', 'automatron', '--threshold', '5');
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), { mode: 'automatron', threshold: 5 });
    assert.ok(existsSync(join(dir, '.cadre', 'config.json')));
  });

  it('exits non-zero on an unknown mode rather than defaulting', () => {
    const dir = project();
    assert.equal(run(dir, 'setup', '--mode', 'nope').code, 1);
    assert.equal(existsSync(join(dir, '.cadre', 'config.json')), false);
  });

  it('exits non-zero on a non-numeric threshold', () => {
    assert.equal(run(project(), 'setup', '--threshold', 'three').code, 1);
  });
});

describe('cli status', () => {
  it('reports defaults when idle', () => {
    const r = run(project(), 'status');
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), {
      config: { mode: 'adaptive', threshold: 3 },
      task: null,
      status: null,
    });
  });

  it('surfaces the blocking question, which is the useful part', () => {
    const dir = project();
    mkdirSync(join(dir, '.cadre', 'tasks', 't1'), { recursive: true });
    writeFileSync(join(dir, '.cadre', 'active-task'), 't1');
    writeFileSync(
      join(dir, '.cadre', 'tasks', 't1', 'status.json'),
      JSON.stringify({ state: 'blocked', question: 'which parser?' }),
    );
    const got = JSON.parse(run(dir, 'status').stdout);
    assert.equal(got.task, 't1');
    assert.equal(got.status.question, 'which parser?');
  });
});

describe('cli cancel', () => {
  it('records a terminal state and names the worktree for the caller to remove', () => {
    const dir = project();
    mkdirSync(join(dir, '.cadre', 'tasks', 't1'), { recursive: true });
    writeFileSync(join(dir, '.cadre', 'active-task'), 't1');
    writeFileSync(join(dir, '.cadre', 'tasks', 't1', 'status.json'), JSON.stringify({ state: 'in_progress' }));

    const r = run(dir, 'cancel', '--worktree', '/tmp/wt');
    assert.deepEqual(JSON.parse(r.stdout), { cancelled: 't1', worktreeToRemove: '/tmp/wt' });

    // The record is kept, not deleted: a deleted task looks identical to one
    // that never ran, and the worktree may still hold work worth recovering.
    const after = JSON.parse(run(dir, 'status').stdout);
    assert.equal(after.task, null);
    assert.equal(existsSync(join(dir, '.cadre', 'tasks', 't1', 'status.json')), true);
  });
});

describe('cli contract', () => {
  it('exits non-zero on an unknown command instead of doing nothing quietly', () => {
    assert.equal(run(project(), 'bogus').code, 1);
    assert.equal(run(project()).code, 1);
  });
});
