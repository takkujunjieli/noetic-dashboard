import http.client
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from functools import partial
from pathlib import Path
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from serve_dashboard import DashboardHandler


def fixture():
    return {"schema": "thesis-transaction-history", "version": 1,
            "thesis": {"id": "one", "underlyings": ["AMD"]},
            "range": {"startDate": "2026-07-01", "endDate": "2026-07-01",
                      "startTime": "02:00", "endTime": "24:00", "timeZone": "America/New_York",
                      "startLocal": "2026-07-01T02:00:00.000", "endLocal": "2026-07-01T24:00:00.000"},
            "source": {"sources": []}, "warnings": [], "transaction_count": 1,
            "transactions": [{"ts": "2026-07-01T14:00:00Z", "sym": "AMD", "underlying": "AMD", "price": 10}]}


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.raw = self.root / "data"
        self.raw.mkdir()
        self.store = self.root / "private"
        handler = partial(DashboardHandler, directory=self.root, private_dir=self.store, data_dir=self.raw)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def call(self, method="GET", path="/api/thesis-transactions/one", body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request(method, path, json.dumps(body) if body else None, headers or {})
        response = conn.getresponse()
        result = response.status, json.loads(response.read()), response.getheader("ETag")
        conn.close()
        return result

    def test_single_file_crud_and_external_agent_edits(self):
        self.assertIsNone(self.call()[1]["file"])
        file = fixture()
        self.assertEqual(self.call("PUT", body=file, headers={"Content-Type": "application/json", "If-None-Match": "*"})[0], 200)
        status, body, tag = self.call()
        self.assertEqual(body["file"]["transactions"][0]["price"], 10)
        file["transactions"][0]["price"] = 20
        self.assertEqual(self.call("PUT", body=file, headers={"Content-Type": "application/json", "If-Match": tag})[0], 200)
        self.assertEqual(len(list(self.store.glob("*.json"))), 1)
        self.assertEqual(self.call("PUT", body=fixture(), headers={"Content-Type": "application/json", "If-Match": tag})[0], 409)
        # An agent may also edit the same on-disk JSON; reads must observe it.
        file["transactions"][0]["price"] = 30
        (self.store / "one.json").write_text(json.dumps(file))
        _, body, tag = self.call()
        self.assertEqual(body["file"]["transactions"][0]["price"], 30)
        self.assertEqual(self.call("DELETE", headers={"If-Match": tag})[0], 200)
        self.assertIsNone(self.call()[1]["file"])
        self.assertEqual(list(self.store.iterdir()), [])

    def test_reject_scope_time_identity_paths_and_cross_origin(self):
        headers = {"Content-Type": "application/json", "If-None-Match": "*"}
        for mutate in [lambda f: f["transactions"][0].update(underlying="INTC"),
                       lambda f: f["transactions"][0].update(ts="2026-07-02T04:00:00.001Z"),
                       lambda f: f["thesis"].update(id="other")]:
            file = fixture()
            mutate(file)
            self.assertEqual(self.call("PUT", body=file, headers=headers)[0], 400)
        self.assertEqual(self.call(path="/api/thesis-transactions/%2e%2e%2fescape")[0], 400)
        self.assertEqual(self.call("PUT", body=fixture(), headers={**headers, "Origin": "https://example.com"})[0], 403)
        self.assertFalse(self.store.exists())

    def test_generation_reads_current_raw_without_90_day_cutoff(self):
        source = self.raw / "_rh_raw.json"
        row = {"ts": "2020-01-01T12:00:00Z", "sym": "AMD", "execution_id": "old", "price": 10}
        source.write_text(json.dumps({"transactions": [row]}))
        status, body, _ = self.call(path="/api/transaction-history")
        self.assertEqual(status, 200)
        self.assertEqual(body["transactions"][0]["execution_id"], "old")
        row["execution_id"] = "updated"
        source.write_text(json.dumps({"transactions": [row]}))
        self.assertEqual(self.call(path="/api/transaction-history")[1]["transactions"][0]["execution_id"], "updated")


if __name__ == "__main__":
    unittest.main()
