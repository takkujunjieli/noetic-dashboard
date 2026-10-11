import http.client
import json
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from serve_dashboard import DashboardHandler
from trade_journal import import_local_history, import_rows, load_annotations, load_journal, normalize_fill, parse_instrument, update_annotation, update_annotations


def equity(**overrides):
    row = {"broker": "rh", "account": "acct", "kind": "equity",
           "ts": "2026-10-06T13:38:12.183Z", "sym": "DELL", "side": "sell_short",
           "qty": 3, "price": 573.5086, "state": "filled", "source_file": "_rh_raw.json"}
    row.update(overrides)
    return row


class TradeJournalTest(unittest.TestCase):
    def test_option_parsing_and_multileg_order_identity(self):
        leg1 = normalize_fill(equity(kind="option", sym="INTC 2026-11-06 120C",
                                     side="buy", price=2.35, order_id="combo", execution_id="one"))
        leg2 = normalize_fill(equity(kind="option", sym="INTC 2026-11-06 150C",
                                     side="sell", price=1.10, order_id="combo", execution_id="two"))
        self.assertEqual(leg1["instrument"]["expiry"], "2026-11-06")
        self.assertEqual(leg1["instrument"]["strike"], 120)
        self.assertEqual(leg1["underlying"], "INTC")
        self.assertNotEqual(leg1["fill_id"], leg2["fill_id"])
        self.assertEqual(leg1["trade_id"], leg2["trade_id"])
        occ = parse_instrument("INTC261106C00120000", "option")
        self.assertEqual((occ["expiry"], occ["strike"], occ["right"]), ("2026-11-06", 120, "C"))
        old_timestamp = normalize_fill(equity(ts="2026-10-05T20:02:53.33Z"))
        self.assertEqual(old_timestamp["timestamp"], "2026-10-05T20:02:53.330Z")

    def test_append_only_idempotent_import_and_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            first, stats = import_rows([equity()], path)
            self.assertEqual((stats["inserted"], len(first["fills"]), first["revision"]), (1, 1, 1))
            second, stats = import_rows([equity()], path)
            self.assertEqual((stats["inserted"], stats["duplicates"], len(second["fills"]), second["revision"]),
                             (0, 1, 1, 1))
            # Broker execution identity wins over changed mutable facts; existing facts survive.
            original = equity(execution_id="fixed", price=10)
            import_rows([original], path)
            journal, stats = import_rows([equity(execution_id="fixed", price=11)], path)
            self.assertEqual(stats["conflicts"], 1)
            fixed = next(fill for fill in journal["fills"] if fill["execution_id"] == "fixed")
            self.assertEqual(fixed["price"], 10)
            self.assertEqual(load_journal(path)["revision"], 2)

    def test_annotations_are_separate_and_reference_existing_trade(self):
        with tempfile.TemporaryDirectory() as directory:
            journal_path = Path(directory) / "journal.json"
            annotation_path = Path(directory) / "annotations.json"
            journal, _ = import_rows([equity()], journal_path)
            trade_id = journal["fills"][0]["trade_id"]
            notes = update_annotation(trade_id, "按计划减仓", journal, annotation_path)
            self.assertEqual(notes["annotations"][trade_id]["reason"], "按计划减仓")
            self.assertEqual(len(load_journal(journal_path)["fills"]), 1)
            with self.assertRaisesRegex(ValueError, "does not exist"):
                update_annotation("trade:v1:" + "0" * 32, "orphan", journal, annotation_path)

    def test_group_annotation_updates_all_trades_in_one_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            journal, _ = import_rows([
                equity(execution_id="one", order_id="one"),
                equity(execution_id="two", order_id="two"),
            ], root / "journal.json")
            trade_ids = [fill["trade_id"] for fill in journal["fills"]]
            notes = update_annotations(trade_ids, "共同理由", journal, root / "annotations.json")
            self.assertEqual(notes["revision"], 1)
            self.assertEqual({notes["annotations"][trade_id]["reason"] for trade_id in trade_ids}, {"共同理由"})

    def test_backfill_filters_by_inclusive_eastern_date_and_reports_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"; data.mkdir()
            journal_path = root / "journal.json"
            raw = {"broker": "rh", "source_updated_at": "2026-10-08T20:00:00Z",
                   "accounts": [{"id": "acct"}], "transactions": [
                       equity(ts="2026-10-01T03:30:00Z", execution_id="before"),
                       equity(ts="2026-10-01T04:00:00Z", execution_id="start"),
                       equity(ts="2026-10-03T03:59:59Z", execution_id="end"),
                       equity(ts="2026-10-03T04:00:00Z", execution_id="after"),
                   ]}
            (data / "_rh_raw.json").write_text(json.dumps(raw))
            journal, result = import_local_history(data, journal_path, "2026-10-01", "2026-10-02")
            self.assertEqual({fill["execution_id"] for fill in journal["fills"]}, {"start", "end"})
            self.assertEqual((result["source_scanned"], result["matched"], result["inserted"]), (4, 2, 2))
            self.assertEqual(result["scope"]["time_zone"], "America/New_York")
            self.assertEqual(result["sources"][0]["source_updated_at"], "2026-10-08T20:00:00Z")
            self.assertEqual(load_journal(journal_path)["import_runs"][-1]["scope"], result["scope"])
            with self.assertRaisesRegex(ValueError, "start date"):
                import_local_history(data, journal_path, "2026-10-03", "2026-10-02")

    def test_loopback_import_api_reads_local_raw(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"; data.mkdir()
            private = root / "private"; journal = root / "journal.json"
            raw = {"broker": "rh", "accounts": [{"id": "acct"}], "transactions": [equity()]}
            (data / "_rh_raw.json").write_text(json.dumps(raw))
            handler = partial(DashboardHandler, directory=root, private_dir=private,
                              data_dir=data, journal_path=journal)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                def call(method, path, body=None):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                    payload = json.dumps(body) if body is not None else None
                    headers = {"Content-Type": "application/json"} if payload is not None else {}
                    connection.request(method, path, payload, headers)
                    response = connection.getresponse()
                    result = response.status, json.loads(response.read())
                    connection.close()
                    return result
                status, body = call("POST", "/api/trade-journal/import")
                self.assertEqual((status, body["import"]["inserted"], body["journal"]["fill_count"]), (200, 1, 1))
                status, body = call("POST", "/api/trade-journal/import")
                self.assertEqual((status, body["import"]["duplicates"], body["journal"]["revision"]), (200, 1, 1))
                status, body = call("POST", "/api/trade-journal/import",
                                    {"mode": "backfill", "start": "2026-10-06", "end": "2026-10-06"})
                self.assertEqual((status, body["import"]["matched"], body["import"]["duplicates"]), (200, 1, 1))
                self.assertEqual(body["import"]["scope"]["mode"], "backfill")
                status, body = call("POST", "/api/trade-journal/import", {"mode": "backfill"})
                self.assertEqual(status, 400)
                status, body = call("GET", "/api/trade-journal")
                self.assertEqual((status, len(body["fills"]), body["fills"][0]["underlying"]), (200, 1, "DELL"))
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
