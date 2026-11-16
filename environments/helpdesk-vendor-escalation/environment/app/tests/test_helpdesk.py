import contextlib
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from helpdesk import cli, workflow
from helpdesk.similarity import similar_tickets, tokens
from helpdesk.store import NotFound, Store
from helpdesk.vendors import VendorError, submit_case

DATA = Path(__file__).resolve().parent.parent / "data"


class HelpdeskCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="helpdesk-"))
        shutil.copytree(DATA, self.tmp / "data")
        os.environ["HELPDESK_DATA"] = str(self.tmp / "data")
        os.environ["VENDOR_PORTAL_ROOT"] = str(self.tmp / "portal")
        self.store = Store()

    def tearDown(self):
        os.environ.pop("HELPDESK_DATA", None)
        os.environ.pop("VENDOR_PORTAL_ROOT", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()


class StoreTests(HelpdeskCase):
    def test_tickets_filter_by_account_and_status(self):
        calder = self.store.tickets(account_id="acct-calder")
        self.assertEqual([t["id"] for t in calder], ["HD-2954", "HD-3012", "HD-3260", "HD-3301", "HD-3310"])
        self.assertEqual(len(self.store.tickets(status="resolved")), 5)

    def test_unknown_ticket(self):
        with self.assertRaises(NotFound):
            self.store.ticket("HD-0000")


class WorkflowTests(HelpdeskCase):
    def test_resolve_records_resolution_and_note(self):
        ticket = self.store.ticket("HD-3260")
        workflow.resolve(self.store, ticket, by="st-03", resolution="Account created.", at="2026-11-05T09:00:00Z")
        self.assertEqual(ticket["status"], "resolved")
        self.assertEqual(ticket["notes"][-1]["body"], "Status open -> resolved by st-03")

    def test_illegal_transition(self):
        with self.assertRaises(workflow.WorkflowError):
            workflow.change_status(self.store, self.store.ticket("HD-3260"), "escalated", by="st-01", at="x")

    def test_resolved_ticket_is_final(self):
        with self.assertRaises(workflow.WorkflowError):
            workflow.change_status(self.store, self.store.ticket("HD-2954"), "open", by="st-01", at="x")


class SimilarityTests(HelpdeskCase):
    def test_tokens_drop_stopwords(self):
        self.assertEqual(tokens("The printer is not on-line"), ["printer", "on-line"])

    def test_suggest_ranks_blank_label_tickets_first(self):
        matches = similar_tickets(self.store, self.store.ticket("HD-3301"))
        self.assertEqual([t["id"] for _, t in matches], ["HD-3127", "HD-3050", "HD-2954"])
        self.assertTrue(all(t["status"] == "resolved" for _, t in matches))

    def test_cli_suggest_shows_the_fix(self):
        code, out, _ = self.run_cli("suggest", "HD-3301", "-k", "1")
        self.assertEqual(code, 0)
        self.assertIn("HD-3127", out)
        self.assertIn("fix: Priya Okonkwo had loaded the ribbon ink side out.", out)


class VendorTests(HelpdeskCase):
    def test_submit_case_numbers_and_records(self):
        case = {"case_ref": "TF-X", "device": {"serial": "S"}, "problem": {"subject": "s"}}
        first = submit_case("orbic-net", case, submitted_at="2026-11-05T09:00:00Z")
        second = submit_case("orbic-net", case, submitted_at="2026-11-05T09:01:00Z")
        self.assertEqual((first, second), ("ORB-000001", "ORB-000002"))
        self.assertTrue((self.tmp / "portal/orbic-net/ORB-000002.json").exists())

    def test_portal_rejects_incomplete_case(self):
        with self.assertRaises(VendorError):
            submit_case("kestrel-print", {"case_ref": "TF-X"}, submitted_at="x")


class CliTests(HelpdeskCase):
    def test_note_and_status_persist(self):
        code, _, _ = self.run_cli("note", "HD-3260", "--by", "st-03", "--body", "Waiting on start date", "--now", "2026-11-05T09:00:00Z")
        self.assertEqual(code, 0)
        code, _, _ = self.run_cli("status", "HD-3260", "in_progress", "--by", "st-03", "--now", "2026-11-05T09:01:00Z")
        self.assertEqual(code, 0)
        ticket = Store().ticket("HD-3260")
        self.assertEqual(ticket["status"], "in_progress")
        self.assertEqual(len(ticket["notes"]), 2)

    def test_errors_exit_1(self):
        code, _, err = self.run_cli("show", "HD-0000")
        self.assertEqual(code, 1)
        self.assertIn("error: no such ticket: HD-0000", err)


if __name__ == "__main__":
    unittest.main()
