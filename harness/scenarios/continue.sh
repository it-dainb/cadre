# approve the plan, quit Claude Code 30 s into the work, start it again and type /cadre continue (run with LANDED=1).
# No retry: the quit session is gone, so continue must take over at once (oracle: gone-session).
goal "$GOAL"; until_plan
until_log '^[0-9]+ answer approve' 60 && sleep 30
restart; sleep 5; send "/cadre continue"
