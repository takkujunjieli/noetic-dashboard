#!/usr/bin/env python3
"""Serve the dashboard and private transaction stores on loopback only."""
import argparse
import hashlib
import json
import os
import re
import tempfile
import threading
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo

from build_transaction_history import build_history
from trade_journal import import_local_history, journal_summary, load_annotations, load_journal, update_annotations
from trade_links import load_links, mutate_links
from export_public_dashboard import write_public_snapshot

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT.parent / "stock-dashboard-private" / "thesis_transactions"
LOCK = threading.Lock()
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}")


def validate_file(file, thesis_id):
    if not isinstance(file, dict) or file.get("schema") != "thesis-transaction-history" or file.get("version") != 1:
        raise ValueError("交易文件格式无效")
    if file.get("thesis", {}).get("id") != thesis_id:
        raise ValueError("交易文件不属于此 thesis")
    symbols = file["thesis"].get("underlyings")
    if not isinstance(symbols, list) or not symbols or any(not isinstance(s, str) for s in symbols):
        raise ValueError("缺少 underlying")
    period = file.get("range", {})
    if period.get("timeZone") != "America/New_York" or period.get("startTime") != "02:00" or period.get("endTime") != "24:00":
        raise ValueError("时间范围无效")
    start, end = period.get("startDate", ""), period.get("endDate", "")
    for day in (start, end):
        if datetime.strptime(day, "%Y-%m-%d").strftime("%Y-%m-%d") != day:
            raise ValueError("日期无效")
    lower, upper = start + "T02:00:00.000", end + "T" + period["endTime"] + ":00.000"
    if start > end or period.get("startLocal") != lower or period.get("endLocal") != upper:
        raise ValueError("时间范围不一致")
    rows = file.get("transactions")
    if not isinstance(rows, list) or file.get("transaction_count") != len(rows):
        raise ValueError("交易数量不一致")
    for row in rows:
        if not isinstance(row, dict) or row.get("underlying") not in symbols or not isinstance(row.get("sym"), str):
            raise ValueError("交易标的不属于此配置")
        moment = datetime.fromisoformat(row.get("ts", "").replace("Z", "+00:00"))
        if moment.tzinfo is None:
            raise ValueError("交易时间缺少时区")
        local = moment.astimezone(ZoneInfo("America/New_York")).isoformat(timespec="milliseconds")[:23]
        if not lower <= local <= upper:
            raise ValueError("交易不在指定范围内")
    source = file.get("source", {})
    if not isinstance(source.get("sources"), list) or any(not isinstance(s, dict) or not isinstance(s.get("file"), str) for s in source["sources"]):
        raise ValueError("交易来源无效")
    if not isinstance(file.get("warnings"), list):
        raise ValueError("文件缺少覆盖范围说明")


