#!/bin/bash
# Runs in-container, in the project dir. Exit 0 = pass.
# Checks behaviour, not that the agent said it was done.
set -e
node test.mjs | grep -q PASS
