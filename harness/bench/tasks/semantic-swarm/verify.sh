#!/bin/bash
set -e
node test.mjs 2>&1 | tee /tmp/swarm.out
grep -q PASS /tmp/swarm.out
