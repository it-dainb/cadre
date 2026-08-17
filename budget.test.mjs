import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyBudget, DEFAULT_BUDGET } from './budget.mjs';

const task = (id, summary) => ({ id, summary });
const ctx = (name, content) => ({ name, content });

describe('budgeter — degrades, never throws', () => {
  it('passes small input through untouched with no events', () => {
    const out = applyBudget({ tasks: [task('01', 'short')], context: [ctx('a.md', 'small')] });
    assert.equal(out.tasks.length, 1);
    assert.equal(out.context[0].content, 'small');
    assert.deepEqual(out.events, []);
  });

  it('stage 1 — drops oldest tasks past maxTasks, keeping the newest', () => {
    const tasks = Array.from({ length: 14 }, (_, i) => task(String(i), 's'));
    const out = applyBudget({ tasks, context: [] });
    assert.equal(out.tasks.length, DEFAULT_BUDGET.maxTasks);
    assert.equal(out.tasks[0].id, '4');
    assert.equal(out.tasks.at(-1).id, '13');
    const ev = out.events.find(e => e.type === 'tasks_dropped');
    assert.equal(ev.dropped, 4);
    assert.match(ev.hint, /report\.md/);
  });

  it('stage 2 — truncates an oversized summary and reports its original length', () => {
    const long = 'y'.repeat(DEFAULT_BUDGET.maxSummaryChars + 500);
    const out = applyBudget({ tasks: [task('01', long)], context: [] });
    assert.ok(out.tasks[0].summary.length <= DEFAULT_BUDGET.maxSummaryChars);
    assert.match(out.tasks[0].summary, /\[truncated\]$/);
    const ev = out.events.find(e => e.type === 'summary_truncated');
    assert.equal(ev.originalLength, long.length);
  });

  it('stage 2 — truncates an oversized context file', () => {
    const big = 'z'.repeat(DEFAULT_BUDGET.maxContextChars + 1000);
    const out = applyBudget({ tasks: [], context: [ctx('big.md', big)] });
    assert.ok(out.context[0].content.length <= DEFAULT_BUDGET.maxContextChars);
    assert.ok(out.events.some(e => e.type === 'context_truncated'));
  });

  it('stage 3 — switches to pointer-only once the total ceiling is crossed', () => {
    const each = 'q'.repeat(DEFAULT_BUDGET.maxContextChars);
    const files = Array.from({ length: 5 }, (_, i) => ctx(`f${i}.md`, each));
    const out = applyBudget({ tasks: [], context: files });

    const pointers = out.context.filter(c => /Content available at:/.test(c.content));
    assert.ok(pointers.length > 0);
    assert.match(pointers[0].content, /\.cadre\/.*f\d\.md/);
    assert.ok(out.events.some(e => e.type === 'context_names_only'));
  });

  it('never throws on absurd input — degradation is the contract', () => {
    const huge = Array.from({ length: 500 }, (_, i) => task(String(i), 'w'.repeat(20_000)));
    const ctxs = Array.from({ length: 200 }, (_, i) => ctx(`c${i}.md`, 'w'.repeat(50_000)));
    assert.doesNotThrow(() => applyBudget({ tasks: huge, context: ctxs }));
  });

  it('always leaves a path back to the full content', () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      ctx(`f${i}.md`, 'p'.repeat(DEFAULT_BUDGET.maxContextChars)));
    const out = applyBudget({ tasks: [], context: files });
    for (const c of out.context) {
      const intact = c.content.length <= DEFAULT_BUDGET.maxContextChars
        && !/Content available at:/.test(c.content);
      assert.ok(intact || /Content available at:|\[truncated\]/.test(c.content));
    }
  });

  it('reports the assembled size so overruns are visible, not silent', () => {
    const out = applyBudget({ tasks: [task('01', 'a')], context: [ctx('c.md', 'b')] });
    assert.ok(out.meta.totalChars > 0);
    assert.ok(out.meta.totalChars <= DEFAULT_BUDGET.maxTotalChars);
  });
});
