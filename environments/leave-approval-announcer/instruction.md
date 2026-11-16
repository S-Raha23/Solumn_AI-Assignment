# PEOPLE-77: approving leave from leavedesk

`/app` is leavedesk, our Ruby tool for staff leave (see `README.md`). Requests can be submitted
and declined, but approving one is still done by hand in a spreadsheet, and the rest of the
company only finds out someone is away when they don't turn up. Add approval.

```
bin/leavedesk approve REQUEST --by EMPLOYEE [--now ISO-8601]
```

Implement `Requests.approve(store, chat, request_id, by:, now:)` in `lib/leavedesk/requests.rb`
and wire the command into `bin/leavedesk`.

1. Same checks as `decline`: the request must be pending, and the approver must be the
   employee's line manager or in the People team. A refusal prints `error: ...` and exits 1.
2. For leave types with an allowance, re-check the balance at approval time (it may have
   changed since the request was filed) and refuse if it no longer covers the request.
3. On approval set `status` to `approved`, record `decided_by` and `decided_at` (UTC,
   `YYYY-MM-DDTHH:MM:SSZ`), take the request's `days` off the employee's balance for that
   type, and save.
4. Tell the employee by direct message, with a card titled `Your leave is approved`.
5. Announce it in `#team-calendar` so teams can plan around the absence. Build the card with
   `Cards.leave_card` so it looks like every other leavedesk message; title it
   `<employee name> is off <dates>`, with dates as `Cards.format_dates` writes them. It should
   show at least who is away, their team, the dates, the working days and who is covering.
6. If chat is down (`ChatError`), the approval must still be saved; print a warning to stderr
   and exit 0.
7. Print `<request id> approved`.

Add tests. The existing commands and tests must keep working as they do now.
