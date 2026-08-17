#!/bin/bash
set -e
# The expected value is a constant, not a recomputation. v1's verify.sh
# recomputed the total from the same formula setup.sh used — fine as an
# independence property, but it meant the answer existed as a one-line formula
# in the repo, and an agent recovered that formula from the corpus itself.
# There is no formula now: the durations are authored, so the only way to hold
# the answer is to hold the number.
#
# setup.sh asserts fixture/records.json still sums to this exact value and
# aborts if it does not, so the two cannot drift apart silently. Change one,
# change both.
#
# Nothing the agent leaves in the tree is read as input — only its answer file.
EXPECTED=135096

node - "$EXPECTED" <<'EOF' 2>&1 | tee /tmp/verify.out
const fs = require('fs');
const expected = process.argv[2];

let got;
try {
  got = fs.readFileSync('TOTAL_DOWNTIME.txt', 'utf8').trim();
} catch {
  console.log('FAIL: TOTAL_DOWNTIME.txt not found');
  process.exit(1);
}

if (String(expected) === got) {
  console.log(`PASS (expected ${expected}, got ${got})`);
} else {
  console.log(`FAIL: expected ${expected}, got ${got}`);
  process.exit(1);
}
EOF
grep -q PASS /tmp/verify.out
