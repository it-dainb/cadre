import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, buildWorkerPrompt } from './spec.mjs';
import { DEFAULT_BUDGET } from './budget.mjs';

const input = {
  taskId: '02_add_auth',
  goal: 'Add token refresh',
  plan: '## Discovery\n\nfindings here\n\n## Steps\n\n1. edit interceptor',
  context: [{ name: 'auth.md', content: 'auth notes' }],
  priorTasks: [{ id: '01_setup', summary: 'scaffolded the module' }],
};

describe('spec.md — the single source for a worker', () => {
  it('folds plan, context and prior summaries into one artifact', () => {
    const s = buildSpec(input);
    for (const needle of ['findings here', 'auth notes', 'scaffolded the module', 'Add token refresh']) {
      assert.ok(s.includes(needle), `spec missing: ${needle}`);
    }
  });

  it('passes oversized input through the budgeter rather than growing without bound', () => {
    const huge = {
      ...input,
      priorTasks: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, summary: 'q'.repeat(5_000) })),
      context: Array.from({ length: 20 }, (_, i) => ({ name: `c${i}.md`, content: 'w'.repeat(30_000) })),
    };
    assert.ok(buildSpec(huge).length <= DEFAULT_BUDGET.maxTotalChars + 4_000);
  });

  it('surfaces truncation instead of hiding it', () => {
    const huge = { ...input, priorTasks: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, summary: 'q' })) };
    assert.match(buildSpec(huge), /omitted|truncated/i);
  });
});

describe('worker prompt — must not duplicate what spec.md already carries', () => {
  const spec = buildSpec(input);
  const prompt = buildWorkerPrompt({ taskId: input.taskId, specPath: '.cadre/tasks/02_add_auth/spec.md' });

  it('points at spec.md rather than inlining it', () => {
    assert.ok(prompt.includes('.cadre/tasks/02_add_auth/spec.md'));
    for (const leaked of ['findings here', 'auth notes', 'scaffolded the module']) {
      assert.ok(!prompt.includes(leaked), `prompt duplicated spec content: ${leaked}`);
    }
  });

  // The invariant is that the prompt does not SCALE with the spec — not that it
  // is shorter than every spec (for a trivial task the fixed instructions are
  // naturally longer than a two-line spec).
  it('is constant-size regardless of how large the spec grows', () => {
    const huge = buildSpec({
      ...input,
      context: Array.from({ length: 30 }, (_, i) => ({ name: `c${i}.md`, content: 'w'.repeat(10_000) })),
    });
    const promptForHuge = buildWorkerPrompt({ taskId: input.taskId, specPath: '.cadre/tasks/02_add_auth/spec.md' });
    assert.ok(huge.length > spec.length * 10);
    assert.equal(promptForHuge.length, prompt.length);
    assert.ok(prompt.length < 1_500);
  });

  it('instructs relative paths, since absolute writes escape the worktree', () => {
    assert.match(prompt, /relative/i);
  });

  it('tells the worker how to report blocked rather than asking the user directly', () => {
    assert.match(prompt, /blocked/i);
    assert.match(prompt, /status\.json/);
  });
});
