#!/usr/bin/env python3
"""Safely merge one normalized broker snapshot into a private raw file.

The snapshot uses the same schema as ``data/_*_raw.json``.  Positions and
open orders are a point-in-time replacement; transactions are append-only and
deduplicated by broker execution id (or immutable trade facts).  The target is
written to a sibling temporary file, parsed again, then atomically replaced.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path


def identity(t):
    execution_id = str(t.get("execution_id") or "").strip()
    if execution_id:
        return ("execution", execution_id)
    return ("facts", str(t.get("ts") or "")[:19], t.get("sym"),
            str(t.get("side") or "").lower(), str(t.get("qty")), str(t.get("price")))


def load(path):
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {path}: {exc}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", type=Path, help="Existing private _*_raw.json")
    ap.add_argument("snapshot", type=Path, help="Normalized fresh broker snapshot JSON")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--transactions-only", action="store_true",
                    help="Keep the existing positions/open-orders snapshot")
    args = ap.parse_args()
    old, fresh = load(args.target), load(args.snapshot)
    if not fresh.get("accounts"):
        raise SystemExit("Snapshot has no accounts; refusing to overwrite positions")
    if "transactions" not in fresh or (not args.transactions_only and "positions" not in fresh):
        raise SystemExit("Snapshot must include transactions (and positions unless --transactions-only)")

    old_accounts = {a.get("id") for a in old.get("accounts", [])}
    fresh_accounts = {a.get("id") for a in fresh.get("accounts", [])}
    if old_accounts and old_accounts != fresh_accounts:
        raise SystemExit(f"Account mismatch: existing={old_accounts}, fresh={fresh_accounts}")

    merged = {**old, **fresh}
    if args.transactions_only:
        merged["positions"] = old.get("positions") or []
        merged["open_orders"] = old.get("open_orders") or []
    history = list(old.get("transactions") or [])
    seen = {identity(t) for t in history}
    added = 0
    for trade in fresh.get("transactions") or []:
        key = identity(trade)
        if key not in seen:
            history.append(trade)
            seen.add(key)
            added += 1
    merged["transactions"] = history
    merged["sync_metadata"] = {**(old.get("sync_metadata") or {}),
                               **(fresh.get("sync_metadata") or {}),
                               "incremental_transactions_added": added}
    payload = json.dumps(merged, ensure_ascii=False, indent=2) + "\n"
    # Parse before touching the target; this catches all generated JSON faults.
    json.loads(payload)
    if args.dry_run:
        print(json.dumps({"positions": len(merged["positions"]), "transactions_added": added}))
        return
    fd, name = tempfile.mkstemp(prefix=args.target.name + ".", suffix=".tmp", dir=args.target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, args.target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(json.dumps({"positions": len(merged["positions"]), "transactions_added": added}))


if __name__ == "__main__":
    main()
