#!/usr/bin/env node
/**
 * PreToolUse gate. Blocks; never nudges.
 *
 * Checks:
 *   1. absolute-path writes escaping an active worktree (measured leak: exit 0,
 *      no error, isolation silently defeated)
 *   2. Agent/Task dispatch from inside a worktree (depth cap)
 *   3. merge/push/destructive shell commands, and oversized blast radius
 *   4. plan.md writes lacking a substantive Discovery section
 *   5. spec.md writes exceeding the prompt budget ceiling
 *
 * A denial changes behaviour at zero context cost. Injected advice would be
 * written into transcript history and paid on every later turn, so this hook
 * never emits additionalContext — it either denies or stays silent.
 *
 * FAILS CLOSED. An unexpected payload shape or an internal throw must not
 * become a silent bypass: a hook that errors produces no decision, and Claude
 * Code treats that as non-blocking. For a gate, denying on error is correct.
 */
import { classifyWrite, validatePlan, classifyDelegation } from '../gate.mjs';
import { classifyCommand } from '../merge.mjs';
import { readConfig } from '../config.mjs';
import { DEFAULT_BUDGET } from '../budget.mjs';
import { execFileSync } from 'node:child_process';

const emit = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };

const deny = (reason) => emit({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

const allow = () => emit({ continue: true, suppressOutput: true });

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

let evt = {};
try {
  evt = JSON.parse(Buffer.concat(chunks).toString() || '{}');
} catch {
  // Unparseable stdin is a harness problem, not a policy violation — there is
  // no tool call to judge, so allowing is right.
  allow();
}

try {
  const input = evt.tool_input ?? {};
  const rawPath = typeof input.file_path === 'string' ? input.file_path
    : typeof input.notebook_path === 'string' ? input.notebook_path : '';
  const path = rawPath.replace(/\\/g, '/');
  const rawCwd = typeof evt.cwd === 'string' ? evt.cwd : process.cwd();

  // Normalise separators so Windows paths are detected. Without this the regex
  // never matches on Windows, worktreeRoot is always null, and every gate here
  // silently allows — failing open on an entire platform.
  const cwd = rawCwd.replace(/\\/g, '/');

  // Require the `.claude/worktrees/<name>` shape rather than any directory
  // named "worktrees": a project legitimately checked out under such a path
  // would otherwise have all delegation denied.
  const m = cwd.match(/^(.*\/\.claude\/worktrees\/[^/]+)(?:\/|$)/);
  const worktreeRoot = m ? m[1] : null;

  const toolName = typeof evt.tool_name === 'string' ? evt.tool_name : '';

  // Merge gate: merging and pushing are shell commands, so Bash is the decision
  // point. Denies; never injects.
  if (toolName === 'Bash') {
    // Config lives at the project root. Resolving it from the cwd meant that
    // inside a worktree — where `.cadre/` does not exist — readConfig silently
    // returned the adaptive default and demanded approval in automatron mode,
    // stranding a finished 28-file migration nobody could approve.
    const projectRoot = worktreeRoot
      ? worktreeRoot.replace(/\/\.claude\/worktrees\/[^/]+$/, '')
      : cwd;
    const cfg = readConfig(projectRoot);
    const command = typeof input.command === 'string' ? input.command : '';
    const verdict = classifyCommand(
      { command, filesTouched: countChangedFiles(worktreeRoot ?? cwd), worktreeRoot },
      { threshold: cfg.threshold, autonomous: cfg.mode === 'automatron' },
    );
    if (verdict.gate) deny(verdict.reason);
  }

  // Agent/Task from inside a worktree = a worker trying to spawn a worker.
  if (/^(Agent|Task)$/.test(toolName)) {
    const verdict = classifyDelegation({ worktreeRoot });
    if (!verdict.allow) deny(verdict.reason);
  }

  if (path) {
    const verdict = classifyWrite({ path, worktreeRoot });
    if (!verdict.allow) deny(verdict.reason);

    const content = typeof input.content === 'string' ? input.content
      : typeof input.new_string === 'string' ? input.new_string : '';

    if (/(^|\/)plan\.md$/.test(path) && /\.cadre\//.test(path) && content) {
      const check = validatePlan(content);
      if (!check.ok) deny(check.message);
    }

    // The prompt budget, enforced rather than documented. spec.md is the only
    // channel into a worker, so an oversized spec is an unbounded worker prompt
    // — the exact failure the budgeter exists to prevent. Denying here is what
    // makes the ceiling structural instead of a convention nobody applies.
    if (/(^|\/)spec\.md$/.test(path) && /\.cadre\//.test(path) && content) {
      if (content.length > DEFAULT_BUDGET.maxTotalChars) {
        deny(
          `spec.md is ${content.length} characters; the budget ceiling is ${DEFAULT_BUDGET.maxTotalChars}. ` +
          'Assemble it with applyBudget() so oversized history degrades to pointers ' +
          '(drop oldest tasks, truncate summaries, then reference files by path) ' +
          'rather than growing the worker prompt without bound.',
        );
      }
    }
  }

  allow();
} catch (err) {
  deny(`cadre gate failed to evaluate this call (${err?.message ?? 'unknown error'}). Denying rather than allowing an unchecked action.`);
}

/**
 * Blast radius, for the file-count half of the threshold rule.
 *
 * Round 9 gates on ">3 files touched OR any destructive op", but the count was
 * never computed — it defaulted to 0, so the configurable threshold was inert
 * and only the command patterns ever fired.
 */
function countChangedFiles(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    // cadre's own bookkeeping is not blast radius. Counting `.cadre/` and
    // `.claude/` pushed a legitimate 3-file change to 4 and tripped a
    // threshold-3 gate on the plugin's own state — observed in a benchmark run.
    return out
      .split('\n')
      .filter(l => l.trim())
      .filter(l => !/^..\s+"?\.(cadre|claude)\//.test(l))
      .length;
  } catch {
    return 0; // not a git repo, or git unavailable — the command patterns still apply
  }
}
