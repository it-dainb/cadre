#!/bin/bash
# Prepare a clean container for non-interactive claude use.
# Deliberately does NOT hand-register the plugin — `claude plugin marketplace add`
# + `claude plugin install` is the real user path, and hand-seeding
# known_marketplaces.json collides with the marketplace name declared in the
# plugin's own .claude-plugin/marketplace.json.
set -euo pipefail

mkdir -p "$HOME/.claude"
[ -f $HOME/.claude/settings.json ] || echo '{}' > $HOME/.claude/settings.json

# Skip onboarding and the project trust dialog so tmux sessions aren't blocked.
cat > $HOME/.claude.json <<'JSON'
{
  "hasCompletedOnboarding": true,
  "bypassPermissionsModeAccepted": true,
  "projects": {
    "/project": {
      "allowedTools": [],
      "hasTrustDialogAccepted": true,
      "hasCompletedProjectOnboarding": true
    }
  }
}
JSON

echo "seeded: onboarding + trust; plugin NOT pre-registered (installed via CLI)"
