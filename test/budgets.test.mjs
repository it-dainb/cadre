/**
 * CI budget regression checks.
 *
 * Per the build plan these land at the phase where each metric first becomes
 * measurable, not batched into a final suite — otherwise drift compounds across
 * phases and the suite fails on every row at once, at which point the ceilings
 * get raised to make it pass.
 *
 * P2 lands: volatile-input tripwire, CLAUDE.md size (once it exists).
 * Later phases add: spawn tokens (P3), absolute-path leak (P3), depth cap (P4),
 * reviewer MCP = 0 (P5), full always-on ceiling (post-P7).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The plugin, not the repo. Scanning the repo root would walk `refs/` — four
// vendored submodules — and report their volatile calls as cadre's own.
const CADRE = new URL('../src/', import.meta.url).pathname;

/** Volatile calls break prompt-cache prefixes when they reach assembled text. */
const VOLATILE = [/\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /\brandomUUID\s*\(/, /\bperformance\.now\s*\(/, /new Date\s*\(\s*\)/];

/**
 * Each entry must say why this file's volatile call never reaches prompt bytes.
 * A file may only appear here with a justification — and the second test below
 * fails if an entry goes stale, so the list can't rot into a blanket exemption.
 */
const ALLOWLIST = {
  'state.mjs':
    'Date.now() gates lock staleness (TTL) and never reaches assembled prompt text — lock files are process coordination, not content.',
};

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|mjs|cjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('volatile-input tripwire', () => {
  const files = sourceFiles(CADRE);

  it('finds no unjustified volatile call in prompt-assembly code', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(CADRE, f);
      if (ALLOWLIST[rel]) continue;
      const src = readFileSync(f, 'utf8');
      for (const re of VOLATILE) if (re.test(src)) offenders.push(`${rel}: ${re.source}`);
    }
    assert.deepEqual(offenders, []);
  });

  it('has no stale allowlist entry', () => {
    const stale = [];
    for (const [rel, why] of Object.entries(ALLOWLIST)) {
      const p = join(CADRE, rel);
      if (!existsSync(p)) { stale.push(`${rel}: file gone`); continue; }
      if (!VOLATILE.some(re => re.test(readFileSync(p, 'utf8')))) stale.push(`${rel}: no longer volatile`);
      assert.ok(why.length > 20, `${rel}: justification too thin`);
    }
    assert.deepEqual(stale, []);
  });
});

describe('always-on payload', () => {
  it('keeps CLAUDE.md within its ceiling once it exists', () => {
    const f = join(CADRE, 'CLAUDE.md');
    if (!existsSync(f)) return; // lands with the agent catalog, later phase
    assert.ok(statSync(f).size <= 1_500);
  });
});
