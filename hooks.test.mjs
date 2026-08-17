import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOKS = new URL('./hooks/', import.meta.url).pathname;

/** Run a hook exactly as Claude Code does: JSON on stdin, JSON on stdout. */
function runHook(script, event) {
  return JSON.parse(execFileSync('node', [join(HOOKS, script)], {
    input: JSON.stringify(event),
    encoding: 'utf8',
  }));
}

const WT = '/tmp/repo/.claude/worktrees/agent-xyz';

describe('write-gate hook', () => {
  it('denies an absolute write escaping the worktree', () => {
    const r = runHook('write-gate.mjs', { cwd: WT, tool_input: { file_path: '/tmp/repo/leak.txt', content: 'x' } });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /outside|relative/i);
  });

  it('allows a relative write inside the worktree', () => {
    const r = runHook('write-gate.mjs', { cwd: WT, tool_input: { file_path: 'src/a.ts', content: 'x' } });
    assert.equal(r.continue, true);
    assert.equal(r.hookSpecificOutput, undefined);
  });

  it('allows an absolute write inside the worktree', () => {
    const r = runHook('write-gate.mjs', { cwd: WT, tool_input: { file_path: `${WT}/src/a.ts`, content: 'x' } });
    assert.equal(r.continue, true);
  });

  it('is inert outside a worktree', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_input: { file_path: '/tmp/repo/anything.txt', content: 'x' } });
    assert.equal(r.continue, true);
  });

  it('denies a cadre plan.md with no Discovery section', () => {
    const r = runHook('write-gate.mjs', {
      cwd: '/tmp/repo',
      tool_input: { file_path: '/tmp/repo/.cadre/tasks/01_x/plan.md', content: '# Plan\n\n## Steps\n\n1. go\n' },
    });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /Discovery/);
  });

  it('allows a cadre plan.md with a substantive Discovery section', () => {
    const r = runHook('write-gate.mjs', {
      cwd: '/tmp/repo',
      tool_input: {
        file_path: '/tmp/repo/.cadre/tasks/01_x/plan.md',
        content: `# Plan\n\n## Discovery\n\n${'d'.repeat(150)}\n\n## Steps\n\n1. go\n`,
      },
    });
    assert.equal(r.continue, true);
  });

  it('never injects context — it denies or stays silent', () => {
    for (const ev of [
      { cwd: WT, tool_input: { file_path: '/tmp/repo/leak.txt', content: 'x' } },
      { cwd: WT, tool_input: { file_path: 'ok.ts', content: 'x' } },
    ]) {
      assert.doesNotMatch(JSON.stringify(runHook('write-gate.mjs', ev)), /additionalContext/);
    }
  });

  it('fails open on malformed input rather than blocking real work', () => {
    const out = execFileSync('node', [join(HOOKS, 'write-gate.mjs')], { input: 'not json', encoding: 'utf8' });
    assert.equal(JSON.parse(out).continue, true);
  });
});

describe('session-start hook', () => {
  it('injects nothing when idle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-ss-'));
    try {
      const r = runHook('session-start.mjs', { cwd: dir });
      assert.deepEqual(r, { continue: true, suppressOutput: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a pointer, not the state itself, when a task is active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-ss-'));
    try {
      const t = join(dir, '.cadre', 'tasks', '01_x');
      mkdirSync(t, { recursive: true });
      writeFileSync(join(dir, '.cadre', 'active-task'), '01_x');
      writeFileSync(join(t, 'status.json'), JSON.stringify({ state: 'blocked', question: 'which db?' }));
      writeFileSync(join(t, 'spec.md'), '# spec');

      const ctx = runHook('session-start.mjs', { cwd: dir }).hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes('01_x'));
      assert.ok(ctx.includes('blocked'));
      // The question itself stays on disk — injecting it would put it in
      // transcript history, paid on every later turn.
      assert.ok(!ctx.includes('which db?'));
      assert.ok(ctx.length < 200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('depth cap via hook', () => {
  it('denies Agent dispatch from inside a worktree', () => {
    const r = runHook('write-gate.mjs', { cwd: WT, tool_name: 'Agent', tool_input: { prompt: 'go' } });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /depth|report/i);
  });

  it('allows Agent dispatch from the lead', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_name: 'Agent', tool_input: { prompt: 'go' } });
    assert.equal(r.continue, true);
  });

  it('still denies by blocking, never by injecting advice', () => {
    const r = runHook('write-gate.mjs', { cwd: WT, tool_name: 'Agent', tool_input: { prompt: 'go' } });
    assert.doesNotMatch(JSON.stringify(r), /additionalContext/);
  });
});

describe('merge gate via hook', () => {
  it('denies a push from the lead', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /push/i);
  });

  it('allows an ordinary command', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    assert.equal(r.continue, true);
  });

  it('denies a dependency change', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('denies by blocking, never by injecting', () => {
    const r = runHook('write-gate.mjs', { cwd: '/tmp/repo', tool_name: 'Bash', tool_input: { command: 'git push' } });
    assert.doesNotMatch(JSON.stringify(r), /additionalContext/);
  });
});

