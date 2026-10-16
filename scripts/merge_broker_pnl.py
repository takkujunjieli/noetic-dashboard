#!/usr/bin/env python3
"""Atomically merge normalized broker realized-P&L events into a private ledger.

Input is a JSON object with ``updated_at`` and ``events``. Every event requires
account, timestamp, symbol, quantity, price and realized_gain. Events are never
recomputed from fills: the broker P&L endpoint remains the source of truth.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path


def load(path, default=None):
    if not path.exists() and default is not None:
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {path}: {exc}")


def key(event):
    required = ("account", "timestamp", "symbol", "quantity", "price", "realized_gain")
    if any(not isinstance(event.get(field), str) for field in required):
        raise SystemExit("Every P&L event must contain string account/timestamp/symbol/quantity/price/realized_gain")
    return tuple(event[field] for field in required)


def atomic_write(path, value):
    data = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    json.loads(data)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ledger", type=Path)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    old = load(args.ledger, {"schema": "broker-realized-pnl", "version": 1, "updated_at": None, "events": []})
    fresh = load(args.snapshot)
    if old.get("schema") != "broker-realized-pnl" or old.get("version") != 1 or not isinstance(old.get("events"), list):
        raise SystemExit("Invalid P&L ledger")
    if not isinstance(fresh.get("events"), list):
        raise SystemExit("Snapshot has no events")
    seen = {key(event) for event in old["events"]}
    events = list(old["events"])
    added = 0
    for event in fresh["events"]:
        event_key = key(event)
        if event_key not in seen:
            events.append(event)
            seen.add(event_key)
            added += 1
    merged = {"schema": "broker-realized-pnl", "version": 1,
              "updated_at": fresh.get("updated_at") or old.get("updated_at"), "events": events}
    if args.dry_run:
        print(json.dumps({"events": len(events), "added": added}))
        return
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(args.ledger, merged)
    print(json.dumps({"events": len(events), "added": added}))


if __name__ == "__main__":
    main()
