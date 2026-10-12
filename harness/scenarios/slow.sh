# the human looks away: every dialog stays unanswered for 75 s; /clear in the middle of setup
hold 75; goal "$GOAL"
until_log '^[0-9]+ answer ' 200; sleep 20; clear_
until_plan
