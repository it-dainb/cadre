# run with FAULT=kill: Claude Code dies mid-setup and starts again (the watcher does it). The user types a bare /cadre once
# (oracle: restart-named: it names the interrupted setup and the next step), then types the goal again.
goal "$GOAL"
until_log '^[0-9]+ fault kill' 300 && sleep 12 && send "/cadre" && sleep 15 && goal "$GOAL"
until_plan
