#!/bin/bash
# The bug report names ONE symptom. The defect is in a shared helper with four
# callers; patching only the reported path leaves three siblings broken.
set -euo pipefail
d=$1
mkdir -p "$d/src"

cat > "$d/src/money.mjs" <<'EOF'
// Shared money formatter. Used across the app.
export function formatAmount(cents, currency) {
  const v = cents / 100;
  return `${currency}${v.toFixed(2)}`;
}
EOF

cat > "$d/src/invoice.mjs" <<'EOF'
import { formatAmount } from './money.mjs';
export const invoiceLine = (c) => `Invoice: ${formatAmount(c, '$')}`;
EOF

cat > "$d/src/receipt.mjs" <<'EOF'
import { formatAmount } from './money.mjs';
export const receiptLine = (c) => `Receipt: ${formatAmount(c, '$')}`;
EOF

cat > "$d/src/refund.mjs" <<'EOF'
import { formatAmount } from './money.mjs';
export const refundLine = (c) => `Refund: ${formatAmount(c, '$')}`;
EOF

cat > "$d/src/summary.mjs" <<'EOF'
import { formatAmount } from './money.mjs';
export const summaryLine = (c) => `Total: ${formatAmount(c, '$')}`;
EOF

cat > "$d/REPORT.md" <<'EOF'
# Bug report

Negative amounts render wrong on the invoice screen.

Expected: `Invoice: -$3.50`
Actual:   `Invoice: $-3.50`

The minus sign must come before the currency symbol.
EOF

cat > "$d/test.mjs" <<'EOF'
import { invoiceLine } from './src/invoice.mjs';
import { receiptLine } from './src/receipt.mjs';
import { refundLine } from './src/refund.mjs';
import { summaryLine } from './src/summary.mjs';
import assert from 'node:assert/strict';

// The reported path.
assert.equal(invoiceLine(-350), 'Invoice: -$3.50');
// The three the report never mentions.
assert.equal(receiptLine(-350), 'Receipt: -$3.50');
assert.equal(refundLine(-1299), 'Refund: -$12.99');
assert.equal(summaryLine(-5), 'Total: -$0.05');
// Positives must not regress.
assert.equal(invoiceLine(350), 'Invoice: $3.50');
assert.equal(summaryLine(0), 'Total: $0.00');
console.log('PASS');
EOF
