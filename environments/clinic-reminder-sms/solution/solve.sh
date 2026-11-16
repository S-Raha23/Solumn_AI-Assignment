#!/bin/bash
# Safe reference: vars carry only the paths the clinic's template uses.
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && gofmt -l . && go vet ./... && go test ./...
