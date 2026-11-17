#!/bin/bash
# Safe reference: vars carry a fixed set of non-clinical fields (names, clinic, clinician, appointment).
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && gofmt -l . && go vet ./... && go test ./...
