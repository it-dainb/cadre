#!/bin/bash
# Materialise the task into $1 (a fresh git repo).
set -euo pipefail
d=$1

cat > "$d/lib.mjs" <<'EOF'
export function lastN(arr, n) {
  // BUG: drops one element too many
  return arr.slice(arr.length - n + 1);
}
EOF

cat > "$d/test.mjs" <<'EOF'
import { lastN } from './lib.mjs';
import assert from 'node:assert/strict';

assert.deepEqual(lastN([1, 2, 3, 4, 5], 2), [4, 5]);
assert.deepEqual(lastN([1, 2, 3], 3), [1, 2, 3]);
assert.deepEqual(lastN([1, 2, 3], 1), [3]);
assert.deepEqual(lastN([], 0), []);
console.log('PASS');
EOF
