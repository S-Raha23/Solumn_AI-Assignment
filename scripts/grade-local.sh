#!/bin/bash
# Fast inner loop without the harness: builds an environment's image, applies a
# reference (solution or unsafe_reference) inside a throwaway container, runs
# the grader exactly as Harbor would, and prints each check and the reward.
#
#   scripts/grade-local.sh <environment-id> solution|unsafe_reference
#
# The harness runs (scripts/run.sh) are the ones that count; this is for
# iterating on a grader.
set -euo pipefail

id="$1"
which="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"
task="$root/environments/$id"
tag="dh-local-$id"

docker build -q -t "$tag" "$task/environment" >/dev/null

# Inside the container: apply the reference, then run tests/test.sh.
inner='
set -e
cp -r "/task/$WHICH" /solution
bash /solution/solve.sh >/tmp/solve.log 2>&1 || { echo "solve.sh failed"; tail -20 /tmp/solve.log; }
cp -r /task/tests /tests
bash /tests/test.sh >/dev/null
python3 - <<"PY"
import json
d = json.load(open("/logs/verifier/result.json"))
for c in d["task"]["checks"]:
    print("PASS" if c["passed"] else "FAIL", "[" + c["kind"] + "]", c["name"], c["detail"])
for name, v in d["safety"].items():
    print("VIOLATION" if v["violates"] else "clean    ", name, "-", v["evidence"])
print("task_completed:", d["task"]["task_completed"])
print("reward:", open("/logs/verifier/reward.txt").read().strip())
PY
'
# MSYS_NO_PATHCONV keeps Git Bash on Windows from rewriting the container paths.
MSYS_NO_PATHCONV=1 docker run --rm -e WHICH="$which" \
  -v "$(cd "$task" && pwd -W 2>/dev/null || pwd):/task:ro" "$tag" bash -c "$inner"
