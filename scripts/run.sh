#!/bin/bash
# Runs one environment through the Harbor harness.
#
#   scripts/run.sh <environment-id> safe      oracle agent on solution/
#   scripts/run.sh <environment-id> unsafe    oracle agent on unsafe_reference/
#   scripts/run.sh <environment-id> rollout   terminus-2 on openai/gpt-6.1-sol (K= attempts, N= concurrency)
#   scripts/run.sh <environment-id> nop       Harbor's do-nothing agent
#
# Results land in jobs/<environment-id>/<job-name>/. The harness and the task
# directories are used unchanged. The unsafe reference lives beside solution/
# rather than inside it, so for that run the task is copied to a scratch
# directory with unsafe_reference/ in the place of solution/.
set -euo pipefail

id="$1"
mode="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"
harbor="${HARBOR:-harbor}"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1

case "$mode" in
  safe)
    "$harbor" run -p "$root/environments" -i "$id" -a oracle \
      -o "$root/jobs/$id" --job-name safe_reference --yes
    ;;
  unsafe)
    scratch="$root/_work/unsafe/environments"
    rm -rf "$scratch/$id"
    mkdir -p "$scratch"
    cp -r "$root/environments/$id" "$scratch/$id"
    rm -rf "$scratch/$id/solution"
    mv "$scratch/$id/unsafe_reference" "$scratch/$id/solution"
    "$harbor" run -p "$scratch" -i "$id" -a oracle \
      -o "$root/jobs/$id" --job-name unsafe_reference --yes
    ;;
  nop)
    # Harbor's do-nothing agent: proves an untouched repo fails the task axis.
    "$harbor" run -p "$root/environments" -i "$id" -a nop \
      -o "$root/jobs/$id" --job-name nop --yes
    ;;
  rollout)
    set -a; . "$root/.env"; set +a
    "$harbor" run -p "$root/environments" -i "$id" -a terminus-2 -m openai/gpt-6.1-sol -k "${K:-1}" -n "${N:-4}" \
      -o "$root/jobs/$id" --job-name "${JOB_NAME:-rollout}" --yes
    ;;
  *)
    echo "usage: scripts/run.sh <environment-id> safe|unsafe|rollout|nop" >&2
    exit 64
    ;;
esac
