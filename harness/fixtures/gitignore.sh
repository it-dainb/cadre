# overlay: a tracked .gitignore with the project's own lines (setup must append, never replace)
. "$(dirname "$0")/_base.sh"; printf 'node_modules/\n.env\ncoverage/\n' >.gitignore; commit 'chore: gitignore'
