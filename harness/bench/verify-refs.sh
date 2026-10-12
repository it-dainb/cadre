#!/bin/bash
# No model: each task's hidden check must FAIL on the fixture repo and PASS (with the repo's own tests) once ref/ is laid over it.
B=$(cd "$(dirname "$0")" && pwd); rc=0
for t in "$B"/tasks/*/; do n=$(basename "$t"); repo=$(node -p "require('$t/plan.json').repo")
  w=$(mktemp -d); cp -a "$B/repos/$repo/." "$w"; mkdir -p "$w/test"; cp "$t/check.test.mjs" "$w/test/zz-check.test.mjs"; cp "$B/find.mjs" "$w/test/zz-find.mjs"
  before=$(cd "$w" && node --test test/zz-check.test.mjs >/dev/null 2>&1 && echo pass || echo fail)
  cp -a "$t/ref/." "$w"; after=$(cd "$w" && node --test >/dev/null 2>&1 && echo pass || echo fail)
  printf '%-20s before=%s after=%s\n' "$n" "$before" "$after"; [ "$before" = fail ] && [ "$after" = pass ] || rc=1; rm -rf "$w"
done; exit $rc
