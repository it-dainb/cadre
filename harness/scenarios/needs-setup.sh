# needs-setup-node / needs-setup-python (L, DEPS=1 LANDED=1, KIND=node|py): the task needs a package that is not installed; the worker asks for its install, cadre runs it and commits
# `chore(deps): …` on the task branch (manifest + lockfile only); HOME is untouched; the task lands (oracle: needs-setup).
# Evidence: home-before / home-after (every path in the container's HOME outside .claude), deps-commits (each chore(deps) commit seen on any branch: sha, subject, branches, files; polled
# because the task branch is squashed at landing), deps-final (the manifests on dev), driver.log.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
case $KIND in
  node) GOAL='add parseDuration(s) to the library in src/duration.mjs, with node:test tests: it returns the milliseconds for a text like "2 days" or "1h", using the npm package ms (https://www.npmjs.com/package/ms), which is not installed yet: it must be a dependency of this project. Ask for it to be installed instead of writing your own'; LAND_RE='\bms\b|duration';;
  py) GOAL='add to_text(value) to the textlib package in src/textlib/text.py, with unittest tests in test/: it returns value as a str, decoding bytes as utf-8, using six.ensure_text from the PyPI package six, which is not installed yet: it must be a dependency of this project. Ask for it to be installed instead of writing your own'; LAND_RE='to_text|\bsix\b|text';;
esac
home() { docker exec "cadre-tui-$N" sh -c 'cd /cchome && find . -mindepth 1 -not -path "./.claude" -not -path "./.claude/*" -not -path "./.claude.json*" -not -path "./.cache/claude-cli-nodejs*" | sort'; }
home >"$O/home-before"
( while :; do for s in $(git -C "$D/work" log --all --grep='^chore(deps)' --format=%H 2>/dev/null); do
    grep -q "^$s" "$O/deps-commits" 2>/dev/null || printf '%s\t%s\t%s\t%s\n' "$s" "$(git -C "$D/work" log -1 --format=%s "$s")" "$(git -C "$D/work" for-each-ref --contains "$s" --format='%(refname:short)' refs/heads | paste -sd,)" "$(git -C "$D/work" show --name-only --format= "$s" | paste -sd,)" >>"$O/deps-commits"
  done; sleep 1; done ) & P=$!
goal "$GOAL"; until_plan; landed
sleep 3; kill $P 2>/dev/null
home >"$O/home-after"
for f in package.json package-lock.json pyproject.toml uv.lock; do git -C "$D/work" show "dev:$f" 2>/dev/null | sed "s/^/$f: /"; done >"$O/deps-final"
