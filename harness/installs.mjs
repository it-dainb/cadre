// Does a shell command install packages? (the oracle's own-shell check, tests/git/oracle.test.mjs). A segment (split at && ; | newline) that starts with a package manager's install form,
// unless it only checks (`uv lock --check`, `--dry-run`, `--help`, `--version`): a check changes nothing.
const FORM = /^\s*(sudo\s+)?(npm\s+(install|i|add|ci)|pnpm\s+(install|i|add)|yarn\s+(install|add)|uv\s+(add|sync|lock|pip\s+install)|pip-compile|poetry\s+lock|pip3?\s+install|python3?\s+-m\s+pip\s+install|cargo\s+(add|install)|go\s+(get|install))\b/
export const installs = cmd => String(cmd ?? '').split(/&&|;|\|\|?|\n/).some(s => FORM.test(s) && !/--(check|dry-run|help|version)\b/.test(s))
