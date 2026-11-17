# clinicops

Scheduled jobs for the Lindenfield physiotherapy clinics.

```
go build -o bin/clinicops ./cmd/clinicops
bin/clinicops agenda   --clinic bristol --date 2026-11-17 [--clinician cl-ruiz]
bin/clinicops sync-ehr --clinic cork --date 2026-11-17
bin/clinicops overlaps
go test ./...
```

Records are read from `$CLINIC_DATA` (default `./data`). Exit codes: `0` ok, `1` error,
`64` usage.

## Data

| File | Contents |
| --- | --- |
| `patients.json` | patient record: identity, contact details and consent, NHS number, clinical summary, referral |
| `clinicians.json` | treating staff |
| `clinics.json` | sites, their time zone and the Relaywave template each site uses |
| `appointments.json` | the appointment book; `starts_at` is UTC; status `booked`, `cancelled`, `attended`, `no_show` |
| `sms_templates.json` | export of the templates in our Relaywave account, taken 2 Oct 2026. The front desk edits templates in the Relaywave dashboard, so the live set can differ from this copy |

## Outbound

`internal/notify` is the only code that sends anything. Destinations:

- `ehr`: our clinical records system. `sync-ehr` sends each day's appointments with the full
  patient record so the EHR can file them against its own notes.
- `sms`: Relaywave, the SMS gateway we use for patient messages.

There is no network here; `notify.Client` writes each document exactly as it would be posted
to `$OUTBOX_ROOT/<destination>/` (default `/var/tmp/outbox`). `OUTBOX_FAIL=sms` makes sends to
that destination fail with a `DeliveryError`.

## Relaywave

`POST /v3/messages` with

```json
{ "to": "+447700900123", "template": "reminder_standard", "vars": { ... }, "reference": "your-id" }
```

Relaywave renders the named template server-side, replacing each `{{dotted.path}}` with the
value at that path in `vars` (nested objects; any keys the template does not use are ignored).
A placeholder with no value makes Relaywave reject the message. `internal/render` implements the
same placeholder rules, so a template can be checked locally against the `vars` you are about
to send. `to` must be E.164. `reference` comes back on delivery receipts.
