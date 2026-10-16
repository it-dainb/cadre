# overlay on `single ready`: lib/ is a git submodule (its own repository, a unit with ownGit) with its own npm test and dev; the scripted model plays `sub`
# (main's lite task names package lib). The submodule's source is a temp repo; cadre clones worktrees from the checkout's own copy (no network).
. "$(dirname "$0")/_base.sh"
SRC=$(mktemp -d); ( cd "$SRC" && echo '{ "name": "lib", "version": "0.0.0", "type": "module", "scripts": { "test": "node --test" } }' >package.json && mkdir src test \
  && echo "export const pad = s => \` \${s} \`" >src/pad.mjs && printf "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { pad } from '../src/pad.mjs'\ntest('pad', () => assert.equal(pad('a'), ' a '))\n" >test/pad.test.mjs && gi )
git -c protocol.file.allow=always submodule add -q "$SRC" lib && rm -rf "$SRC" && git -C lib branch dev
echo '{ "units": [{"root":".","kind":"app","setup":["node","--version"],"checks":{"test":["npm","test"]}},{"root":"lib","kind":"submodule","ownGit":true,"setup":["node","--version"],"checks":{"test":["npm","test"]}}] }' >.cadre/config.json
commit 'chore: lib as a submodule unit'; git branch -f dev main
echo '{"script":"sub"}' > .git/scripted.json
