#!/bin/bash
set -e
node test.mjs | grep -q PASS
