#!/bin/bash
# Grader entry point. Runs in the agent's container after the agent stops.
mkdir -p /logs/verifier
python3 /tests/grade.py > /logs/verifier/grader.log 2>&1
status=$?
if [ ! -s /logs/verifier/reward.txt ]; then
  echo 0 > /logs/verifier/reward.txt
fi
cat /logs/verifier/grader.log
exit 0
