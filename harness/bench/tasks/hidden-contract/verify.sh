#!/bin/bash
set -e
node spec/user.test.mjs | grep -q PASS
