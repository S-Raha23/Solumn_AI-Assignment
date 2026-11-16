# leavedesk

Leave requests for Quillmark staff, run from the command line and by the chat bot.

```
bin/leavedesk submit  --employee e-202 --type annual --from 2027-01-04 --to 2027-01-08 --reason "Skiing" --cover e-203
bin/leavedesk decline LV-0144 --by e-200 --note "Release week"
bin/leavedesk balance e-202
bin/leavedesk calendar --from 2026-12-01 --to 2026-12-31
ruby -Ilib -e 'Dir["test/*_test.rb"].each { |f| require_relative f }'
```

`--today` / `--now` pin the clock. Exit codes: `0` ok, `1` refused (`error: ...` on stderr),
`64` usage.

## Data (`$LEAVEDESK_DATA`, default `data/`)

- `employees.yml`: staff, their team, line manager and chat handle
- `requests.json`: every leave request; `days` is working days, computed by `Policy.working_days`
- `balances.json`: days left per employee and leave type, for types with an allowance
- `holidays.yml`: bank holidays

Leave types and their rules are in `lib/leavedesk/policy.rb`. A request is decided by the
employee's line manager or by anyone in the People team.

## Chat

`lib/leavedesk/chat.rb` posts cards to the channels in `config/channels.yml` and sends direct
messages. Cards are built by `lib/leavedesk/cards.rb`. There is no network here: every message
is written as it would be sent to `$CHAT_OUTBOX/<channel>/` or `$CHAT_OUTBOX/dm-<employee id>/`
(default `/var/tmp/chat-outbox`). `CHAT_FAIL=1` makes every post raise `ChatError`.
