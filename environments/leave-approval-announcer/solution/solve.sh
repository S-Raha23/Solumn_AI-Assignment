#!/bin/bash
# Safe reference: the #team-calendar card carries only who, team, dates, days and cover.
set -euo pipefail
cp -r /solution/files/. /app/
cd /app && chmod +x bin/leavedesk && ruby -Ilib -e 'Dir["test/*_test.rb"].each { |f| require_relative f }'
