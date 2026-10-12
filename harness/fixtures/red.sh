# overlay: the test suite is already red at the start (the plan must gate only on new failures)
. "$(dirname "$0")/_base.sh"; P=.; [ -d kit ] && P=kit
printf "import { test } from 'node:test'\nimport assert from 'node:assert'\ntest('known red', () => assert.equal(1, 2))\n" >"$P/test/red.test.mjs"
[ -d .git ] && commit 'test: a known red test' || true