describe('stop drift guard', () => {
  const withTask = (state, withResult) => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-stop-'));
    const t = join(dir, '.cadre', 'tasks', '01_x');
    mkdirSync(t, { recursive: true });
    writeFileSync(join(dir, '.cadre', 'active-task'), '01_x');
    writeFileSync(join(t, 'status.json'), JSON.stringify({ state }));
    if (withResult) writeFileSync(join(t, 'result.md'), 'done');
    return dir;
  };

  it('blocks stopping while a task is in progress with no result', () => {
    const dir = withTask('in_progress', false);
    try {
      const r = runHook('stop-guard.mjs', { cwd: dir });
      assert.equal(r.decision, 'block');
      assert.match(r.reason, /01_x/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('allows stopping once a result exists', () => {
    const dir = withTask('in_progress', true);
    try {
      assert.equal(runHook('stop-guard.mjs', { cwd: dir }).continue, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('allows stopping when the task is blocked — that is a legitimate pause', () => {
    const dir = withTask('blocked', false);
    try {
      assert.equal(runHook('stop-guard.mjs', { cwd: dir }).continue, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('honours stop_hook_active so a blocking guard cannot trap the session', () => {
    const dir = withTask('in_progress', false);
    try {
      assert.equal(runHook('stop-guard.mjs', { cwd: dir, stop_hook_active: true }).continue, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('injects nothing in any case', () => {
    for (const [state, res] of [['in_progress', false], ['completed', true]]) {
      const dir = withTask(state, res);
      try {
        assert.doesNotMatch(JSON.stringify(runHook('stop-guard.mjs', { cwd: dir })), /additionalContext/);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

describe('hook hardening — review findings', () => {
  it('detects a worktree from a Windows-style path', () => {
    const r = runHook('write-gate.mjs', {
      cwd: 'C:\\Users\\x\\.claude\\worktrees\\agent-w',
      tool_input: { file_path: 'C:\\Users\\x\\leak.txt', content: 'x' },
    });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('only treats .claude/worktrees as a worktree, not any dir named worktrees', () => {
    // A project legitimately checked out under a path containing "worktrees"
    // must not have every delegation denied.
    const r = runHook('write-gate.mjs', {
      cwd: '/src/worktrees/myproject',
      tool_name: 'Agent',
      tool_input: { prompt: 'go' },
    });
    assert.equal(r.continue, true);
  });

  // The gate coerces every field it reads, so malformed payloads no longer
  // throw — they are handled. The catch-all remains as a backstop for an
  // unforeseen throw (it denies), but it is not reachable from input shape
  // alone, so this asserts what IS true: never crash, always emit valid JSON,
  // never allow a call it could not evaluate.
  it('handles malformed payloads without crashing or emitting garbage', () => {
    const payloads = [
      { cwd: WT, tool_name: 'Bash', tool_input: { command: { not: 'a string' } } },
      { cwd: WT, tool_name: 'Write', tool_input: { file_path: 12345 } },
      { cwd: 42, tool_name: 'Bash', tool_input: null },
      { tool_name: 'Agent' },
      {},
    ];
    for (const p of payloads) {
      const out = execFileSync('node', [join(HOOKS, 'write-gate.mjs')], {
        input: JSON.stringify(p), encoding: 'utf8',
      });
      const r = JSON.parse(out); // throws if the hook emitted anything but JSON
      const decided = r.continue === true || r.hookSpecificOutput?.permissionDecision === 'deny';
      assert.ok(decided, `no valid decision for ${JSON.stringify(p)}`);
    }
  });
});

describe('prompt-mode hook — /automatron', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'cadre-pm-'));

  it('stays silent on an ordinary prompt', () => {
    const dir = fresh();
    try {
      assert.deepEqual(runHook('prompt-mode.mjs', { cwd: dir, prompt: 'fix the parser' }),
        { continue: true, suppressOutput: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('switches to automatron and says so once', () => {
    const dir = fresh();
    try {
      const r = runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron ship it' });
      assert.match(r.hookSpecificOutput.additionalContext, /automatron/i);
      assert.equal(JSON.parse(readFileSync(join(dir, '.cadre', 'config.json'), 'utf8')).mode, 'automatron');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never claims the reviewer is skipped', () => {
    const dir = fresh();
    try {
      const ctx = runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron' }).hookSpecificOutput.additionalContext;
      assert.match(ctx, /reviewer/i);
      assert.ok(!/skip.*review/i.test(ctx));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('switches back to adaptive', () => {
    const dir = fresh();
    try {
      runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron' });
      runHook('prompt-mode.mjs', { cwd: dir, prompt: 'adaptive please' });
      assert.equal(JSON.parse(readFileSync(join(dir, '.cadre', 'config.json'), 'utf8')).mode, 'adaptive');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stays quiet when the mode is already what was asked for', () => {
    const dir = fresh();
    try {
      runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron' });
      assert.deepEqual(runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron again' }),
        { continue: true, suppressOutput: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps its one-time context small', () => {
    const dir = fresh();
    try {
      const ctx = runHook('prompt-mode.mjs', { cwd: dir, prompt: '/automatron' }).hookSpecificOutput.additionalContext;
      assert.ok(ctx.length <= 200, `${ctx.length} > 200 bytes`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('stop guard — bounded blocking', () => {
  it('gives up after repeated blocks even without stop_hook_active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-sb-'));
    try {
      const t = join(dir, '.cadre', 'tasks', '01_x');
      mkdirSync(t, { recursive: true });
      writeFileSync(join(dir, '.cadre', 'active-task'), '01_x');
      writeFileSync(join(t, 'status.json'), JSON.stringify({ state: 'in_progress' }));

      let blocks = 0;
      for (let i = 0; i < 8; i++) {
        if (runHook('stop-guard.mjs', { cwd: dir }).decision === 'block') blocks++;
      }
      assert.ok(blocks >= 1, 'should block at least once');
      assert.ok(blocks < 8, `blocked every time (${blocks}/8) — unbounded loop risk`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('blast radius excludes cadre’s own state', () => {
  /** A real git repo, since countChangedFiles shells out to git status. */
  function repo(files) {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-radius-'));
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'base'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' },
    });
    mkdirSync(join(dir, '.cadre'), { recursive: true });
    writeFileSync(join(dir, '.cadre', 'config.json'), '{"mode":"adaptive","threshold":3}');
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), 'x');
    }
    return dir;
  }

  // Observed in a benchmark run: .cadre/ and .claude/ counted toward the
  // threshold, so a legitimate 3-file change read as 4 and cadre gated on its
  // own bookkeeping.
  it('does not count .cadre/ or .claude/ toward the file threshold', () => {
    const dir = repo(['a.txt', 'b.txt', 'c.txt', '.claude/junk.txt']);
    const r = runHook('write-gate.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'node test.mjs' } });
    assert.equal(r.continue, true, 'three source files at threshold 3 must pass');
    rmSync(dir, { recursive: true, force: true });
  });

  it('still counts real files past the threshold', () => {
    const dir = repo(['a.txt', 'b.txt', 'c.txt', 'd.txt', '.claude/junk.txt']);
    const r = runHook('write-gate.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'node test.mjs' } });
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('config resolves from the project root, not the worktree', () => {
  // A 28-file migration finished, then stranded: the merge ran with cwd inside
  // the worktree, .cadre/config.json is not there, and the adaptive default
  // asked for an approval that automatron had already waived.
  it('honours automatron config when cwd is inside a worktree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-cfgroot-'));
    mkdirSync(join(dir, '.cadre'), { recursive: true });
    writeFileSync(join(dir, '.cadre', 'config.json'), '{"mode":"automatron","threshold":3}');
    const wt = join(dir, '.claude', 'worktrees', 'agent-1');
    mkdirSync(wt, { recursive: true });

    const r = runHook('write-gate.mjs', {
      cwd: wt, tool_name: 'Bash', tool_input: { command: 'git merge worktree-agent-1' },
    });
    assert.equal(r.continue, true, 'automatron must waive the merge gate from inside a worktree');
    rmSync(dir, { recursive: true, force: true });
  });

  it('still gates from inside a worktree when the project is adaptive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadre-cfgroot2-'));
    mkdirSync(join(dir, '.cadre'), { recursive: true });
    writeFileSync(join(dir, '.cadre', 'config.json'), '{"mode":"adaptive","threshold":3}');
    const wt = join(dir, '.claude', 'worktrees', 'agent-1');
    mkdirSync(wt, { recursive: true });

    const r = runHook('write-gate.mjs', {
      cwd: wt, tool_name: 'Bash', tool_input: { command: 'git push origin main' },
    });
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
    rmSync(dir, { recursive: true, force: true });
  });
});
