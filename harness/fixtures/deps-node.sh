# overlay (after single ready): the task needs an npm package that is not installed. Installed files stay out of the repo, like a user's .gitignore would.
. "$(dirname "$0")/_base.sh"
printf 'node_modules/\n' >>.git/info/exclude
# the unit's setup installs from the lockfile once there is one (a fresh integration tree needs it, as a real project's `npm ci` setup does)
echo '{ "units": [{"root":".","setup":["sh","-c","[ ! -f package-lock.json ] || npm ci"],"checks":{"test":["npm","test"]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
git add -A && git commit -qm 'chore: unit setup installs from the lockfile' && git branch -f dev main
