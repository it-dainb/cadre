/**
 * Merge gate and blocked-worker resume.
 *
 * Mechanism (named explicitly, as P5's exit criteria require): the merge gate
 * is a `PreToolUse` hook on Bash. Merging and pushing are shell commands, so
 * that is where the decision point actually is — which also means the gate
 * joins the PreToolUse 0/0 invariant: it denies, it never injects.
 *
 * Threshold is hardcoded to the spec default here. P6 makes it user-chosen at
 * `/cadre setup`; until then this build is internal-only, because shipping a
 * hardcoded default externally would breach Round 5-6.
 */

/** Round 9: >3 files estimated, or any destructive op. */
export const DEFAULT_THRESHOLD = 3;

/**
 * Commands whose blast radius is unrecoverable or trunk-visible.
 * Matched on the command string — crude, but the failure mode is a spurious
 * approval prompt rather than a silent escape, which is the right direction to
 * be wrong in.
 */
const DESTRUCTIVE = [
  { re: /\bgit\b[^;&|]*\bmerge\b/, why: 'merge to the trunk' },
  { re: /\bgit\b[^;&|]*\bpush\b/, why: 'push' },
  { re: /\bgit\b[^;&|]*\brebase\b/, why: 'history rewrite' },
  { re: /\bgit\b[^;&|]*\breset\s+--hard\b/, why: 'hard reset' },
  { re: /\bgit\b[^;&|]*\b(branch|tag)\s+-[Dd]\b/, why: 'branch or tag deletion' },
  { re: /\brm\s+-[rRf]{1,2}\b/, why: 'recursive delete' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|uninstall|remove|rm)\b/, why: 'dependency change' },
  // A schema migration is gated because it is irreversible against real data.
  // The bare word `migrate` is not that signal: it blocked `node migrate.mjs`
  // in a benchmark run, refusing an ordinary source refactor. Match the tools
  // that actually mutate a schema, not any command containing the substring.
  {
    re: /\bdb:migrate\b|\bmigrate:(latest|up|down|rollback)\b|\b(prisma|artisan|flyway|dbmate|goose|liquibase|atlas|manage\.py)\b[^;&|]*\bmigrate\b|\balembic\b[^;&|]*\b(upgrade|downgrade)\b|\b(dbmate|goose)\s+(up|down)\b/,
    why: 'schema migration',
  },
];

/**
 * Decide whether a command needs a human before it runs.
 *
 * `autonomous` (the /automatron mode) removes the *human* gate only. It never
 * reports the reviewer pass as skippable — self-review measures ~50% accuracy,
 * so the review step is what holds the accuracy floor when nobody is watching.
 */
export function classifyCommand(
  { command = '', filesTouched = 0, worktreeRoot = null },
  { threshold = DEFAULT_THRESHOLD, autonomous = false } = {},
) {
  const hits = DESTRUCTIVE.filter(d => d.re.test(command));

  // Inside a worktree, a bare merge is local plumbing — only the lead merges to
  // the trunk, and the lead is never inside a worktree. The exemption applies to
  // the MERGE HIT ONLY: a command that also pushes still gates, which a
  // first-match-wins check silently got wrong.
  const exempt = h => worktreeRoot && h.why === 'merge to the trunk';
  const live = hits.filter(h => !exempt(h));
  const hit = live[0];
  const trunkVisible = live.length > 0;

  const overThreshold = filesTouched > threshold;
  const wouldGate = Boolean(trunkVisible) || overThreshold;

  if (!wouldGate) return { gate: false, reason: 'below threshold, no destructive op' };

  const why = trunkVisible ? hit.why : `${filesTouched} files exceeds threshold ${threshold}`;

  if (autonomous) {
    return { gate: false, reason: `automatron: human gate skipped for ${why} (reviewer pass still required)` };
  }
  return { gate: true, reason: `Approval needed before ${why}.` };
}

/**
 * Build the spec for the worker that resumes after a block.
 *
 * A blocked worker terminates rather than waiting: it holds one slice of the
 * plan, the lead holds all of it, and a fresh context window is what keeps a
 * long clarification loop from accumulating in one worker.
 */
export function nextWorkerSpec({ spec, question, answer }) {
  if (!answer || !String(answer).trim()) {
    throw new Error('cannot resume without an answer — a fresh worker would block on the same question');
  }
  return [
    spec.trimEnd(),
    '',
    '## Resuming',
    '',
    'A previous worker stopped here and the lead answered. The worktree already',
    'contains that worker\'s changes; continue from them rather than starting over.',
    '',
    `**Blocked on:** ${question}`,
    `**Answer:** ${answer}`,
  ].join('\n');
}
