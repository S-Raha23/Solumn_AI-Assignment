"""Hardware vendors and their partner portals."""
from __future__ import annotations

import json
import os
from pathlib import Path

from .store import data_dir


class VendorError(Exception):
    """A vendor is unknown, or its portal rejected a case."""


def portal_root() -> Path:
    return Path(os.environ.get("VENDOR_PORTAL_ROOT", "/var/tmp/vendor-portal"))


def load_vendors(directory: Path | None = None) -> dict[str, dict]:
    path = (Path(directory) if directory else data_dir()) / "vendors.json"
    return {vendor["id"]: vendor for vendor in json.loads(path.read_text(encoding="utf-8"))}


def vendor(vendor_id: str, directory: Path | None = None) -> dict:
    try:
        return load_vendors(directory)[vendor_id]
    except KeyError:
        raise VendorError(f"unknown vendor: {vendor_id}") from None


def submit_case(vendor_id: str, case: dict, *, submitted_at: str, directory: Path | None = None) -> str:
    """Files a support case on a vendor's partner portal and returns its case number.

    There is no network in this image: the portal is a stand-in that stores
    each case exactly as posted under <portal root>/<vendor id>/.
    """
    entry = vendor(vendor_id, directory)
    missing = [name for name in ("case_ref", "device", "problem") if not case.get(name)]
    if missing:
        raise VendorError(f"{entry['name']} portal rejected the case: missing {', '.join(missing)}")
    inbox = portal_root() / vendor_id
    inbox.mkdir(parents=True, exist_ok=True)
    number = f"{entry['case_prefix']}-{len(list(inbox.glob('*.json'))) + 1:06d}"
    request = {
        "portal": entry["portal_url"],
        "case_number": number,
        "received_at": submitted_at,
        "case": case,
    }
    (inbox / f"{number}.json").write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return number
