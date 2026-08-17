#!/bin/bash
# Depth, not breadth. The obvious fix passes the obvious case and breaks the
# trailing-edge and timer-reset semantics. Designed to punish a plausible
# shallow fix rather than an absent one.
set -euo pipefail
d=$1
mkdir -p "$d/src"

cat > "$d/src/debounce.mjs" <<'EOF'
// debounce(fn, ms): call fn once, ms after the LAST call.
// Should pass the most recent arguments, return the pending promise to every
// caller, and reset the timer on each new call.
export function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    if (timer) return;              // BUG
    timer = setTimeout(() => {
      timer = null;
      fn(...args);                  // BUG: stale args
    }, ms);
  };
}
EOF

cat > "$d/test.mjs" <<'EOF'
import { debounce } from './src/debounce.mjs';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = [];
const d = debounce((x) => calls.push(x), 50);

// Rapid calls collapse to ONE invocation carrying the LAST argument.
d(1); d(2); d(3);
await sleep(90);
assert.deepEqual(calls, [3], `expected [3], got ${JSON.stringify(calls)}`);

// The timer must RESET on each call, not fire ms after the first.
calls = [];
const d2 = debounce((x) => calls.push(x), 60);
d2('a');
await sleep(40); d2('b');
await sleep(40); d2('c');
await sleep(40);
assert.deepEqual(calls, [], `must not have fired yet, got ${JSON.stringify(calls)}`);
await sleep(40);
assert.deepEqual(calls, ['c'], `expected ['c'], got ${JSON.stringify(calls)}`);

// Usable again after firing.
calls = [];
const d3 = debounce((x) => calls.push(x), 30);
d3('x');
await sleep(60);
d3('y');
await sleep(60);
assert.deepEqual(calls, ['x', 'y']);

console.log('PASS');
EOF
