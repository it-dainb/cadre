/**
 * cadre durable state — `.cadre/` on disk.
 *
 * Recovery reads small structured files, never a transcript. Subagents inherit
 * nothing, so these files (plus the spawn prompt) are the only channel between
 * the lead and its workers.
 *
 * Deliberately dependency-free and host-agnostic: no Claude Code API surface,
 * so it is unit-testable standalone.
 */
import { openSync, closeSync, writeSync, renameSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
export const LOCK_TTL_MS = 30_000;
const LOCK_POLL_MS = 25;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
/** Monotonic per-process counter — temp names must be unique under concurrency. */
let tmpSeq = 0;
export function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * Write via temp-file + rename. rename(2) is atomic within a filesystem, so a
 * reader sees either the old file or the new one — never a partial write.
 */
export async function writeJsonAtomic(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, file);
}
function lockPath(file) {
    return `${file}.lock`;
}
/** Exclusive create; reclaims a lock whose holder died (mtime older than TTL). */
async function acquireLock(file, timeoutMs) {
    const lock = lockPath(file);
    const deadline = Date.now() + timeoutMs;
    // A fencing token. Without it, a holder that stalls past the TTL will, on
    // finally, unlink whatever lock file is present — including one a different
    // process legitimately took after breaking the stale one. Release then
    // becomes lock theft and two writers proceed at once.
    const token = `${process.pid}-${tmpSeq++}-${randomUUID()}`;
    for (;;) {
        try {
            const fd = openSync(lock, 'wx');
            writeSync(fd, token);
            closeSync(fd);
            return token;
        }
        catch {
            // Held. Break it only if the holder is provably stale.
            try {
                if (Date.now() - statSync(lock).mtimeMs > LOCK_TTL_MS) {
                    unlinkSync(lock);
                    continue;
                }
            }
            catch {
                continue; // vanished between stat and unlink — retry immediately
            }
            if (Date.now() >= deadline) {
                throw new Error(`could not acquire lock for ${file} within ${timeoutMs}ms`);
            }
            await new Promise(r => setTimeout(r, LOCK_POLL_MS));
        }
    }
}
function releaseLock(file, token) {
    // Compare-and-delete: only remove the lock if it still carries our token.
    // If a stalled holder's lock was broken as stale and another process took
    // its own, releasing unconditionally would delete THAT holder's lock and
    // let a third writer in while it is mid read-modify-write.
    try {
        if (readFileSync(lockPath(file), 'utf8') !== token)
            return;
        unlinkSync(lockPath(file));
    }
    catch {
        /* already gone, or unreadable — leave it to the stale-TTL path */
    }
}
/**
 * Read-modify-write under an exclusive lock, so concurrent workers appending to
 * shared state cannot lose each other's updates.
 */
export async function patchJsonLocked(file, patch, opts = {}) {
    const token = await acquireLock(file, opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    try {
        const current = (readJson(file) ?? {});
        const next = { ...current, ...(await patch(current)) };
        await writeJsonAtomic(file, next);
        return next;
    }
    finally {
        releaseLock(file, token);
    }
}
// ---- layout ---------------------------------------------------------------
export const activeTaskPath = (cadre) => join(cadre, 'active-task');
export const taskDir = (cadre, id) => join(cadre, 'tasks', id);
export const specPath = (cadre, id) => join(taskDir(cadre, id), 'spec.md');
export const statusPath = (cadre, id) => join(taskDir(cadre, id), 'status.json');
export const resultPath = (cadre, id) => join(taskDir(cadre, id), 'result.md');
/**
 * Rebuild session state after a restart or compaction.
 *
 * Returns null when idle — the SessionStart hook relies on this to early-exit
 * to an empty response, which is what keeps its injected bytes at zero.
 */
export function recoverActive(cadre) {
    const pointer = activeTaskPath(cadre);
    if (!existsSync(pointer))
        return null;
    const task = readFileSync(pointer, 'utf8').trim();
    if (!task)
        return null;
    const status = readJson(statusPath(cadre, task)) ?? {};
    const out = {
        task,
        state: status.state ?? 'unknown',
        hasSpec: existsSync(specPath(cadre, task)),
    };
    if (status.question !== undefined)
        out.question = status.question;
    return out;
}
