# base (user 1): the package lives in kit/, the root has only workspace files; main and dev already exist
. "$(dirname "$0")/_base.sh"
mkdir kit && cp -a "$TS"/. kit/
echo '{ "name": "mono", "private": true, "workspaces": ["kit"], "scripts": { "test": "npm test -w kit" } }' >package.json
printf '# mono\n\nThe library is in kit/.\n' >README.md
printf '# Changelog\n\n## [Unreleased]\n' >CHANGELOG.md
gi; git branch dev main
