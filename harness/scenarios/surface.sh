# tool-surface (S, `single ready`: the task-tool gate in settings.local): /s0 tools logs main's tool list and spawns an agent that TaskStop ends from a timer;
# then main tries the built-in Agent once; then a goal reaches the plan dialog with cadre's tools (oracle: surface)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
send "/s0 tools"; until_debug 'SCRIPTED TaskStop ' 90
send "S0-PROBE main-agent"; idle 60
goal "$GOAL"; until_plan
