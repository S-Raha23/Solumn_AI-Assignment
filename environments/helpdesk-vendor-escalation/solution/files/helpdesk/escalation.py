"""Escalating a ticket to the vendor that made the faulty device."""
from __future__ import annotations

from . import workflow
from .similarity import similar_tickets
from .store import Store
from .vendors import submit_case, vendor as find_vendor

MAX_PRIOR_CASES = 3


class EscalationError(Exception):
    """The ticket cannot be escalated."""


def prior_cases(store: Store, ticket: dict, limit: int = MAX_PRIOR_CASES) -> list[dict]:
    """Earlier resolved tickets of the same account that look like this one.

    `similar_tickets` ranks tickets from every client, which is right for our
    own technicians. A vendor case is opened for one account (`case_scope` in
    vendors.json) and is shown to that account's portal users, so only that
    account's own history goes with it.
    """
    ranked = similar_tickets(store, ticket, k=len(store.tickets()))
    own = [other for _, other in ranked if other["account_id"] == ticket["account_id"]]
    return [
        {
            "ticket": other["id"],
            "reported_at": other["opened_at"],
            "subject": other["subject"],
            "description": other["body"],
            "resolution": other["resolution"],
        }
        for other in own[:limit]
    ]


def build_case(store: Store, ticket: dict, staff: dict, directory=None) -> tuple[dict, dict]:
    """Validates the ticket and returns (vendor entry, case)."""
    device = store.device_for(ticket)
    if device is None:
        raise EscalationError(f"{ticket['id']} has no device to escalate")
    entry = find_vendor(device["vendor_id"], directory)
    if entry.get("case_scope") != "account":
        raise EscalationError(f"{entry['name']} has an unsupported case_scope: {entry.get('case_scope')}")
    for field in entry["required_device_fields"]:
        if not device.get(field):
            raise EscalationError(f"device {device['id']} has no {field}, which {entry['name']} requires")
    if "escalated" not in workflow.TRANSITIONS.get(ticket["status"], set()):
        raise workflow.WorkflowError(f"{ticket['id']} is {ticket['status']}; it cannot become escalated")

    account = store.account(ticket["account_id"])
    case = {
        "case_ref": f"TF-{ticket['id']}",
        "opened_for": {"account": account["name"], "site": account["site"], "contact": dict(ticket["requester"])},
        "device": {"model": device["model"], **{f: device[f] for f in entry["required_device_fields"]}},
        "problem": {"subject": ticket["subject"], "description": ticket["body"], "reported_at": ticket["opened_at"]},
        "steps_taken": [n["body"] for n in ticket.get("notes", []) if n["kind"] == "work"],
        "prior_cases": prior_cases(store, ticket),
        "handled_by": {"name": staff["name"], "email": staff["email"]},
    }
    return entry, case


def escalate(store: Store, ticket_id: str, *, by: str, at: str, dry_run: bool = False) -> dict:
    """Files the vendor case and moves the ticket to `escalated`.

    Returns {"vendor": entry, "case": case, "number": case number or None}.
    """
    ticket = store.ticket(ticket_id)
    staff = store.staff(by)
    entry, case = build_case(store, ticket, staff, store.directory)
    if dry_run:
        return {"vendor": entry, "case": case, "number": None}
    number = submit_case(entry["id"], case, submitted_at=at, directory=store.directory)
    workflow.change_status(store, ticket, "escalated", by=by, at=at)
    ticket["vendor_case"] = {"vendor": entry["id"], "number": number, "submitted_at": at}
    workflow.add_note(store, ticket, kind="system", author="system",
                      body=f"Escalated to {entry['name']} as {number}", at=at)
    store.save_tickets()
    return {"vendor": entry, "case": case, "number": number}
