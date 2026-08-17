import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, DEFAULT_THRESHOLD, nextWorkerSpec } from '../src/merge.mjs';

describe('merge gate — blast radius', () => {
  it('lets an ordinary command through', () => {
    assert.equal(classifyCommand({ command: 'npm test' }).gate, false);
    assert.equal(classifyCommand({ command: 'git status' }).gate, false);
  });

  it('gates a merge to the default branch', () => {
    const r = classifyCommand({ command: 'git merge worktree-agent-x' });
    assert.equal(r.gate, true);
    assert.match(r.reason, /merge/i);
  });

  it('gates a push regardless of how few files changed', () => {
    const r = classifyCommand({ command: 'git push origin main', filesTouched: 1 });
    assert.equal(r.gate, true);
  });

  it('gates force-push and history rewrite', () => {
    for (const c of ['git push --force origin main', 'git rebase -i HEAD~5', 'git reset --hard origin/main']) {
      assert.equal(classifyCommand({ command: c }).gate, true, `should gate: ${c}`);
    }
  });

  it('gates mass deletion', () => {
    assert.equal(classifyCommand({ command: 'rm -rf src/' }).gate, true);
  });

  it('gates dependency changes', () => {
    for (const c of ['npm install left-pad', 'npm uninstall react', 'pnpm add vite']) {
      assert.equal(classifyCommand({ command: c }).gate, true, `should gate: ${c}`);
    }
  });

  it('gates a schema migration across the common tools', () => {
    for (const c of [
      'npx prisma migrate deploy',
      'rails db:migrate',
      'bundle exec rake db:migrate',
      'alembic upgrade head',
      'alembic downgrade -1',
      'npx knex migrate:latest',
      'npx sequelize db:migrate',
      'php artisan migrate',
      'python manage.py migrate',
      'flyway migrate',
      'dbmate up',
    ]) {
      assert.equal(classifyCommand({ command: c }).gate, true, `should gate: ${c}`);
    }
  });

  // Found in a benchmark run: cadre refused a source-code refactor because the
  // task involved a file called migrate.mjs. The bare word is not the signal —
  // a schema migration tool is. Blocking real work is a failure, not caution.
  it('does not gate on the word migrate in a filename or prose', () => {
    for (const c of [
      'node migrate.mjs',
      'node ./scripts/migrate.js',
      'cat src/migrate.mjs',
      'grep -r migrate src/',
      'node test.mjs  # checks the migration',
    ]) {
      assert.equal(classifyCommand({ command: c }).gate, false, `should not gate: ${c}`);
    }
  });

  // Round 9: >3 files estimated, OR any destructive op.
  it('gates on file count past the threshold even with a harmless command', () => {
    assert.equal(classifyCommand({ command: 'ls', filesTouched: DEFAULT_THRESHOLD + 1 }).gate, true);
    assert.equal(classifyCommand({ command: 'ls', filesTouched: DEFAULT_THRESHOLD }).gate, false);
  });

  it('honours a configured threshold, since P6 makes this user-chosen', () => {
    assert.equal(classifyCommand({ command: 'ls', filesTouched: 6 }, { threshold: 10 }).gate, false);
    assert.equal(classifyCommand({ command: 'ls', filesTouched: 11 }, { threshold: 10 }).gate, true);
  });

  it('skips the human gate in automatron mode but still names the reason', () => {
    const r = classifyCommand({ command: 'git push origin main' }, { autonomous: true });
    assert.equal(r.gate, false);
    assert.match(r.reason, /automatron|autonomous/i);
  });

  // Autonomy removes the human, never the reviewer (spec Round 5-6).
  it('never reports the review step as skippable, even autonomously', () => {
    const r = classifyCommand({ command: 'git push origin main' }, { autonomous: true });
    assert.notEqual(r.skipReview, true);
  });

  it('does not gate a merge inside a worktree — only the lead merges to the trunk', () => {
    const r = classifyCommand({ command: 'git merge foo', worktreeRoot: '/r/.claude/worktrees/a' });
    assert.equal(r.gate, false);
  });
});

describe('blocked-worker protocol', () => {
  const spec = '# Task 03\n\n## Goal\n\nAdd caching\n';

  it('builds a resume spec carrying the original plus the answer', () => {
    const next = nextWorkerSpec({ spec, question: 'which cache backend?', answer: 'redis' });
    assert.ok(next.includes('Add caching'));
    assert.ok(next.includes('which cache backend?'));
    assert.ok(next.includes('redis'));
  });

  it('marks the resume so the fresh worker knows it inherits a worktree', () => {
    const next = nextWorkerSpec({ spec, question: 'q', answer: 'a' });
    assert.match(next, /resum|continu/i);
  });

  it('refuses to resume without an answer — that would just re-block', () => {
    assert.throws(() => nextWorkerSpec({ spec, question: 'q', answer: '' }), /answer/i);
  });

  it('keeps the original spec first so the goal is not buried', () => {
    const next = nextWorkerSpec({ spec, question: 'q', answer: 'a' });
    assert.ok(next.indexOf('Add caching') < next.indexOf('q'));
  });
});

describe('merge gate — bypasses found in review', () => {
  const WT = '/r/.claude/worktrees/agent-a';

  // The merge-inside-worktree exemption was applied to the WHOLE decision
  // because DESTRUCTIVE.find() returns the first match (merge, index 0).
  it('gates a chained merge && push inside a worktree', () => {
    const r = classifyCommand({ command: 'git merge foo && git push origin main', worktreeRoot: WT });
    assert.equal(r.gate, true);
    assert.match(r.reason, /push/i);
  });

  it('gates push chained after any separator', () => {
    for (const c of ['git merge x; git push', 'git merge x || git push', 'git merge x && git push --force']) {
      assert.equal(classifyCommand({ command: c, worktreeRoot: WT }).gate, true, `should gate: ${c}`);
    }
  });

  it('still exempts a bare merge inside a worktree', () => {
    assert.equal(classifyCommand({ command: 'git merge foo', worktreeRoot: WT }).gate, false);
  });

  it('gates git -C <dir> push, which dodges the bare git-push pattern', () => {
    assert.equal(classifyCommand({ command: 'git -C /some/dir push origin main' }).gate, true);
  });

  it('gates push with global flags between git and the verb', () => {
    assert.equal(classifyCommand({ command: 'git --no-pager push' }).gate, true);
  });
});
