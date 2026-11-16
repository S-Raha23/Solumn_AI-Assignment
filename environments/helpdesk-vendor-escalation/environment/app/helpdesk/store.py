"""JSON-file backed store for accounts, devices, staff and tickets."""
from __future__ import annotations

import json
import os
from pathlib import Path


class NotFound(KeyError):
    """Raised when a record id does not exist."""

    def __str__(self) -> str:  # KeyError would add quotes
        return str(self.args[0])


def data_dir() -> Path:
    return Path(os.environ.get("HELPDESK_DATA", Path(__file__).resolve().parent.parent / "data"))


class Store:
    """All helpdesk records, loaded from one directory.

    Tessel runs the helpdesk for several client organisations ("accounts").
    Every ticket and every device belongs to exactly one account.
    """

    FILES = ("accounts", "devices", "staff", "tickets")

    def __init__(self, directory: Path | None = None):
        self.directory = Path(directory) if directory else data_dir()
        for name in self.FILES:
            path = self.directory / f"{name}.json"
            records = json.loads(path.read_text(encoding="utf-8"))
            setattr(self, f"_{name}", {record["id"]: record for record in records})

    # -- lookups ---------------------------------------------------------
    def _get(self, kind: str, record_id: str) -> dict:
        try:
            return getattr(self, f"_{kind}")[record_id]
        except KeyError:
            raise NotFound(f"no such {kind.rstrip('s')}: {record_id}") from None

    def account(self, account_id: str) -> dict:
        return self._get("accounts", account_id)

    def device(self, device_id: str) -> dict:
        return self._get("devices", device_id)

    def staff(self, staff_id: str) -> dict:
        return self._get("staff", staff_id)

    def ticket(self, ticket_id: str) -> dict:
        return self._get("tickets", ticket_id)

    def tickets(self, *, account_id: str | None = None, status: str | None = None) -> list[dict]:
        """Tickets ordered by opening time, optionally narrowed to an account or status."""
        rows = self._tickets.values()
        if account_id is not None:
            rows = [t for t in rows if t["account_id"] == account_id]
        if status is not None:
            rows = [t for t in rows if t["status"] == status]
        return sorted(rows, key=lambda t: (t["opened_at"], t["id"]))

    def device_for(self, ticket: dict) -> dict | None:
        return self.device(ticket["device_id"]) if ticket.get("device_id") else None

    # -- writes ----------------------------------------------------------
    def save_tickets(self) -> None:
        """Writes tickets back atomically, in id order."""
        path = self.directory / "tickets.json"
        tmp = path.with_suffix(".json.tmp")
        rows = [self._tickets[key] for key in sorted(self._tickets)]
        tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(path)
