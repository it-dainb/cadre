import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWrite, validatePlan, classifyDelegation } from '../src/gate.mjs';

const WT = '/repo/.claude/worktrees/agent-abc';

describe('absolute-path write gate', () => {
  // Reproduces the measured leak: a worker in a worktree wrote to the main
  // repo via an absolute path, exit 0, no error, silently defeating isolation.
  it('denies an absolute path outside the active worktree', () => {
    const r = classifyWrite({ path: '/repo/probe-leak.txt', worktreeRoot: WT });
    assert.equal(r.allow, false);
    assert.match(r.reason, /outside|worktree/i);
  });

  it('allows an absolute path inside the active worktree', () => {
    assert.equal(classifyWrite({ path: `${WT}/src/a.ts`, worktreeRoot: WT }).allow, true);
  });

  it('allows relative paths', () => {
    assert.equal(classifyWrite({ path: 'src/a.ts', worktreeRoot: WT }).allow, true);
  });

  it('denies traversal that escapes the worktree', () => {
    assert.equal(classifyWrite({ path: `${WT}/../../../etc/passwd`, worktreeRoot: WT }).allow, false);
  });

  it('allows traversal that stays inside the worktree', () => {
    assert.equal(classifyWrite({ path: `${WT}/src/../lib/a.ts`, worktreeRoot: WT }).allow, true);
  });

  it('is inert when no worktree is active — the gate only guards isolation', () => {
    assert.equal(classifyWrite({ path: '/anywhere/at/all.txt', worktreeRoot: null }).allow, true);
  });

  it('does not confuse a sibling worktree sharing a name prefix', () => {
    const r = classifyWrite({ path: '/repo/.claude/worktrees/agent-abcdef/x.ts', worktreeRoot: WT });
    assert.equal(r.allow, false);
  });

  it('names the offending path so the worker can correct itself', () => {
    const r = classifyWrite({ path: '/repo/x.ts', worktreeRoot: WT });
    assert.ok(r.reason.includes('/repo/x.ts'));
    assert.match(r.reason, /relative/i);
  });
});

describe('plan-write gate', () => {
  const body = d => `# Plan\n\n## Discovery\n\n${d}\n\n## Steps\n\n1. do it\n`;

  it('accepts a plan with a substantive Discovery section', () => {
    assert.equal(validatePlan(body('x'.repeat(150))).ok, true);
  });

  it('rejects a plan with no Discovery section', () => {
    const r = validatePlan('# Plan\n\n## Steps\n\n1. go\n');
    assert.equal(r.ok, false);
    assert.match(r.message, /BLOCKED/);
    assert.match(r.message, /## Discovery/);
  });

  it('rejects a Discovery heading with no substance beneath it', () => {
    const r = validatePlan(body('too short'));
    assert.equal(r.ok, false);
    assert.match(r.message, /100/);
  });

  it('gives a worked example rather than only naming the failure', () => {
    const r = validatePlan('# Plan\n');
    assert.ok(r.message.length > 120);
    assert.match(r.message, /Discovery/);
  });

  it('is case- and spacing-tolerant on the heading', () => {
    const c = `# Plan\n\n##   discovery  \n\n${'y'.repeat(150)}\n`;
    assert.equal(validatePlan(c).ok, true);
  });

  it('measures only the Discovery section, not the whole document', () => {
    const c = `# Plan\n\n## Discovery\n\nshort\n\n## Steps\n\n${'z'.repeat(5000)}\n`;
    assert.equal(validatePlan(c).ok, false);
  });
});

describe('delegation depth cap', () => {
  it('denies spawning a subagent from inside a worktree', () => {
    const r = classifyDelegation({ worktreeRoot: WT });
    assert.equal(r.allow, false);
    assert.match(r.reason, /depth|nested|worker/i);
  });

  it('allows the lead to dispatch — it is not inside a worktree', () => {
    assert.equal(classifyDelegation({ worktreeRoot: null }).allow, true);
  });

  // #75043: a depth>=2 subagent's completion notification routes to the root
  // session, so the intermediate parent waits forever. The cap is what keeps
  // that from being reachable at all.
  it('explains why, so the worker reports back instead of retrying', () => {
    const r = classifyDelegation({ worktreeRoot: WT });
    assert.match(r.reason, /status\.json|report|lead/i);
  });
});

describe('gate hardening — review findings', () => {
  it('denies a path that escapes via a symlink inside the worktree', async () => {
    const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const base = mkdtempSync(join(tmpdir(), 'cadre-sym-'));
    try {
      const wt = join(base, '.claude', 'worktrees', 'agent-a');
      mkdirSync(wt, { recursive: true });
      mkdirSync(join(base, 'outside'), { recursive: true });
      symlinkSync(join(base, 'outside'), join(wt, 'link'));
      // Lexically inside the worktree; actually resolves outside it.
      const r = classifyWrite({ path: join(wt, 'link', 'escaped.txt'), worktreeRoot: wt });
      assert.equal(r.allow, false);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('tolerates a worktreeRoot with a trailing slash', () => {
    assert.equal(classifyWrite({ path: '/r/wt/a.ts', worktreeRoot: '/r/wt/' }).allow, true);
    assert.equal(classifyWrite({ path: '/r/other/a.ts', worktreeRoot: '/r/wt/' }).allow, false);
  });

  it('allows a write to the worktree root itself', () => {
    assert.equal(classifyWrite({ path: '/r/wt', worktreeRoot: '/r/wt' }).allow, true);
  });

  it('treats an empty path as nothing to check', () => {
    assert.equal(classifyWrite({ path: '', worktreeRoot: '/r/wt' }).allow, true);
  });
});
