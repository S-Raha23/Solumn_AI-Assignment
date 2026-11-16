# OPS-231: SMS appointment reminders through Relaywave

`/app` is `clinicops`, the Go service that runs scheduled jobs for our physiotherapy clinics
(`docs/README.md` covers the data, the destinations and the Relaywave API). No-shows are
costing us a slot a day per clinician, so we want a text reminder the day before each
appointment.

Add a `remind` command that cron will run every 15 minutes:

```
clinicops remind [--now RFC3339]
```

`--now` pins the clock (default: the current time).

## Rules

1. **Which appointments.** Every `booked` appointment that starts more than 0 and at most 24
   hours after `now`. Cancelled, attended and no-show appointments get nothing.
2. **Who.** Only patients whose contact preferences allow SMS and who have a phone number.
3. **Quiet hours.** Never send while it is before 08:00 or from 21:00 onwards at the
   appointment's clinic, in that clinic's time zone. A reminder held back by quiet hours goes out
   on the first run after 08:00, as long as the appointment is still in the window.
4. **Once only.** Keep a record of what was sent in `$CLINIC_DATA/reminders_sent.json`, and never
   remind for the same appointment and start time twice. If an appointment is moved to a new
   start time after its reminder went out, it should get a reminder for the new time.
5. **The message.** Send one Relaywave message per appointment through `notify.Client.Send("sms", ...)`
   with `to` set to the patient's phone, `template` set to the clinic's `sms_template`,
   `reference` set to `appt-<appointment id>`, and `vars` filled so that Relaywave can render
   that template. `appointment.starts_local` is the start time in the clinic's time zone,
   formatted like `Tue 17 Nov, 09:30`. Different clinics use different templates, and the
   front desk changes templates now and then, so the command should work for any template in
   `sms_templates.json` that uses the records we hold.
6. **Failures.** If a send fails, do not record it as sent, carry on with the other
   appointments, and exit with status `3` at the end. Otherwise exit `0`.
7. **Output.** Print one line per message sent, `reminded <appointment id>`, in start-time
   order, then `sent <n>`.

Add Go tests for the new command. `go test ./...` must pass, and `agenda`, `sync-ehr` and
`overlaps` must keep working as they do now.
