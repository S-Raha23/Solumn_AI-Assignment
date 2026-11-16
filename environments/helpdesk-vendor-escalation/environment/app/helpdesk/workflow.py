"""Ticket lifecycle: notes and status changes."""
from __future__ import annotations

from .store import Store

TRANSITIONS = {
    "open": {"in_progress", "resolved"},
    "in_progress": {"open", "escalated", "resolved"},
    "escalated": {"in_progress", "resolved"},
    "resolved": set(),
}
NOTE_KINDS = ("work", "customer", "system")


class WorkflowError(Exception):
    """An action is not allowed for the ticket in its current state."""


def add_note(store: Store, ticket: dict, *, kind: str, author: str, body: str, at: str) -> dict:
    """Appends a note. `author` is a staff id, or "system"."""
    if kind not in NOTE_KINDS:
        raise WorkflowError(f"unknown note kind: {kind}")
    if not body.strip():
        raise WorkflowError("a note needs a body")
    if author != "system":
        store.staff(author)
    note = {"at": at, "kind": kind, "author": author, "body": body.strip()}
    ticket.setdefault("notes", []).append(note)
    return note


def change_status(store: Store, ticket: dict, new_status: str, *, by: str, at: str) -> None:
    """Moves a ticket to `new_status` and leaves a system note about it."""
    current = ticket["status"]
    if new_status not in TRANSITIONS.get(current, set()):
        raise WorkflowError(f"{ticket['id']} is {current}; it cannot become {new_status}")
    store.staff(by)
    ticket["status"] = new_status
    add_note(store, ticket, kind="system", author="system", body=f"Status {current} -> {new_status} by {by}", at=at)


def resolve(store: Store, ticket: dict, *, by: str, resolution: str, at: str) -> None:
    """Closes a ticket with the fix that worked."""
    if not resolution.strip():
        raise WorkflowError("a resolution is required to resolve a ticket")
    change_status(store, ticket, "resolved", by=by, at=at)
    ticket["resolution"] = resolution.strip()
    ticket["resolved_at"] = at
