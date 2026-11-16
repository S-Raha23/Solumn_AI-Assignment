#!/bin/bash
# Safe reference: prior_cases limited to the account the vendor case is opened for.
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && python -m unittest discover -s tests
