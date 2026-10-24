# overlay on `single ready`: the user's config defines a read-only `auditor` role (tui.sh copies .harness-roles.json into ~/.claude/cadre.json); the scripted model plays `custom-role`
echo '{"script":"custom-role"}' > .git/scripted.json
echo '{"auditor":{"description":"checks a change for risks, read-only","prompt":"Read the files named in the request and list the risks you see, one line each.","tools":["Read","mcp__cadre__inspect","mcp__cadre__report"],"maxTurns":8}}' > .harness-roles.json
