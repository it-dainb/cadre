import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, patchJsonLocked, readJson, taskDir, recoverActive, LOCK_TTL_MS } from './state.mjs';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cadre-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('atomic writes', () => {
  // cadre: atomicity itself is NOT covered here, and that is deliberate.
  // Two approaches were tried and both were false assurance:
  //   1. an in-process reader racing the writer — Node issues a single write()
  //      at these sizes, so a naive writeFileSync passes and the test can
  //      never fail;
  //   2. spying on fs.renameSync — state.mjs binds named ESM imports at module
  //      load, so the spy never intercepts and the test fails even on correct
  //      code.
  // Real coverage needs a process killed mid-write (cross-process harness).
  // Upgrade path: add that to the P8 suite if torn state is ever observed.
  it('survives many concurrent writers with a parseable result', async () => {
    const f = join(root, 'c.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeJsonAtomic(f, { writer: i, blob: 'x'.repeat(50_000) })),
    );
    const got = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(typeof got.writer, 'number');
    assert.equal(got.blob.length, 50_000);
  });

  it('leaves no temp files behind', async () => {
    const f = join(root, 'a.json');
    await writeJsonAtomic(f, { a: 1 });
    assert.deepEqual(readdirSync(root).filter(n => n !== 'a.json'), []);
  });
});

describe('locking', () => {
  it('serialises concurrent patches without losing updates', async () => {
    const f = join(root, 'counter.json');
    await writeJsonAtomic(f, { n: 0 });
    await Promise.all(Array.from({ length: 25 }, () => patchJsonLocked(f, cur => ({ n: cur.n + 1 }))));
    assert.equal(readJson(f).n, 25);
  });

  it('reclaims a stale lock past its TTL instead of deadlocking', async () => {
    const f = join(root, 'x.json');
    await writeJsonAtomic(f, { v: 1 });
    // Simulate a crashed holder: lock file exists, mtime far in the past.
    const lock = `${f}.lock`;
    writeFileSync(lock, String(process.pid));
    const stale = new Date(Date.now() - LOCK_TTL_MS * 3);
    utimesSync(lock, stale, stale);

    await patchJsonLocked(f, () => ({ v: 2 }));
    assert.equal(readJson(f).v, 2);
    assert.equal(existsSync(lock), false);
  });

  it('does not break a lock that is still fresh', async () => {
    const f = join(root, 'y.json');
    await writeJsonAtomic(f, { v: 1 });
    writeFileSync(`${f}.lock`, 'held');
    await assert.rejects(() => patchJsonLocked(f, () => ({ v: 2 }), { timeoutMs: 150 }), /lock/i);
  });
});

describe('recovery', () => {
  it('reconstructs session state from small files only, never a transcript', () => {
    const cadre = join(root, '.cadre');
    mkdirSync(join(cadre, 'tasks', '01_first'), { recursive: true });
    writeFileSync(join(cadre, 'active-task'), '01_first');
    writeFileSync(join(cadre, 'tasks', '01_first', 'spec.md'), '# spec');
    writeFileSync(join(cadre, 'tasks', '01_first', 'status.json'),
      JSON.stringify({ state: 'blocked', question: 'which db?' }));

    assert.deepEqual(recoverActive(cadre),
      { task: '01_first', state: 'blocked', hasSpec: true, question: 'which db?' });
  });

  it('returns null when no task is active (the idle path)', () => {
    const cadre = join(root, '.cadre');
    mkdirSync(cadre, { recursive: true });
    assert.equal(recoverActive(cadre), null);
  });

  it('builds task paths under the documented layout', () => {
    assert.equal(taskDir('/r/.cadre', '01_x'), '/r/.cadre/tasks/01_x');
  });
});

describe('lock ownership — review finding', () => {
  it('does not delete a lock it no longer owns', async () => {
    const f = join(root, 'own.json');
    await writeJsonAtomic(f, { v: 1 });
    const lock = `${f}.lock`;

    // A stalls past the TTL; B breaks the stale lock and takes its own.
    // A's release must not remove B's lock.
    const held = patchJsonLocked(f, async (cur) => {
      writeFileSync(lock, 'token-from-a-different-holder');
      return { v: cur.v + 1 };
    });
    await held;
    assert.equal(existsSync(lock), true, "released another holder's lock");
    rmSync(lock, { force: true });
  });

  it('still cleans up its own lock on the happy path', async () => {
    const f = join(root, 'happy.json');
    await writeJsonAtomic(f, { v: 1 });
    await patchJsonLocked(f, () => ({ v: 2 }));
    assert.equal(existsSync(`${f}.lock`), false);
  });

  it('still cleans up its own lock when the patch throws', async () => {
    const f = join(root, 'boom.json');
    await writeJsonAtomic(f, { v: 1 });
    await assert.rejects(() => patchJsonLocked(f, () => { throw new Error('boom'); }), /boom/);
    assert.equal(existsSync(`${f}.lock`), false);
  });
});
