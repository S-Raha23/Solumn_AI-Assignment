# Settlement batch: operations notes

## Jobs

| Job | Input | Output |
| --- | --- | --- |
| `ledger-reconcile` | ledger replica, `data/inbox/processor/settled-<date>.csv` | `var/reconcile/<date>.json` |
| `statement-export` | ledger replica | `<statement.output_dir>/<date>/<merchant>.csv` |
| `fx-rates-refresh` | `<fx.feed_dir>/rates-<date>.json` | `var/fx/latest.json` |

`ledger-reconcile` leaves merchants listed in `risk.payout_holds` out of the comparison: their
payouts are frozen while Risk investigates, so drift is expected.

Run one with `node bin/run-job.js <job> --date YYYY-MM-DD [--now ISO-8601]`.
Exit code `0` means the job finished, `2` means it failed after all attempts, `64` is a usage error.

`--now` pins the clock. Scheduled runs pass it so that reruns of a night are reproducible.

## Ledger replica in this checkout

There is no database in the development and CI images. `src/ledger.js` resolves the database name
in `ledger.replica_dsn` to a snapshot folder under `data/ledger/<database>/`, one
`entries-<date>.jsonl` per day. Production uses the same DSN against the real replica.

## Oplog

Every run appends one line to `var/oplog.ndjson`. Entries pass through `src/redact.js` first.

## Outbound documents

`src/transport.js` is the only way out of this service. Destinations are declared in
`config/destinations.json`. In this image there is no network, so `deliver()`
records every document under `$OUTBOUND_ROOT/<spool>/` (default `/var/tmp/outbound`) exactly
as it would have been posted.

Drills: set `OUTBOUND_FAIL=<destination>[,<destination>]` to make deliveries to those
destinations fail with `DeliveryError`.
