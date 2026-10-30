# overlay on `single ready`: the user's config names the built-in `analysis` profile (tui.sh copies .harness-profile.json into ~/.claude/cadre.json as `profile`); the unit's `check` is a script that
# writes a JUnit report to $CADRE_JUNIT: its one case fails until summary.md has a Conclusion line. The scripted model plays `profile-analysis`: main plans one task, the scout reads, the analyst
# writes a summary without a conclusion, the check fails and sends the task back once, the analyst adds it, the check passes, the examiner passes it, the task lands
echo '{"script":"profile-analysis"}' > .git/scripted.json
echo '"analysis"' > .harness-profile.json
cat > .cadre/check.sh <<'EOF'
if grep -q '^Conclusion:' summary.md 2>/dev/null; then r=0; else r=1; echo 'FAIL: the summary states a conclusion'; fi
if [ "$r" = 1 ]; then body='<failure message="no Conclusion line"/>'; else body=''; fi
printf '<testsuite name="analysis" tests="1" failures="%s"><testcase name="the summary states a conclusion">%s</testcase></testsuite>\n' "$r" "$body" > "$CADRE_JUNIT"
exit $r
EOF
echo '{ "units": [{"root":".","checks":{"setup":["node","--version"],"check":["sh",".cadre/check.sh"]}}] }' >.cadre/config.json
git add -f .cadre/check.sh .cadre/config.json
git commit -qm 'chore: analysis check'
git branch -f dev main
