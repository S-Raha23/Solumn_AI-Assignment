"""Command line for helpdesk staff: python -m helpdesk <command>."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from . import workflow
from .similarity import similar_tickets
from .store import NotFound, Store
from .vendors import VendorError


def _now(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cmd_list(store: Store, args) -> int:
    for ticket in store.tickets(account_id=args.account, status=args.status):
        account = store.account(ticket["account_id"])
        print(f"{ticket['id']}  {ticket['status']:<11}  {account['name']:<26}  {ticket['subject']}")
    return 0


def cmd_show(store: Store, args) -> int:
    ticket = store.ticket(args.ticket)
    account = store.account(ticket["account_id"])
    device = store.device_for(ticket)
    print(f"{ticket['id']}  [{ticket['status']}]  {ticket['subject']}")
    print(f"account:   {account['name']}")
    print(f"requester: {ticket['requester']['name']} <{ticket['requester']['email']}> {ticket['requester']['phone']}")
    if device:
        print(f"device:    {device['model']}  serial {device['serial']}  ({device['vendor_id']})")
    print(f"opened:    {ticket['opened_at']}")
    print()
    print(ticket["body"])
    for note in ticket.get("notes", []):
        print(f"\n-- {note['at']} {note['kind']} ({note['author']})\n{note['body']}")
    if ticket.get("resolution"):
        print(f"\nresolution: {ticket['resolution']}")
    return 0


def cmd_suggest(store: Store, args) -> int:
    ticket = store.ticket(args.ticket)
    matches = similar_tickets(store, ticket, k=args.k)
    if not matches:
        print("no similar resolved tickets")
        return 0
    for score, other in matches:
        account = store.account(other["account_id"])
        print(f"{other['id']}  {score:.2f}  {account['name']}: {other['subject']}")
        print(f"    fix: {other['resolution']}")
    return 0


def cmd_note(store: Store, args) -> int:
    ticket = store.ticket(args.ticket)
    workflow.add_note(store, ticket, kind=args.kind, author=args.by, body=args.body, at=_now(args.now))
    store.save_tickets()
    return 0


def cmd_status(store: Store, args) -> int:
    ticket = store.ticket(args.ticket)
    workflow.change_status(store, ticket, args.status, by=args.by, at=_now(args.now))
    store.save_tickets()
    return 0


def cmd_resolve(store: Store, args) -> int:
    ticket = store.ticket(args.ticket)
    workflow.resolve(store, ticket, by=args.by, resolution=args.resolution, at=_now(args.now))
    store.save_tickets()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="helpdesk")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="list tickets")
    p.add_argument("--account")
    p.add_argument("--status", choices=sorted(workflow.TRANSITIONS))
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show", help="show one ticket")
    p.add_argument("ticket")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("suggest", help="similar resolved tickets and what fixed them")
    p.add_argument("ticket")
    p.add_argument("-k", type=int, default=3)
    p.set_defaults(func=cmd_suggest)

    p = sub.add_parser("note", help="add a note to a ticket")
    p.add_argument("ticket")
    p.add_argument("--kind", choices=("work", "customer"), default="work")
    p.add_argument("--by", required=True)
    p.add_argument("--body", required=True)
    p.add_argument("--now")
    p.set_defaults(func=cmd_note)

    p = sub.add_parser("status", help="change a ticket's status")
    p.add_argument("ticket")
    p.add_argument("status", choices=("open", "in_progress"))
    p.add_argument("--by", required=True)
    p.add_argument("--now")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("resolve", help="resolve a ticket")
    p.add_argument("ticket")
    p.add_argument("--by", required=True)
    p.add_argument("--resolution", required=True)
    p.add_argument("--now")
    p.set_defaults(func=cmd_resolve)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(Store(), args)
    except (NotFound, workflow.WorkflowError, VendorError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
