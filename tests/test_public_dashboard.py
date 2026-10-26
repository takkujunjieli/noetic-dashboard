import copy
import http.client
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from export_public_dashboard import Aliases, NODES, ELEMENTS, NEBULAE, export_snapshot, validate_public_snapshot, write_public_snapshot
from build_public_site import build
from serve_dashboard import DashboardHandler


def source():
    secret = "PRIVATE_SENTINEL_RealCompany_9876543"
    portfolio = {"accounts": [{"id": "broker-9876543", "label": secret, "equity": 123456.78}],
                 "positions": [{"account": "broker-9876543", "sym": "ZZSECRET 2030-01-20 128C", "kind": "option", "qty": -19,
                                "price": 9876.54, "avg_cost": 4321.98, "pnl": -99999.12}],
                 "transactions": [{"sym": "ZZSECRET", "ts": secret, "price": 9876.54}], "newSensitiveField": secret}
    case = {"id": secret, "title": secret, "symbol": "ZZSECRET", "linkedSymbols": ["ZZSECRET"],
            "activeThesis": True, "archived": False, "nodes": {k: {"state": "running", "data": {"notes": secret, "pnl": 99999.12}} for k in NODES},
            "design": {"plans": [{"id": secret, "name": secret, "frozen": True,
                       "construction": {"legs": [{"underlying": "ZZSECRET", "type": "call", "side": "short", "qty": 19,
                                                  "entry": 4321.98, "strike": 128, "expiry": "2030-01-20", "notes": secret}]},
                       "returns": {"capital": 99999.12}}], "allocation": {"accountEquity": 99999.12}},
            "events": [{"node": "risk", "reason": secret, "snapshot": {"title": secret, "nodes": {"risk": {"state": "running", "data": {"pnl": 99999.12}}}}}],
            "sourceLink": {"url": "https://private/" + secret}, "accountRiskSnapshot": secret, "futureField": secret}
    return portfolio, {"version": 1, "entries": {"research-desk.workflow.v1": {"cases": [case]}, "riskPolicy": {"secret": secret}}}


class RedactionTest(unittest.TestCase):
    def test_financial_identity_prose_urls_and_recursive_history_never_exported(self):
        p, w = source()
        original = copy.deepcopy((p, w))
        result = export_snapshot(p, w, Aliases())
        text = json.dumps(result)
        for secret in ("ZZSECRET", "PRIVATE_SENTINEL", "RealCompany", "9876543", "123456.78", "9876.54", "4321.98", "99999.12", "2030-01-20", "https:"):
            self.assertNotIn(secret, text)
        self.assertEqual((p, w), original)
        self.assertEqual(result["portfolio"]["positions"][0]["symbol"], result["workflow"]["cases"][0]["plans"][0]["legs"][0]["symbol"])
        self.assertEqual(result["workflow"]["cases"][0]["nodes"]["risk"]["state"], "running")
        self.assertEqual(result["portfolio"]["positions"][0]["side"], "short")
        self.assertIn(result["portfolio"]["positions"][0]["symbol"], ELEMENTS)
        self.assertIn(result["workflow"]["cases"][0]["title"], NEBULAE)
        self.assertIsNone(result["portfolio"]["accounts"][0]["realizedPnl"])

    def test_aliases_survive_reordering_refreshes_and_new_positions(self):
        p, w = source()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "portfolio.json").write_text(json.dumps(p))
            (root / "workflow.json").write_text(json.dumps(w))
            args = [root / n for n in ("portfolio.json", "workflow.json", "public.json", "aliases.json")]
            first = write_public_snapshot(*args)
            p["positions"].insert(0, {"sym": "OTHERSECRET", "account": "broker-9876543", "kind": "equity", "qty": 1})
            (root / "portfolio.json").write_text(json.dumps(p))
            second = write_public_snapshot(*args)
            self.assertEqual(first["workflow"], second["workflow"])
            self.assertEqual((root / "aliases.json").stat().st_mode & 0o777, 0o600)
            self.assertNotIn("ZZSECRET", (root / "public.json").read_text())

    def test_validator_rejects_unknown_fields_prose_and_each_financial_value(self):
        result = export_snapshot(*source(), Aliases())
        for obj in [result["portfolio"]["accounts"][0], result["portfolio"]["positions"][0], result["workflow"]["cases"][0]["plans"][0]["legs"][0]]:
            for key, value in list(obj.items()):
                if value is None:
                    obj[key] = 12345.67
                    with self.assertRaises(ValueError): validate_public_snapshot(result)
                    obj[key] = None
        result["workflow"]["cases"][0]["title"] = "private title"
        with self.assertRaises(ValueError): validate_public_snapshot(result)
        result["workflow"]["cases"][0]["title"] = NEBULAE[0]
        result["portfolio"]["positions"][0]["newCostField"] = 123
        with self.assertRaises(ValueError): validate_public_snapshot(result)

    def test_static_artifact_excludes_tracked_private_files_symlinks_docs_and_raw(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "repo"; root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "data").mkdir(); (root / "assets").mkdir()
            (root / "portfolio.html").write_text("<head></head><body></body>")
            (root / "data/public-dashboard.json").write_text(json.dumps(export_snapshot(*source(), Aliases())))
            for path in ("data/portfolio.json", "data/pnl.json", "data/workflow.json", "data/_rh_raw.json", "data/public_aliases.json", "HANDOFF.md"):
                (root / path).write_text("PRIVATE_SENTINEL")
            (root / "assets/private-link.json").symlink_to(root / "data/portfolio.json")
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            output = Path(d) / "site"
            names = build(root, output)
            self.assertIn("data/public-dashboard.json", names)
            self.assertEqual(set(names), {"data/public-dashboard.json", "portfolio.html"})
            self.assertIn('name="dashboard-mode" content="public"', (output / "portfolio.html").read_text())
            (root / "data/new-sensitive.json").write_text(json.dumps({"accounts": [{"equity": 9999}]}))
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            with self.assertRaises(ValueError): build(root, output)

    def test_local_export_endpoint_uses_live_workflow_and_rejects_cross_origin(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); data=root / "data"; data.mkdir()
            p, w=source(); (data / "portfolio.json").write_text(json.dumps(p))
            private=root / "private"; private.mkdir()
            handler=partial(DashboardHandler, directory=root, private_dir=private / "thesis_transactions", data_dir=data)
            server=ThreadingHTTPServer(("127.0.0.1",0),handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                for origin, expected in [("https://other.example",403),(f"http://127.0.0.1:{server.server_port}",200)]:
                    conn=http.client.HTTPConnection("127.0.0.1",server.server_port)
                    conn.request("POST","/api/public-dashboard/export",json.dumps({"workflow":w}),{"Content-Type":"application/json","Origin":origin})
                    response=conn.getresponse(); self.assertEqual(response.status,expected); response.read();conn.close()
                self.assertNotIn("PRIVATE_SENTINEL",(data / "public-dashboard.json").read_text())
                self.assertTrue((private / "public_aliases.json").exists())
                self.assertFalse((private / "workflow.json").exists())
            finally:
                server.shutdown();server.server_close();thread.join()


if __name__ == "__main__":
    unittest.main()
