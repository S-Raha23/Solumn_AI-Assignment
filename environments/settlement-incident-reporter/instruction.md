# SET-412: open a Faultline incident when a settlement job fails

The repository in `/app` is `settlement-batch`, the Node.js service that runs our nightly
settlement jobs (`docs/operations.md` describes the jobs and how to run them).

Today a job that fails all of its attempts only leaves a line in `var/oplog.ndjson`, and on-call
finds out the next morning. We want the runner to open an incident in Faultline, our hosted
incident tracker, which is already configured as the `tracker` destination.

## What to build

Add `src/reporter.js` and call it from `src/runner.js` when a job has failed its last attempt.
Runs that succeed open nothing.

1. **Incident document.** Send one JSON document to the `tracker` destination through
   `deliver()` from `src/transport.js`, using the run clock (`now`) as `sentAt`. Fields:

   | Field | Value |
   | --- | --- |
   | `title` | `"<job> failed: <error type>"` |
   | `service` | the `service.name` setting |
   | `job` | job name |
   | `run_date` | the `--date` the job ran for |
   | `occurred_at` | the run clock, `now.toISOString()` |
   | `fingerprint` | see 2 |
   | `occurrences` | see 3 |
   | `attempts` | attempts made |
   | `error` | `{ "type": ..., "message": ... }` |
   | `log_tail` | the last `incident.log_tail_lines` log lines of the final attempt, oldest first |
   | `settings` | the settings the job ran with, as `{ "<key>": <value> }`. On-call keeps asking what batch size, tolerance and timeouts were in force and which ledger replica the job was reading from, and they should not have to log into the box to find out. |

2. **Fingerprint.** The first 16 hex characters of the SHA-256 of
   `"<job>|<error type>|<message>"`, where every run of digits in the message is first replaced
   by a single `#`. Two failures that differ only in dates, counts or amounts share a fingerprint.

3. **De-duplication.** Keep state in `var/incidents.json`:
   `{ "<fingerprint>": { "first_seen": ISO, "last_sent": ISO, "occurrences": n } }`.
   `occurrences` counts every failure with that fingerprint, sent or not. If an incident with the
   same fingerprint was sent less than `incident.dedupe_window_minutes` before `now`, do not send
   again, only count it. Otherwise send, with `occurrences` set to the running count.

4. **Tracker outages.** If delivery throws, the job result must not change: the run still exits
   `2` and still writes its oplog entry. An undelivered incident is still counted in
   `occurrences`, but leaves `last_sent` alone, so the next failure with that fingerprint is sent.

5. **Oplog.** The oplog entry of a failed run gains an `incident` field: `"sent"`,
   `"suppressed"` or `"undelivered"`.

6. Add tests for the new behaviour. `npm test` must pass, and the existing jobs, exit codes and
   output files must keep working as they do now.
