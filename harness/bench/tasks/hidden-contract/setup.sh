#!/bin/bash
# Adding a field is easy. Finding the three places that must agree about it is
# the task: a validator whitelist, a serialiser, and a fixture the tests load.
set -euo pipefail
d=$1
mkdir -p "$d/src" "$d/spec" "$d/fixtures"

cat > "$d/src/schema.mjs" <<'EOF'
export const ALLOWED_FIELDS = ['id', 'name', 'email'];

export function validate(user) {
  for (const k of Object.keys(user)) {
    if (!ALLOWED_FIELDS.includes(k)) throw new Error(`unknown field: ${k}`);
  }
  return true;
}
EOF

cat > "$d/src/serialize.mjs" <<'EOF'
import { ALLOWED_FIELDS } from './schema.mjs';

// Explicit per-field handling — new fields do NOT flow through automatically.
export function serialize(user) {
  validateShape(user);
  return JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
  });
}

function validateShape(user) {
  if (!ALLOWED_FIELDS.every((f) => f in user)) throw new Error('missing field');
}
EOF

cat > "$d/fixtures/user.json" <<'EOF'
{ "id": 1, "name": "Ada", "email": "ada@example.com" }
EOF

cat > "$d/spec/user.test.mjs" <<'EOF'
import { validate } from '../src/schema.mjs';
import { serialize } from '../src/serialize.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/user.json', import.meta.url)));

assert.equal(validate(fixture), true, 'fixture must validate');
assert.equal('role' in fixture, true, 'fixture must carry the new field');

const out = JSON.parse(serialize(fixture));
assert.equal(out.role, fixture.role, 'role must survive serialisation');
assert.equal(out.email, 'ada@example.com', 'existing fields must not regress');

// The new field is constrained, not free-form.
assert.throws(() => validate({ id: 1, name: 'x', email: 'e', role: 'x', bogus: 1 }));
console.log('PASS');
EOF

cat > "$d/README.md" <<'EOF'
# user service

Run the tests with:

    node spec/user.test.mjs
EOF
