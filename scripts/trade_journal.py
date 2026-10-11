#!/usr/bin/env python3
"""Build and increment a private canonical fill journal from local broker raw files.

The journal is append-only at the fill level. Re-importing the same local history is
idempotent; a reused fill identity with different facts is reported as a conflict
and the existing fill is preserved.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JOURNAL = ROOT.parent / "stock-dashboard-private" / "trade_journal" / "journal.json"
DEFAULT_ANNOTATIONS = DEFAULT_JOURNAL.with_name("annotations.json")
SCHEMA = "canonical-trade-journal"
VERSION = 1
ET = ZoneInfo("America/New_York")

STANDARD_OPTION = re.compile(
    r"^(?P<underlying>[A-Z0-9.\-]{1,24})\s+"
    r"(?P<expiry>\d{4}-\d{2}-\d{2})\s+"
    r"(?P<strike>\d+(?:\.\d+)?)(?P<right>[CP])$",
    re.I,
)
OCC_OPTION = re.compile(
    r"^(?P<underlying>[A-Z0-9.\-]{1,6})\s*"
    r"(?P<expiry>\d{6})(?P<right>[CP])(?P<strike>\d{8})$",
    re.I,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _number(value: Any) -> float | int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def _timestamp(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing timestamp")
    raw = value.strip()
    # Some older Robinhood exports use variable-width fractional seconds (.9Z/.33Z).
    # Python 3.9's ISO parser is stricter, so normalize to six digits without changing time.
    raw = re.sub(r"\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)",
                 lambda match: "." + (match.group(1) + "000000")[:6], raw)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("invalid timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError("timestamp lacks timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_instrument(symbol: Any, kind: Any = None, underlying: Any = None) -> dict[str, Any]:
    """Return a normalized equity or standard-option instrument description."""
    raw = str(symbol or "").strip().upper()
    if not raw:
        raise ValueError("missing symbol")
    declared = str(kind or "equity").strip().lower()
    standard = STANDARD_OPTION.fullmatch(raw)
    occ = OCC_OPTION.fullmatch(raw.replace(" ", ""))
    if declared == "option" or standard or occ:
        match = standard or occ
        if not match:
            base = str(underlying or "").strip().upper()
            if not base:
                # Keep legacy underlying-only option rows usable without inventing contract terms.
                base = raw.split()[0] if re.fullmatch(r"[A-Z0-9.\-]{1,24}(?:\s+.*)?", raw) else ""
            if not base:
                raise ValueError("option underlying is not recognizable")
            return {"kind": "option", "symbol": raw, "underlying": base,
                    "expiry": None, "strike": None, "right": None,
                    "multiplier": 100, "contract_details_complete": False}
        expiry = match.group("expiry")
        strike = match.group("strike")
        if match.re is OCC_OPTION:
            expiry = f"20{expiry[:2]}-{expiry[2:4]}-{expiry[4:6]}"
            strike = str(int(strike) / 1000)
        return {"kind": "option", "symbol": raw,
                "underlying": match.group("underlying").upper(),
                "expiry": expiry, "strike": _number(strike),
                "right": match.group("right").upper(), "multiplier": 100,
                "contract_details_complete": True}
    base = str(underlying or raw).strip().upper()
    if not re.fullmatch(r"[A-Z0-9.\-]{1,24}", base):
        raise ValueError("equity symbol is not recognizable")
    return {"kind": "equity", "symbol": raw, "underlying": base,
            "multiplier": 1, "contract_details_complete": True}


def _identity_payload(row: dict[str, Any], instrument: dict[str, Any], timestamp: str,
                      broker: str, account: str) -> tuple[str, str]:
    execution_id = str(row.get("execution_id") or "").strip()
    if execution_id:
        return "broker_execution", f"{broker}\0{account}\0{execution_id}"
    # Raw sources without execution IDs already use these facts for deduplication.
    # Keeping the same identity makes imports stable across file ordering and rebuilds.
    payload = {
        "broker": broker, "account": account, "timestamp": timestamp,
        "symbol": instrument["symbol"], "kind": instrument["kind"],
        "side": str(row.get("side") or "").strip().lower(),
        "qty": _number(row.get("qty")), "price": _number(row.get("price")),
        "order_id": str(row.get("order_id") or "").strip(),
    }
    return "fingerprint", _canonical_hash(payload)


def normalize_fill(row: dict[str, Any], imported_at: str | None = None) -> dict[str, Any]:
    broker = str(row.get("broker") or "").strip().lower()
    account = str(row.get("account") or broker).strip()
    if not broker or not account:
        raise ValueError("missing broker/account")
    ts = _timestamp(row.get("ts"))
    instrument = parse_instrument(row.get("sym"), row.get("kind"), row.get("underlying"))
    qty, price = _number(row.get("qty")), _number(row.get("price"))
    if qty is None or qty <= 0 or price is None:
        raise ValueError("invalid quantity/price")
    side = str(row.get("side") or "").strip().lower()
    if not side:
        raise ValueError("missing side")
    quality, identity = _identity_payload(row, instrument, ts, broker, account)
    fill_id = f"fill:v1:{quality}:{_canonical_hash(identity)[:32]}"
    order_id = str(row.get("order_id") or "").strip() or None
    trade_seed = f"{broker}\0{account}\0order\0{order_id}" if order_id else fill_id
    trade_id = f"trade:v1:{_canonical_hash(trade_seed)[:32]}"
    facts = {
        "broker": broker, "account": account, "timestamp": ts,
        "underlying": instrument["underlying"], "kind": instrument["kind"],
        "symbol": instrument["symbol"], "side": side, "qty": qty, "price": price,
        "state": str(row.get("state") or "").strip().lower() or None,
        "order_id": order_id,
        "execution_id": str(row.get("execution_id") or "").strip() or None,
        "instrument": instrument,
    }
    return {
        "fill_id": fill_id, "trade_id": trade_id, "identity_quality": quality,
        **facts, "source_hash": _canonical_hash(facts),
        "source_file": str(row.get("source_file") or ""),
        "imported_at": imported_at or _utc_now(),
    }


def empty_journal() -> dict[str, Any]:
    return {"schema": SCHEMA, "version": VERSION, "revision": 0,
            "created_at": None, "updated_at": None, "fills": [], "import_runs": []}


def load_journal(path: Path = DEFAULT_JOURNAL) -> dict[str, Any]:
    if not path.exists():
        return empty_journal()
    journal = json.loads(path.read_text())
    if journal.get("schema") != SCHEMA or journal.get("version") != VERSION or not isinstance(journal.get("fills"), list):
        raise ValueError("trade journal schema is invalid")
    ids = [fill.get("fill_id") for fill in journal["fills"]]
    if any(not isinstance(value, str) for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("trade journal fill identities are invalid")
    journal.setdefault("revision", 0)
    journal.setdefault("import_runs", [])
    return journal


def _atomic_write(path: Path, journal: dict[str, Any]) -> None:
    content = (json.dumps(journal, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".journal-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def import_rows(rows: list[dict[str, Any]], path: Path = DEFAULT_JOURNAL,
                source_generated_at: str | None = None,
                import_scope: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    journal = load_journal(path)
    existing = {fill["fill_id"]: fill for fill in journal["fills"]}
    now = _utc_now()
    stats = {"scanned": len(rows), "inserted": 0, "duplicates": 0, "conflicts": 0,
             "invalid": 0, "conflict_ids": [], "invalid_rows": []}
    additions = []
    for index, row in enumerate(rows):
        try:
            fill = normalize_fill(row, now)
        except (TypeError, ValueError) as error:
            stats["invalid"] += 1
            if len(stats["invalid_rows"]) < 20:
                stats["invalid_rows"].append({"index": index, "error": str(error)})
            continue
        previous = existing.get(fill["fill_id"])
        if previous:
            if previous.get("source_hash") == fill["source_hash"]:
                stats["duplicates"] += 1
            else:
                stats["conflicts"] += 1
                if len(stats["conflict_ids"]) < 20:
                    stats["conflict_ids"].append(fill["fill_id"])
            continue
        existing[fill["fill_id"]] = fill
        additions.append(fill)
        stats["inserted"] += 1
    if additions:
        journal["fills"].extend(additions)
        journal["fills"].sort(key=lambda fill: (fill["timestamp"], fill["fill_id"]))
        journal["revision"] = int(journal.get("revision") or 0) + 1
        journal["created_at"] = journal.get("created_at") or now
        journal["updated_at"] = now
    run = {"at": now, "source_generated_at": source_generated_at, **stats}
    if import_scope:
        run["scope"] = import_scope
    journal["import_runs"] = (journal.get("import_runs") or [])[-49:] + [run]
    # Record every attempted import, while fill facts remain strictly append-only.
    _atomic_write(path, journal)
    return journal, stats


def _iso_date(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as error:
        raise ValueError(f"{label} must use YYYY-MM-DD") from error
    if parsed.strftime("%Y-%m-%d") != value:
        raise ValueError(f"{label} must use YYYY-MM-DD")
    return value


def import_local_history(data_dir: Path, path: Path = DEFAULT_JOURNAL,
                         start_date: str | None = None,
                         end_date: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    # Import lazily to keep this module usable as a standalone normalizer in tests.
    from build_transaction_history import build_history

    history = build_history(data_dir)
    all_rows = history["transactions"]
    rows = all_rows
    scope: dict[str, Any] = {"mode": "incremental"}
    if start_date is not None or end_date is not None:
        start = _iso_date(start_date, "start date")
        end = _iso_date(end_date, "end date")
        if start > end:
            raise ValueError("start date must not be after end date")
        scope = {"mode": "backfill", "start_date": start, "end_date": end,
                 "time_zone": "America/New_York"}
        rows = []
        for row in all_rows:
            try:
                day = datetime.fromisoformat(_timestamp(row.get("ts")).replace("Z", "+00:00")).astimezone(ET).date().isoformat()
            except (TypeError, ValueError):
                # Preserve malformed source rows so import_rows reports them as invalid.
                rows.append(row)
                continue
            if start <= day <= end:
                rows.append(row)
    journal, stats = import_rows(rows, path, history.get("generated_at"), scope)
    stats["source_scanned"] = len(all_rows)
    stats["matched"] = len(rows)
    stats["scope"] = scope
    stats["sources"] = history.get("sources") or []
    return journal, stats


def journal_summary(journal: dict[str, Any]) -> dict[str, Any]:
    fills = journal.get("fills") or []
    return {"schema": journal.get("schema"), "version": journal.get("version"),
            "revision": journal.get("revision"), "created_at": journal.get("created_at"),
            "updated_at": journal.get("updated_at"), "fill_count": len(fills),
            "trade_count": len({fill.get("trade_id") for fill in fills}),
            "underlying_count": len({fill.get("underlying") for fill in fills}),
            "last_import": (journal.get("import_runs") or [None])[-1]}


def empty_annotations() -> dict[str, Any]:
    return {"schema": "trade-annotations", "version": 1, "revision": 0,
            "updated_at": None, "annotations": {}}


def load_annotations(path: Path = DEFAULT_ANNOTATIONS) -> dict[str, Any]:
    if not path.exists():
        return empty_annotations()
    document = json.loads(path.read_text())
    if (document.get("schema") != "trade-annotations" or document.get("version") != 1
            or not isinstance(document.get("annotations"), dict)):
        raise ValueError("trade annotations schema is invalid")
    return document


def update_annotations(trade_ids: list[str], reason: str, journal: dict[str, Any],
                       path: Path = DEFAULT_ANNOTATIONS) -> dict[str, Any]:
    if not isinstance(trade_ids, list) or not trade_ids:
        raise ValueError("trade IDs must be a non-empty list")
    trade_ids = list(dict.fromkeys(trade_ids))
    if any(not isinstance(trade_id, str) or not re.fullmatch(r"trade:v1:[0-9a-f]{32}", trade_id)
           for trade_id in trade_ids):
        raise ValueError("trade ID is invalid")
    known_ids = {fill.get("trade_id") for fill in journal.get("fills", [])}
    if any(trade_id not in known_ids for trade_id in trade_ids):
        raise ValueError("trade ID does not exist in the canonical journal")
    if not isinstance(reason, str) or len(reason) > 5000:
        raise ValueError("reason must be a string of at most 5000 characters")
    document = load_annotations(path)
    now = _utc_now()
    clean = reason.strip()
    for trade_id in trade_ids:
        if clean:
            previous = document["annotations"].get(trade_id) or {}
            document["annotations"][trade_id] = {"trade_id": trade_id, "reason": clean,
                "created_at": previous.get("created_at") or now, "updated_at": now}
        else:
            document["annotations"].pop(trade_id, None)
    document["revision"] = int(document.get("revision") or 0) + 1
    document["updated_at"] = now
    _atomic_write(path, document)
    return document


def update_annotation(trade_id: str, reason: str, journal: dict[str, Any],
                      path: Path = DEFAULT_ANNOTATIONS) -> dict[str, Any]:
    return update_annotations([trade_id], reason, journal, path)


if __name__ == "__main__":
    journal, result = import_local_history(ROOT / "data")
    print(json.dumps({"journal": journal_summary(journal), "import": result}, ensure_ascii=False, indent=2))
