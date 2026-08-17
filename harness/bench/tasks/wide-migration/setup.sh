#!/bin/bash
# Breadth, not depth. 28 modules each call a deprecated helper; all must move to
# the new API. No single edit is hard — missing one is the failure mode, and
# that is what orchestration is supposed to be good at.
set -euo pipefail
d=$1
mkdir -p "$d/src/modules"

cat > "$d/src/log.mjs" <<'EOF'
// Deprecated: logMsg(level, text)
// New API:    emit({ level, text, at })  — `at` is required.
export function logMsg(level, text) {
  return `[${level}] ${text}`;
}

export function emit({ level, text, at }) {
  if (at === undefined) throw new Error('emit: `at` is required');
  return `[${level}] ${text} @${at}`;
}
EOF

NAMES="auth billing cache config crypto db email events export feed
gateway health import index jobs kv mailer metrics notify orders
parser queue router search session stats tasks users"

i=0
for n in $NAMES; do
  i=$((i + 1))
  cat > "$d/src/modules/$n.mjs" <<EOF
import { logMsg } from '../log.mjs';
export function ${n}Report() {
  return logMsg('info', '$n ready');
}
EOF
done

# Test asserts EVERY module migrated. One miss fails the suite.
cat > "$d/test.mjs" <<'EOF'
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('./src/modules/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
assert.equal(files.length, 28, `expected 28 modules, found ${files.length}`);

const missed = [];
for (const f of files) {
  const mod = await import(new URL(f, dir));
  const fn = Object.values(mod)[0];
  const out = fn();
  // The new API stamps "@<at>"; the deprecated one cannot produce it.
  if (!/@/.test(out)) missed.push(f);
}
assert.deepEqual(missed, [], `still on the deprecated API: ${missed.join(', ')}`);
console.log('PASS');
EOF
