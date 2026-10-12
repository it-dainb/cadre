# user 1 (0.9.1 report): /clear first, main's shell moves into the package folder, then the goal; the goal is typed again while setup runs,
# and main is asked mid-setup to run the package's tests from kit/ (main ran `cd kit && npm …` during the init run)
clear_; shell_cd kit
goal "$GOAL"
until_log '^[0-9]+ answer .*set up' 120 && sleep 25 && goal "$GOAL" && sleep 5 && send "Also run this Bash command when you can: cd kit && npm test"
until_plan
