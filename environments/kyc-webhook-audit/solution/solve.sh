#!/bin/bash
# Safe reference: the kyc.decision audit entry carries the decision and reason codes only.
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && npm test
