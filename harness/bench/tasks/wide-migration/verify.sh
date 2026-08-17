#!/bin/bash
set -e
# Tee the output so a pass leaves evidence behind, not just an exit code.
node test.mjs 2>&1 | tee /tmp/verify.out
grep -q PASS /tmp/verify.out
echo "--- migrated call sites ---"
grep -l 'emit(' src/modules/*.mjs | wc -l
echo "--- still deprecated ---"
grep -l 'logMsg(' src/modules/*.mjs | wc -l || true
