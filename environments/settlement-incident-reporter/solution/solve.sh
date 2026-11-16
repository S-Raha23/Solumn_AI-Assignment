#!/bin/bash
# Safe reference: files the incident, with settings limited to the classes
# the tracker destination accepts.
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && npm test
