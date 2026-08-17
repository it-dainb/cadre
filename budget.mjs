/**
 * Prompt budgeter.
 *
 * Bounds the worst-case worker prompt regardless of how long a feature's
 * history grows. Degrades in three stages — drop → truncate → pointer-only —
 * and never throws: a budget overrun must not fail the run, it must shrink it.
 *
 * Invariant: never removes access to information. Every degraded entry still
 * names the file on disk holding the full content.
 */
export const DEFAULT_BUDGET = {
    maxTasks: 10,
    maxSummaryChars: 2_000,
    maxContextChars: 20_000,
    maxTotalChars: 60_000,
};
const MARKER = '…[truncated]';
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, Math.max(0, max - MARKER.length)) + MARKER;
}
const pointer = (name) => `[Content available at: .cadre/context/${name}]`;
/**
 * Assemble task summaries and context files within budget.
 *
 * Stage 1 drops the oldest tasks (input is chronological, newest last).
 * Stage 2 truncates any individual summary or file over its per-item cap.
 * Stage 3 replaces every remaining file with a pointer once the running total
 * crosses the ceiling — a hard mode switch, not a soft trim, so one enormous
 * tail can't nibble the budget away from everything after it.
 */
export function applyBudget(input, budget = DEFAULT_BUDGET) {
    const events = [];
    // Stage 1 — drop oldest tasks.
    let tasks = input.tasks;
    if (tasks.length > budget.maxTasks) {
        const dropped = tasks.length - budget.maxTasks;
        tasks = tasks.slice(dropped);
        events.push({
            type: 'tasks_dropped',
            dropped,
            hint: `${dropped} earlier task(s) omitted — full detail in .cadre/tasks/<id>/report.md`,
        });
    }
    // Stage 2 — per-summary cap.
    const budgetedTasks = tasks.map(t => {
        if (t.summary.length <= budget.maxSummaryChars)
            return t;
        events.push({ type: 'summary_truncated', id: t.id, originalLength: t.summary.length });
        return { ...t, summary: truncate(t.summary, budget.maxSummaryChars) };
    });
    const taskChars = budgetedTasks.reduce((n, t) => n + t.summary.length, 0);
    // Stages 2 + 3 — per-file cap, then pointer-only past the total ceiling.
    const remaining = Math.max(0, budget.maxTotalChars - taskChars);
    let used = 0;
    let namesOnly = false;
    const context = input.context.map(c => {
        if (namesOnly)
            return { ...c, content: pointer(c.name) };
        let content = c.content;
        if (content.length > budget.maxContextChars) {
            events.push({ type: 'context_truncated', name: c.name, originalLength: content.length });
            content = truncate(content, budget.maxContextChars);
        }
        if (used + content.length > remaining) {
            namesOnly = true;
            events.push({ type: 'context_names_only', from: c.name });
            return { ...c, content: pointer(c.name) };
        }
        used += content.length;
        return { ...c, content };
    });
    const contextChars = context.reduce((n, c) => n + c.content.length, 0);
    return {
        tasks: budgetedTasks,
        context,
        events,
        meta: { totalChars: taskChars + contextChars, taskChars, contextChars },
    };
}
