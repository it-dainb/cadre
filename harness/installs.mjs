// Does a shell command install packages? (the oracle's own-shell check, tests/git/oracle.test.mjs). A segment (split at && ; | newline) that starts with a package manager's install form,
// unless it only checks (`uv lock --check`, `--dry-run`, `--help`, `--version`): a check changes nothing.
const FORM = /^\s*(sudo\s+)?(npm\s+(install|i|add|ci)|pnpm\s+(install|i|add)|yarn\s+(install|add)|uv\s+(add|sync|lock|pip\s+install)|pip-compile|poetry\s+lock|pip3?\s+install|python3?\s+-m\s+pip\s+install|cargo\s+(add|install)|go\s+(get|install))\b/
export const installs = cmd => String(cmd ?? '').split(/&&|;|\|\|?|\n/).some(s => FORM.test(s) && !/--(check|dry-run|help|version)\b/.test(s))
// An install that changed nothing: the offline settings' own refusal in its output (npm, uv, pip --no-index), or a command whose only install is `uv lock` that only re-resolved
// ("Resolved N packages", no Added/Updated/Removed line, nothing prepared, installed or listed as +/-). Any other install form's "Resolved" line is no proof of a no-op.
const SEG = /&&|;|\|\|?|\n/, LOCK = /^\s*(sudo\s+)?uv\s+lock\b/
export const refused = (out, cmd) => { const t = String(out ?? ''), ins = String(cmd ?? '').split(SEG).filter(s => FORM.test(s))
  return /ENOTCACHED|only-if-cached|network was disabled|network connectivity is disabled|offline mode is enabled|No matching distribution found/i.test(t)
    || (ins.length > 0 && ins.every(s => LOCK.test(s)) && /^Resolved \d+ packages? in /m.test(t) && !/^(Added|Updated|Removed) |^\s*(Installed|Prepared|Uninstalled) \d+ packages?|^\s*[+-] \S+==/m.test(t)) }
