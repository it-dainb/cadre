# custom-role (S, `single ready`, the `custom-role` script): the user's read-only auditor role is registered at start; main spawns it on its first turn; it answers (oracle: custom-role)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
send "S0-AUDIT"; until_debug 'SCRIPTED step agent=main who=main index=[1-9].*text end_turn' 50; sleep 3
