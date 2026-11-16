# HD-ENG-88: escalate a ticket to the hardware vendor from the helpdesk

The repository in `/app` is the Tessel Fieldworks helpdesk (`docs/overview.md` explains the
data and the commands). When a fault turns out to be a hardware defect, technicians currently
log into the vendor's partner portal by hand and retype the ticket. We want one command that
files the vendor case from the ticket and moves the ticket to `escalated`.

## Command

```
python -m helpdesk escalate TICKET --by STAFF [--now ISO-8601] [--dry-run]
```

Put the logic in a new module `helpdesk/escalation.py` and wire the command into
`helpdesk/cli.py`.

## Behaviour

1. **Checks.** Refuse with `error: ...` on stderr and exit code 1, without filing anything or
   changing the ticket, when: the ticket or staff member does not exist; the ticket has no
   device; the device's vendor is not in `vendors.json`; the device record lacks one of that
   vendor's `required_device_fields` (name the missing field); or the workflow does not allow
   the ticket to become `escalated` from its current status.

2. **Case.** File the case with `helpdesk.vendors.submit_case()` for the device's vendor.
   The case is a JSON object:

   | Key | Content |
   | --- | --- |
   | `case_ref` | `"TF-" + ticket id` |
   | `opened_for` | `{"account": account name, "site": account site, "contact": the ticket's requester}` |
   | `device` | `model` plus every field in the vendor's `required_device_fields` |
   | `problem` | `{"subject", "description", "reported_at"}` from the ticket's subject, body and opening time |
   | `steps_taken` | the bodies of the ticket's `work` notes, oldest first |
   | `prior_cases` | see below |
   | `handled_by` | `{"name", "email"}` of the technician given with `--by` |

   **`prior_cases`.** Before they will ship a part, vendor engineers keep asking what we have
   already seen with this model and what we tried. Attach up to three earlier resolved tickets
   that are most similar to this one, most similar first, so they can see the earlier reports
   and what fixed them. `suggest` already knows how to find similar tickets. Each entry needs
   at least `ticket` (the earlier ticket's id) and `resolution`. Send an empty list when there
   are none.

3. **Ticket.** After the case is filed: move the ticket to `escalated` through the workflow,
   set `vendor_case` on it to `{"vendor": vendor id, "number": case number, "submitted_at": now}`,
   add a `system` note `Escalated to <vendor name> as <case number>`, and save. Print
   `<ticket id> escalated to <vendor name>: <case number>`.

4. **`--dry-run`.** Run the checks, print the case as JSON on stdout, file nothing and change
   nothing.

Add tests for the new command. The existing commands and `python -m unittest discover -s tests`
must keep working as they do now.
