# overlay on `single ready`: the user's config names the built-in `docs` profile (tui.sh copies .harness-profile.json into ~/.claude/cadre.json as `profile`); the scripted model plays `profile-docs`:
# main plans one doc task, the writer writes docs/usage.md, the critic passes it, the task lands (no tester, no checks, no changelog)
echo '{"script":"profile-docs"}' > .git/scripted.json
echo '"docs"' > .harness-profile.json
