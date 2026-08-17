#!/bin/bash
# Cross-file change: the symbol is used in more places than the obvious one.
set -euo pipefail
d=$1
mkdir -p "$d/src"

cat > "$d/src/cache.mjs" <<'EOF'
const store = new Map();
export function getCachedThing(key) { return store.get(key); }
export function setCachedThing(key, v) { store.set(key, v); return v; }
EOF

cat > "$d/src/api.mjs" <<'EOF'
import { getCachedThing, setCachedThing } from './cache.mjs';
export function fetchUser(id, loader) {
  const hit = getCachedThing(`user:${id}`);
  if (hit) return hit;
  return setCachedThing(`user:${id}`, loader(id));
}
EOF

cat > "$d/src/report.mjs" <<'EOF'
import { getCachedThing } from './cache.mjs';
export function cachedReport(id) { return getCachedThing(`report:${id}`) ?? null; }
EOF

cat > "$d/test.mjs" <<'EOF'
import { fetchUser } from './src/api.mjs';
import { cachedReport } from './src/report.mjs';
import * as cache from './src/cache.mjs';
import assert from 'node:assert/strict';

assert.equal(typeof cache.readEntry, 'function', 'expected readEntry export');
assert.equal(typeof cache.writeEntry, 'function', 'expected writeEntry export');
assert.equal(cache.getCachedThing, undefined, 'old name must be gone');
assert.equal(cache.setCachedThing, undefined, 'old name must be gone');

let calls = 0;
const loader = (id) => { calls++; return { id }; };
assert.deepEqual(fetchUser(1, loader), { id: 1 });
assert.deepEqual(fetchUser(1, loader), { id: 1 });
assert.equal(calls, 1, 'second fetch must hit cache');
assert.equal(cachedReport(9), null);
console.log('PASS');
EOF
