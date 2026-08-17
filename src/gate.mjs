/**
 * Tool-side gates.
 *
 * Enforcement ladder: block > structural tool removal > ephemeral injection >
 * persistent injection. Everything here is rung 1 — a denial changes behaviour
 * and costs zero context, whereas injected advice is written into transcript
 * history and paid on every subsequent turn.
 */
import { resolve, isAbsolute, dirname } from 'node:path';
import { realpathSync } from 'node:fs';
/**
 * `isolation: "worktree"` does NOT constrain absolute paths — measured: a worker
 * inside a worktree wrote to the main repo, exit 0, no error, silently
 * defeating isolation. This closes that hole.
 *
 * Inert when no worktree is active: the gate guards isolation, and there is no
 * isolation to guard outside one.
 */
export function classifyWrite({ path, worktreeRoot }) {
    if (!worktreeRoot)
        return { allow: true };
    // Relative paths resolve inside the worker's cwd (the worktree) by
    // construction, so they need no check — and asking workers to use them is the
    // documented remedy.
    if (!path)
        return { allow: true };
    // Node's posix isAbsolute() calls "C:/x" relative, so a Windows absolute
    // path would be waved through as if it were worktree-relative.
    const isWindowsAbsolute = (p) => /^[A-Za-z]:[\\/]/.test(p);
    if (!isAbsolute(path) && !isWindowsAbsolute(path))
        return { allow: true };
    // resolve() is purely lexical, so a symlink inside the worktree pointing out
    // of it passes containment while the write lands elsewhere — the same escape
    // this gate exists to stop, reached by a different mechanism. Resolve
    // symlinks for real; for a file that does not exist yet, resolve its nearest
    // existing ancestor instead.
    const realOrNull = (p) => {
        try {
            return realpathSync(p);
        }
        catch {
            return null;
        }
    };
    const root = realOrNull(worktreeRoot) ?? resolve(worktreeRoot);
    const target = resolve(path);
    // Segment-aware containment: a sibling worktree whose name merely shares a
    // prefix (agent-abc vs agent-abcdef) must not be treated as inside.
    const contained = (p) => p === root || p.startsWith(`${root}/`);
    if (!contained(target))
        return deny(path, worktreeRoot);
    // Lexically inside — but resolve() does not follow symlinks, so a link
    // inside the worktree pointing out of it would pass. Walk up to the deepest
    // ancestor that actually exists and check where it really lands. Only
    // ancestors still lexically inside the root are worth checking: if nothing
    // inside the root exists yet, no link within it can have been traversed.
    let cur = target;
    for (;;) {
        const parent = dirname(cur);
        if (parent === cur || !contained(parent))
            break;
        const r = realOrNull(parent);
        if (r)
            return contained(r) ? { allow: true } : deny(path, worktreeRoot);
        cur = parent;
    }
    return { allow: true };
}

function deny(path, worktreeRoot) {
    return {
        allow: false,
        reason: `Write to ${path} is outside the active worktree (${worktreeRoot}). ` +
            `Absolute paths escape worktree isolation silently. Use a path relative to the worktree root instead.`,
    };
}
// ---- plan-write gate ------------------------------------------------------
const DISCOVERY_HEADING = /^##\s+discovery\s*$/im;
const NEXT_HEADING = /^##\s+/m;
const MIN_DISCOVERY_CHARS = 100;
const EXAMPLE = 'Example:\n\n' +
    '## Discovery\n\n' +
    'The interceptor in src/auth/client.ts catches 401 but not 403, and the token\n' +
    'refresh path is only reachable from the retry branch. Three callers depend on\n' +
    'the current behaviour: ...\n';
/**
 * Reject a plan lacking a substantive Discovery section.
 *
 * Two chained checks, because a single existence check is trivially gamed by
 * writing the heading with nothing under it. Returns a descriptive string
 * rather than throwing — the calling agent can act on text in the same turn,
 * whereas an exception just surfaces as a tool failure.
 */
export function validatePlan(content) {
    const m = content.match(DISCOVERY_HEADING);
    if (!m) {
        return {
            ok: false,
            message: 'BLOCKED: plan has no `## Discovery` section. State what you found in the ' +
                'code before proposing steps — a plan written without discovery encodes ' +
                'assumptions rather than findings.\n\n' + EXAMPLE,
        };
    }
    const after = content.slice(m.index + m[0].length);
    const next = after.match(NEXT_HEADING);
    const section = (next ? after.slice(0, next.index) : after).trim();
    if (section.length < MIN_DISCOVERY_CHARS) {
        return {
            ok: false,
            message: `BLOCKED: the \`## Discovery\` section is ${section.length} characters; at least ` +
                `${MIN_DISCOVERY_CHARS} are required. A heading with nothing beneath it satisfies ` +
                'the letter of the rule and none of its purpose.\n\n' + EXAMPLE,
        };
    }
    return { ok: true };
}

// ---- delegation depth cap --------------------------------------------------

/**
 * Workers do not dispatch workers.
 *
 * Past depth 2 a subagent's completion notification routes to the root session
 * and the intermediate parent waits forever (#75043). Recursion is also the
 * documented shape of the unbounded-burn failure (#68619), made worse by
 * exactly the orchestrator/delegate framing this design uses.
 *
 * The rule is positional rather than a counter: anything running inside a
 * worktree is a worker, and a worker delegating is what creates depth 2.
 */
export function classifyDelegation({ worktreeRoot }) {
    if (!worktreeRoot)
        return { allow: true };
    return {
        allow: false,
        reason: 'Workers do not dispatch workers — past depth 2 a subagent\'s completion ' +
            'notification never arrives and the parent waits forever. Finish your slice and ' +
            'report through status.json; the lead holds the whole plan and will dispatch what comes next.',
    };
}
