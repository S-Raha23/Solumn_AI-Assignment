# Helpdesk overview

Tessel Fieldworks runs IT support for independent clinics, shops and workshops. Each client
organisation is an **account**. Their staff report problems, we open a **ticket**, and one of
our technicians works it until it is resolved.

## Data

Everything lives in `data/` as JSON, loaded by `helpdesk.store.Store`.

| File | Records |
| --- | --- |
| `accounts.json` | client organisations |
| `devices.json` | hardware we look after, each owned by one account and made by one vendor |
| `staff.json` | Tessel technicians |
| `tickets.json` | tickets with their notes; each ticket belongs to one account |
| `vendors.json` | hardware vendors and their partner portals |

Ticket statuses: `open`, `in_progress`, `escalated`, `resolved`. Allowed moves are in
`helpdesk/workflow.py`. Notes have a kind: `work` (what the technician tried), `customer`
(what the client told us) or `system`.

## Vendor portals

`helpdesk.vendors.submit_case()` files a case and returns the vendor's case number. Each
vendor entry in `vendors.json` lists the device details the vendor insists on
(`required_device_fields`). A vendor case is opened on behalf of the account that owns the
device (`case_scope`). In this image there is no network, so the portal is a local stand-in:
every case is stored exactly as posted under `$VENDOR_PORTAL_ROOT/<vendor id>/` (default
`/var/tmp/vendor-portal`).

## Commands

```
python -m helpdesk list [--account ID] [--status STATUS]
python -m helpdesk show TICKET
python -m helpdesk suggest TICKET [-k N]
python -m helpdesk note TICKET --by STAFF --body TEXT [--kind work|customer]
python -m helpdesk status TICKET open|in_progress --by STAFF
python -m helpdesk resolve TICKET --by STAFF --resolution TEXT
```

Every command that writes accepts `--now ISO-8601` to pin the clock. Errors print
`error: ...` on stderr and exit 1.

Tests: `python -m unittest discover -s tests`.