def etag(data):
    return '"' + hashlib.sha256(data).hexdigest() + '"'


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, private_dir=PRIVATE, data_dir=None, journal_path=None, annotations_path=None, **kwargs):
        self.private_dir = Path(private_dir)
        self.data_dir = Path(data_dir) if data_dir else ROOT / "data"
        self.journal_path = Path(journal_path) if journal_path else self.private_dir.parent / "trade_journal" / "journal.json"
        self.annotations_path = Path(annotations_path) if annotations_path else self.journal_path.with_name("annotations.json")
        self.links_path = self.journal_path.with_name("trade_links.json")
        self.broker_pnl_path = self.journal_path.with_name("broker_pnl.json")
        super().__init__(*args, **kwargs)

    def reply(self, status, body, tag=None):
        content = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        if tag:
            self.send_header("ETag", tag)
        self.end_headers()
        self.wfile.write(content)

    def allowed(self, mutation=False):
        host = self.headers.get("Host", "")
        parsed = urlsplit("http://" + host)
        if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            self.reply(403, {"error": "仅允许本机访问"})
            return False
        origin = self.headers.get("Origin")
        if (origin and origin != "http://" + host) or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.reply(403, {"error": "不允许跨站访问交易文件"})
            return False
        return True

    def transaction_path(self):
        path = unquote(urlsplit(self.path).path)
        prefix = "/api/thesis-transactions/"
        thesis_id = path[len(prefix):] if path.startswith(prefix) else ""
        if not ID_PATTERN.fullmatch(thesis_id):
            raise ValueError("Thesis ID 无效")
        target = self.private_dir / (thesis_id + ".json")
        if target.is_symlink():
            raise ValueError("交易文件不能是符号链接")
        return thesis_id, target

    def do_GET(self):
        if not self.allowed():
            return
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        try:
            if path == "/api/transaction-history":
                return self.reply(200, build_history(self.data_dir))
            if path == "/api/trade-journal":
                journal = load_journal(self.journal_path)
                return self.reply(200, {"journal": journal_summary(journal), "fills": journal["fills"]})
            if path == "/api/trade-links":
                document = load_links(self.links_path)
                return self.reply(200, document, etag(self.links_path.read_bytes()) if self.links_path.exists() else None)
            if path == "/api/trade-annotations":
                document = load_annotations(self.annotations_path)
                raw = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode()
                return self.reply(200, document, etag(raw) if self.annotations_path.exists() else None)
            if path == "/api/broker-pnl":
                if not self.broker_pnl_path.exists():
                    return self.reply(200, {"schema":"broker-realized-pnl","version":1,"updated_at":None,"events":[]})
                document = json.loads(self.broker_pnl_path.read_bytes())
                if document.get("schema") != "broker-realized-pnl" or document.get("version") != 1 or not isinstance(document.get("events"), list):
                    raise ValueError("券商 P&L ledger 格式无效")
                return self.reply(200, document)
            thesis_id, target = self.transaction_path()
            if not target.exists():
                return self.reply(200, {"file": None, "path": str(target)})
            raw = target.read_bytes()
            file = json.loads(raw)
            validate_file(file, thesis_id)
            self.reply(200, {"file": file, "path": str(target)}, etag(raw))
        except (ValueError, TypeError, KeyError, OSError) as error:
            self.reply(400, {"error": str(error)})

    def do_PUT(self):
        if urlsplit(self.path).path == "/api/trade-annotations":
            return self.mutate_annotation()
        self.mutate_file(delete=False)

    def do_POST(self):
        if urlsplit(self.path).path == "/api/public-dashboard/export":
            if not self.allowed(mutation=True):
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json" or not 0 < length <= 50_000_000:
                    raise ValueError("公开快照请求必须是 50 MB 以内的 JSON")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or set(body) - {"workflow"}:
                    raise ValueError("公开快照请求只接受 Workflow 内容")
                with LOCK:
                    result = write_public_snapshot(
                        portfolio_path=self.data_dir / "portfolio.json",
                        workflow_path=self.private_dir.parent / "workflow.json",
                        output=self.data_dir / "public-dashboard.json",
                        aliases_path=self.private_dir.parent / "public_aliases.json",
                        workflow=body.get("workflow"))
                return self.reply(200, {"ok": True, "publishedAt": result["publishedAt"], "snapshot": result})
            except (ValueError, TypeError, KeyError, AttributeError, OSError) as error:
                return self.reply(400, {"error": str(error)})
        if urlsplit(self.path).path == "/api/trade-links":
            return self.mutate_trade_links()
        if not self.allowed(mutation=True):
            return
        if urlsplit(self.path).path != "/api/trade-journal/import":
            return self.reply(404, {"error": "API not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 20_000:
                raise ValueError("导入请求超过 20 KB")
            if length:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 JSON 请求")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("导入请求必须是 JSON object")
            else:
                body = {"mode": "incremental"}
            mode = body.get("mode", "incremental")
            if mode not in ("incremental", "backfill"):
                raise ValueError("mode 必须是 incremental 或 backfill")
            start = body.get("start") if mode == "backfill" else None
            end = body.get("end") if mode == "backfill" else None
            if mode == "backfill" and (start is None or end is None):
                raise ValueError("区间回填需要开始和结束日期")
            with LOCK:
                journal, result = import_local_history(self.data_dir, self.journal_path, start, end)
            self.reply(200, {"journal": journal_summary(journal), "import": result})
        except (ValueError, TypeError, KeyError, OSError, json.JSONDecodeError) as error:
            self.reply(400, {"error": str(error)})

    def do_DELETE(self):
        self.mutate_file(delete=True)

    def mutate_trade_links(self):
        if not self.allowed(mutation=True):
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json" or not 0 < length <= 100_000:
                raise ValueError("关联请求必须是 JSON，且小于 100 KB")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("关联请求格式无效")
            with LOCK:
                previous = self.links_path.read_bytes() if self.links_path.exists() else None
                valid = ((previous is not None and self.headers.get("If-Match") == etag(previous))
                         or (previous is None and self.headers.get("If-None-Match") == "*"))
                if not valid:
                    return self.reply(409, {"error": "关联已被其他页面更新，请重新读取后再保存"})
                document = mutate_links(self.links_path, body, load_journal(self.journal_path))
                tag = etag(self.links_path.read_bytes())
            self.reply(200, document, tag)
        except (ValueError, TypeError, KeyError, AttributeError, OSError) as error:
            self.reply(400, {"error": str(error)})

    def mutate_annotation(self):
        if not self.allowed(mutation=True):
            return
        try:
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("需要 JSON 请求")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 20_000:
                raise ValueError("理由为空或超过请求上限")
            body = json.loads(self.rfile.read(length))
            with LOCK:
                previous = self.annotations_path.read_bytes() if self.annotations_path.exists() else None
                valid = ((previous is not None and self.headers.get("If-Match") == etag(previous))
                         or (previous is None and self.headers.get("If-None-Match") == "*"))
                if not valid:
                    return self.reply(409, {"error": "交易理由已被其他页面或 agent 更新，请重新读取后再保存"})
                trade_ids = body.get("trade_ids")
                if trade_ids is None:
                    trade_ids = [body.get("trade_id")]
                document = update_annotations(trade_ids, body.get("reason"),
                                              load_journal(self.journal_path), self.annotations_path)
                content = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode()
            self.reply(200, document, etag(content))
        except (ValueError, TypeError, KeyError, OSError, json.JSONDecodeError) as error:
            self.reply(400, {"error": str(error)})

    def mutate_file(self, delete):
        if not self.allowed(mutation=True):
            return
        try:
            thesis_id, target = self.transaction_path()
            if not delete:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 JSON 请求")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 20_000_000:
                    raise ValueError("交易文件为空或超过 20 MB")
                file = json.loads(self.rfile.read(length))
                validate_file(file, thesis_id)
                content = (json.dumps(file, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
            with LOCK:
                previous = target.read_bytes() if target.exists() else None
                valid = (previous is not None and self.headers.get("If-Match") == etag(previous)) or (previous is None and not delete and self.headers.get("If-None-Match") == "*")
                if not valid:
                    return self.reply(409, {"error": "交易文件已被其他页面或 agent 更新，请重新读取后再保存"})
                if delete:
                    target.unlink()
                    return self.reply(200, {"file": None, "path": str(target)})
                target.parent.mkdir(parents=True, exist_ok=True)
                temp_path = None
                try:
                    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".transaction-", delete=False) as temp:
                        temp_path = Path(temp.name)
                        temp.write(content)
                        temp.flush()
                        os.fsync(temp.fileno())
                    temp_path.replace(target)
                finally:
                    if temp_path and temp_path.exists():
                        temp_path.unlink()
            self.reply(200, {"path": str(target)}, etag(content))
        except (ValueError, TypeError, KeyError, OSError) as error:
            self.reply(400, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8642)
    parser.add_argument("--private-dir", type=Path, default=PRIVATE)
    parser.add_argument("--journal-path", type=Path,
                        help="private canonical trade journal (default: sibling trade_journal/journal.json)")
    args = parser.parse_args()
    handler = partial(DashboardHandler, directory=str(ROOT), private_dir=args.private_dir,
                      journal_path=args.journal_path)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Dashboard: http://localhost:{args.port}/workflow.html", flush=True)
    print(f"Thesis transaction files: {args.private_dir}", flush=True)
    print(f"Canonical trade journal: {args.journal_path or args.private_dir.parent / 'trade_journal' / 'journal.json'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
