/**
 * spec.md assembly.
 *
 * Subagents inherit nothing — not CLAUDE.md, not project rules, not the lead's
 * conversation. The spawn prompt is the only reliable channel, and we author
 * it, so it is simultaneously the only channel and the only control point.
 *
 * spec.md is therefore the single source for plan + context + prior summaries.
 * The worker prompt deliberately does NOT re-embed any of them; it points at
 * spec.md. Composing the same information twice is the cheapest possible way
 * to double a prompt.
 */
import { applyBudget, DEFAULT_BUDGET } from './budget.mjs';
export function buildSpec(input, budget = DEFAULT_BUDGET) {
    const { tasks, context, events } = applyBudget({ tasks: input.priorTasks, context: input.context }, budget);
    const parts = [
        `# Task ${input.taskId}`,
        '',
        `## Goal`,
        '',
        input.goal,
        '',
        '## Plan',
        '',
        input.plan,
    ];
    if (tasks.length) {
        parts.push('', '## Prior tasks', '');
        for (const t of tasks)
            parts.push(`- **${t.id}** — ${t.summary}`);
    }
    if (context.length) {
        parts.push('', '## Context', '');
        for (const c of context)
            parts.push(`### ${c.name}`, '', c.content, '');
    }
    // Truncation is reported, never silent: a worker that can see what was
    // dropped can go read the file instead of guessing.
    if (events.length) {
        parts.push('', '## Budget notes', '');
        for (const e of events) {
            if (e.type === 'tasks_dropped')
                parts.push(`- ${e.hint}`);
            else if (e.type === 'summary_truncated')
                parts.push(`- summary for ${e.id} truncated (was ${e.originalLength} chars) — full text in .cadre/tasks/${e.id}/result.md`);
            else if (e.type === 'context_truncated')
                parts.push(`- ${e.name} truncated (was ${e.originalLength} chars) — full file in .cadre/context/${e.name}`);
            else
                parts.push(`- context switched to pointers from ${e.from} onward — read the named files directly`);
        }
    }
    return parts.join('\n');
}
/**
 * The worker's spawn prompt. Small by construction — everything substantive
 * lives in spec.md, which the worker reads itself.
 */
export function buildWorkerPrompt({ taskId, specPath }) {
    return [
        `Read ${specPath} first — it carries the goal, the plan, the relevant context and prior task summaries.`,
        '',
        `You are working on task ${taskId} inside an isolated git worktree.`,
        '',
        'Rules:',
        '- Use paths relative to the worktree root. Absolute paths escape the worktree silently and will be denied.',
        '- If you cannot proceed, do not ask the user. Write `{"state":"blocked","question":"..."}` to status.json and stop; the lead holds the whole plan and will answer.',
        '- When done, write a summary to result.md and set status.json state to `completed`.',
    ].join('\n');
}
