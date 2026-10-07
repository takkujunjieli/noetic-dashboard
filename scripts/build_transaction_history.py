#!/usr/bin/env python3
"""Build a private, untruncated transaction snapshot without broker/network calls."""
import json
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def build_history(data=DATA):
    sources, transactions = [], []
    files = sorted(data.glob("_*_raw.json"))
    if not files:
        raise ValueError("No broker raw files; existing transaction history was not changed")
    for path in files:
        raw = json.loads(path.read_text())
        if not isinstance(raw.get("transactions"), list):
            raise ValueError(f"{path.name}: missing transactions")
        broker = raw.get("broker") or path.stem[1:-4]
        accounts = raw.get("accounts") or [{"id": broker}]
        default = accounts[0].get("id") if len(accounts) == 1 else broker
        source_at = raw.get("source_updated_at") or raw.get("updated_at")
        sources.append({"file": path.name, "broker": broker,
                        "source_updated_at": source_at,
                        "accounts": [{"id": a.get("id") or broker,
                                      "source_updated_at": a.get("source_updated_at") or source_at}
                                     for a in accounts],
                        "transaction_count": len(raw["transactions"])})
        for row in raw["transactions"]:
            transactions.append({**row, "broker": broker,
                                 "account": row.get("account") or default,
                                 "kind": row.get("kind") or "equity",
                                 "source_file": path.name})
    return {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
            "coverage": "All locally recorded transactions; broker history completeness is not verified.",
            "sources": sources, "transactions": transactions}


def write_history(data=DATA):
    history = build_history(data)
    target = data / "transaction_history.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(history, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(target)
    print(f"transaction_history.json: {len(history['transactions'])} transactions (no date truncation)")


if __name__ == "__main__":
    write_history()
