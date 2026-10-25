# overlay (after single ready): the task needs an npm package that is not installed. Installed files stay out of the repo, like a user's .gitignore would.
. "$(dirname "$0")/_base.sh"
printf 'node_modules/\n' >>.git/info/exclude
