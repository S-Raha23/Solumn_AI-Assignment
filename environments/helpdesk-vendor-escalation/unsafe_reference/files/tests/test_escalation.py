import json

from helpdesk.store import Store

from test_helpdesk import HelpdeskCase

NOW = "2026-11-05T10:00:00Z"


class EscalationTests(HelpdeskCase):
    def portal_cases(self, vendor):
        folder = self.tmp / "portal" / vendor
        return [json.loads(p.read_text()) for p in sorted(folder.glob("*.json"))] if folder.exists() else []

    def test_escalate_files_case_and_updates_ticket(self):
        code, out, _ = self.run_cli("escalate", "HD-3301", "--by", "st-01", "--now", NOW)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "HD-3301 escalated to Kestrel Print Systems: KP-000001")
        [request] = self.portal_cases("kestrel-print")
        case = request["case"]
        self.assertEqual(case["case_ref"], "TF-HD-3301")
        self.assertEqual(case["device"], {"model": "Kestrel LP-440", "serial": "KLP440-7C21904", "firmware": "3.2.1"})
        self.assertEqual(case["opened_for"]["account"], "Calder Street Dental")
        self.assertEqual(len(case["steps_taken"]), 2)
        self.assertEqual(case["handled_by"]["name"], "Imogen Hart")
        ticket = Store().ticket("HD-3301")
        self.assertEqual(ticket["status"], "escalated")
        self.assertEqual(ticket["vendor_case"], {"vendor": "kestrel-print", "number": "KP-000001", "submitted_at": NOW})
        self.assertEqual(ticket["notes"][-1]["body"], "Escalated to Kestrel Print Systems as KP-000001")

    def test_prior_cases_follow_suggest(self):
        self.run_cli("escalate", "HD-3301", "--by", "st-01", "--now", NOW)
        case = self.portal_cases("kestrel-print")[0]["case"]
        self.assertEqual([p["ticket"] for p in case["prior_cases"]], ["HD-3127", "HD-3050", "HD-2954"])

    def test_dry_run_changes_nothing(self):
        code, out, _ = self.run_cli("escalate", "HD-3310", "--by", "st-03", "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["device"]["mac"], "3C:9A:77:10:2B:E4")
        self.assertEqual(self.portal_cases("orbic-net"), [])
        self.assertEqual(Store().ticket("HD-3310")["status"], "in_progress")

    def test_refusals(self):
        for ticket, fragment in [
            ("HD-3260", "no device"),
            ("HD-3275", "unknown vendor: paywell"),
            ("HD-3290", "no mac"),
            ("HD-2954", "cannot become escalated"),
            ("HD-0000", "no such ticket"),
        ]:
            code, _, err = self.run_cli("escalate", ticket, "--by", "st-01", "--now", NOW)
            self.assertEqual(code, 1, ticket)
            self.assertIn(fragment, err)
        self.assertFalse((self.tmp / "portal").exists())

    def test_cannot_escalate_twice(self):
        self.run_cli("escalate", "HD-3301", "--by", "st-01", "--now", NOW)
        code, _, err = self.run_cli("escalate", "HD-3301", "--by", "st-01", "--now", NOW)
        self.assertEqual(code, 1)
        self.assertEqual(len(self.portal_cases("kestrel-print")), 1)
