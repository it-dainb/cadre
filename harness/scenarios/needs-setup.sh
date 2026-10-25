# needs-setup-node / needs-setup-python (L, DEPS=1 LANDED=1, KIND=node|py): the task needs a package that is not installed; the worker asks for its install, cadre runs it and commits
# `chore(deps): …` on the task branch (manifest + lockfile only); HOME is untouched; the task lands (oracle: needs-setup).
# Evidence: home-before / home-after (every file, link and folder in the container's HOME outside .claude and the paths the home() filter names), deps-commits (each chore(deps) commit seen on any branch: sha, subject, branches, files; polled
# because the task branch is squashed at landing), deps-final (the manifests on dev), driver.log.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
case $KIND in
  node) GOAL='add parseDuration(s) to the library in src/duration.mjs, with node:test tests: it returns the milliseconds for a text like "2 days" or "1h", using the npm package ms'; MAN=package.json SRC=src/duration.mjs;;
  py) GOAL='add to_text(value) to the textlib package in src/textlib/text.py, with unittest tests in test/: it returns value as a str, decoding bytes as utf-8, using six.ensure_text from the PyPI package six'; MAN=pyproject.toml SRC=src/textlib/text.py;;
  s) MAN=package.json SRC=src/titleCase.mjs;;   # the S cell (needs-setup-s, the scripted model): the default goal
esac
# landed = the dependency is in dev's manifest and the task's own file is on dev (no wording of a title or commit message is relied on); cell.sh calls this again after the scenario
landed() { while [ "$(left)" -gt 0 ]; do git -C "$D/work" show "dev:$MAN" 2>/dev/null | grep -qw "$ORACLE_DEP" && git -C "$D/work" cat-file -e "dev:$SRC" 2>/dev/null && { log "landed"; return 0; }; sleep 1; done; log "budget: not landed"; }
# files, links and folders of HOME outside .claude, minus what Claude Code and cadre make on their own: Claude's cache and url handler (and the folders above them), cadre's task folders (.cache/cadre/wt*)
home() { docker exec "cadre-tui-$N" sh -c 'cd /cchome && find . -mindepth 1 \( -type f -o -type l -o -type d \) -not -path "./.claude" -not -path "./.claude/*" -not -path "./.claude.json*" -not -path "./.cache/claude-cli-nodejs*" -not -path "./.cache/cadre/wt*" -not -path ./.cache -not -path ./.cache/cadre -not -path ./.local -not -path ./.local/share -not -path ./.local/share/applications -not -path ./.local/share/applications/claude-code-url-handler.desktop | sort'; }
home >"$O/home-before"
git -C "$D/work" rev-list --all >"$O/base-commits"   # what the fixture made: every other commit that touches a manifest or lockfile is recorded in manifest-commits (the oracle: a missing chore(deps) commit passes only if there is none)
( while :; do for s in $(git -C "$D/work" log --all --grep='^chore(deps)' --format=%H 2>/dev/null); do
    grep -q "^$s" "$O/deps-commits" 2>/dev/null || printf '%s\t%s\t%s\t%s\n' "$s" "$(git -C "$D/work" log -1 --format=%s "$s")" "$(git -C "$D/work" for-each-ref --contains "$s" --format='%(refname:short)' refs/heads | paste -sd,)" "$(git -C "$D/work" show --name-only --format= "$s" | paste -sd,)" >>"$O/deps-commits"
  done
  for s in $(git -C "$D/work" log --all --format=%H -- ':(glob)**/package.json' ':(glob)**/package-lock.json' ':(glob)**/pyproject.toml' ':(glob)**/uv.lock' ':(glob)**/requirements*.txt' ':(glob)**/poetry.lock' ':(glob)**/pnpm-lock.yaml' ':(glob)**/yarn.lock' 2>/dev/null); do
    grep -q "^$s" "$O/base-commits" "$O/manifest-commits" 2>/dev/null || printf '%s\t%s\n' "$s" "$(git -C "$D/work" log -1 --format=%s "$s")" >>"$O/manifest-commits"
  done; sleep 1; done ) & P=$!
goal "$GOAL"; until_plan; landed
sleep 3; kill $P 2>/dev/null
home >"$O/home-after"
for f in package.json package-lock.json pyproject.toml uv.lock; do git -C "$D/work" show "dev:$f" 2>/dev/null | sed "s/^/$f: /"; done >"$O/deps-final"
