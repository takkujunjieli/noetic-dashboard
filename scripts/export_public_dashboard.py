#!/usr/bin/env python3
"""Export an allowlisted, anonymous Portfolio/Workflow snapshot. Never publish the input."""
import argparse
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT.parent / "stock-dashboard-private"
KEY = "research-desk.workflow.v1"
NODES = ("hypothesis", "construction", "returns", "risk", "positions", "attribution")
KINDS = ("stock", "call", "put", "option")
SIDES = ("long", "short")
HIDDEN = None
ELEMENTS = tuple("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split())
NEBULAE = ("猎户座星云", "船底座星云", "鹰状星云", "蟹状星云", "螺旋星云", "环状星云", "礁湖星云", "三裂星云",
           "玫瑰星云", "猫眼星云", "沙漏星云", "哑铃星云", "马头星云", "火焰星云", "面纱星云", "泡泡星云",
           "新月星云", "加州星云", "北美星云", "灵魂星云", "心脏星云", "蝴蝶星云", "土星星云", "铅笔星云")


def atomic_json(path, value, private=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".public-export-", delete=False) as f:
            name = Path(f.name)
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write("\n")
        os.chmod(name, 0o600 if private else 0o644)
        name.replace(path)
    finally:
        if name and name.exists():
            name.unlink()


def underlying(value):
    # Option display symbols contain expiry/strike; only their root gets an alias.
    return str(value or "").strip().split(" ")[0].upper()


class Aliases:
    """Random aliases, persisted exclusively beside the private source files."""
    def __init__(self, book=None):
        self.book = book if book is not None else {}
        self.reserved = set()
        for kind in ("symbols", "accounts", "cases", "plans", "nebulaNames"):
            self.book.setdefault(kind, {})

    def get(self, kind, value):
        value = str(value or "unknown")
        mapping = self.book[kind]
        if kind == "symbols" and mapping.get(value) not in ELEMENTS:
            mapping.pop(value, None)  # Migrate unpublished four-letter aliases to element symbols.
        if value not in mapping:
            if kind in ("symbols", "nebulaNames"):
                pool = ELEMENTS if kind == "symbols" else NEBULAE
                available = [name for name in pool if name not in mapping.values()
                             and (kind != "symbols" or name.upper() not in self.reserved)]
                if not available:
                    raise ValueError("公开化名已用完，请扩展元素/星云名称列表后再导出")
                mapping[value] = secrets.choice(available)
                return mapping[value]
            while True:
                alias = {"accounts": "account-", "cases": "nebula-", "plans": "bundle-"}[kind] + secrets.token_hex(6)
                if alias not in mapping.values():
                    mapping[value] = alias
                    break
        return mapping[value]

    def symbol(self, value):
        return self.get("symbols", underlying(value)) if value else ""


def state(value):
    return "pending" if value in (None, "", "draft", "unconfigured", "pending", "unchecked", "unlinked", "reconcile") else "running"


def enum(value, choices, default):
    return value if value in choices else default


def export_snapshot(portfolio, workflow, aliases):
    """Construct every output field explicitly; unknown fields, prose and snapshots are dropped."""
    if not isinstance(portfolio, dict) or not isinstance(portfolio.get("positions"), list):
        raise ValueError("Portfolio source is missing positions")
    store = workflow.get("entries", {}).get(KEY) if isinstance(workflow, dict) and "entries" in workflow else workflow
    if not isinstance(store, dict) or not isinstance(store.get("cases"), list):
        raise ValueError("Workflow source is missing cases")
    def reserve(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ("sym", "symbol", "underlying") and isinstance(item, str):
                    aliases.reserved.add(underlying(item))
                elif key in ("linkedSymbols", "portfolioUnderlyings") and isinstance(item, list):
                    aliases.reserved.update(underlying(s) for s in item if isinstance(s, str))
                elif key not in ("events", "snapshot"):
                    reserve(item)
        elif isinstance(value, list):
            for item in value:
                reserve(item)
    reserve(portfolio)
    reserve(store)
    for raw, alias in list(aliases.book["symbols"].items()):
        if alias.upper() in aliases.reserved:
            del aliases.book["symbols"][raw]
    accounts = []
    for account in portfolio.get("accounts", []):
        aid = aliases.get("accounts", account.get("id"))
        accounts.append({"id": aid, "label": "账户 " + aid.removeprefix("account-")[:4].upper(),
                         "equity": HIDDEN, "realizedPnl": HIDDEN, "unrealizedPnl": HIDDEN, "returnPct": HIDDEN})
    positions = []
    for p in portfolio["positions"]:
        kind = "stock" if p.get("kind") in ("equity", "stock") else "option"
        positions.append({"account": aliases.get("accounts", p.get("account")), "symbol": aliases.symbol(p.get("sym")),
                          "kind": kind, "side": "short" if isinstance(p.get("qty"), (float, int)) and p["qty"] < 0 else "long",
                          "qty": HIDDEN, "price": HIDDEN, "cost": HIDDEN, "marketValue": HIDDEN,
                          "pnl": HIDDEN, "pnlPct": HIDDEN, "weight": HIDDEN})
    cases = []
    for c in store["cases"]:
        cid = aliases.get("cases", c.get("id"))
        symbols = set()
        for s in [c.get("symbol"), *(c.get("linkedSymbols") or []), *(c.get("portfolioUnderlyings") or [])]:
            if isinstance(s, str) and s:
                symbols.add(aliases.symbol(s))
        plans = []
        for p in c.get("design", {}).get("plans", []):
            legs = []
            for leg in p.get("construction", {}).get("legs", []):
                symbol = aliases.symbol(leg.get("underlying"))
                if symbol:
                    symbols.add(symbol)
                legs.append({"symbol": symbol, "type": enum(leg.get("type"), KINDS, "stock"),
                             "side": enum(leg.get("side"), SIDES, "long"), "qty": HIDDEN,
                             "entry": HIDDEN, "strike": HIDDEN, "expiry": HIDDEN,
                             "delta": HIDDEN, "gamma": HIDDEN, "theta": HIDDEN, "vega": HIDDEN})
            plans.append({"id": aliases.get("plans", cid + ":" + str(p.get("id"))), "name": "…",
                          "frozen": p.get("frozen") is True, "legs": legs})
        # Legacy Construction may predate the Bundle design model.
        if not plans:
            for leg in c.get("nodes", {}).get("construction", {}).get("data", {}).get("legs", []):
                symbol = aliases.symbol(leg.get("underlying"))
                if symbol:
                    symbols.add(symbol)
        nodes = {key: {"state": state(c.get("nodes", {}).get(key, {}).get("state"))} for key in NODES}
        events = []
        for index, event in enumerate(c.get("events", [])):
            if event.get("node") not in NODES:
                continue
            snapshot_nodes = event.get("snapshot", {}).get("nodes", {})
            events.append({"id": "event-" + str(index + 1), "node": event["node"], "reason": "…",
                           "states": {key: state(snapshot_nodes.get(key, {}).get("state")) for key in NODES}})
        cases.append({"id": cid, "title": aliases.get("nebulaNames", c.get("id")), "symbols": sorted(symbols), "archived": c.get("archived") is True,
                      "activeThesis": c.get("activeThesis") is True, "nodes": nodes, "plans": plans, "events": events})
    result = {"schema": "anonymous-dashboard", "version": 1,
              "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "portfolio": {"accounts": sorted(accounts, key=lambda a: a["id"]),
                            "positions": sorted(positions, key=lambda p: (p["symbol"], p["account"], p["kind"]))},
              "workflow": {"cases": cases}}
    validate_public_snapshot(result)
    return result


def validate_public_snapshot(data):
    """Reject unknown fields, numeric financial values and arbitrary text in a publishable snapshot."""
    def fields(obj, expected):
        if not isinstance(obj, dict) or set(obj) != set(expected):
            raise ValueError("Unexpected public snapshot fields")
    def pattern(value, regex):
        if not isinstance(value, str) or not re.fullmatch(regex, value):
            raise ValueError("Invalid public alias or state")
    def hidden(obj, keys):
        if any(obj[k] is not None for k in keys):
            raise ValueError("Financial values must be removed before publishing")
    def states(obj):
        fields(obj, NODES)
        for s in obj.values():
            pattern(s, "pending|running")
    fields(data, ("schema", "version", "publishedAt", "portfolio", "workflow"))
    if data["schema"] != "anonymous-dashboard" or data["version"] != 1:
        raise ValueError("Invalid public schema")
    pattern(data["publishedAt"], r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00")
    fields(data["portfolio"], ("accounts", "positions"))
    for a in data["portfolio"]["accounts"]:
        fields(a, ("id", "label", "equity", "realizedPnl", "unrealizedPnl", "returnPct"))
        pattern(a["id"], r"account-[a-f0-9]{12}")
        if a["label"] != "账户 " + a["id"][8:12].upper():
            raise ValueError("Invalid account label")
        hidden(a, ("equity", "realizedPnl", "unrealizedPnl", "returnPct"))
    for p in data["portfolio"]["positions"]:
        fields(p, ("account", "symbol", "kind", "side", "qty", "price", "cost", "marketValue", "pnl", "pnlPct", "weight"))
        pattern(p["account"], r"account-[a-f0-9]{12}")
        if p["symbol"] not in ELEMENTS:
            raise ValueError("Ticker aliases must use element symbols")
        pattern(p["kind"], "stock|option")
        pattern(p["side"], "long|short")
        hidden(p, ("qty", "price", "cost", "marketValue", "pnl", "pnlPct", "weight"))
    fields(data["workflow"], ("cases",))
    for c in data["workflow"]["cases"]:
        fields(c, ("id", "title", "symbols", "archived", "activeThesis", "nodes", "plans", "events"))
        pattern(c["id"], r"nebula-[a-f0-9]{12}")
        if c["title"] not in NEBULAE or type(c["archived"]) is not bool or type(c["activeThesis"]) is not bool:
            raise ValueError("Private case metadata is not publishable")
        for s in c["symbols"]:
            if s not in ELEMENTS:
                raise ValueError("Ticker aliases must use element symbols")
        fields(c["nodes"], NODES)
        for n in c["nodes"].values():
            fields(n, ("state",))
            pattern(n["state"], "pending|running")
        for p in c["plans"]:
            fields(p, ("id", "name", "frozen", "legs"))
            pattern(p["id"], r"bundle-[a-f0-9]{12}")
            if p["name"] != "…" or type(p["frozen"]) is not bool:
                raise ValueError("Private Bundle metadata is not publishable")
            for l in p["legs"]:
                fields(l, ("symbol", "type", "side", "qty", "entry", "strike", "expiry", "delta", "gamma", "theta", "vega"))
                if l["symbol"] not in (*ELEMENTS, ""):
                    raise ValueError("Ticker aliases must use element symbols")
                pattern(l["type"], "stock|call|put|option")
                pattern(l["side"], "long|short")
                hidden(l, ("qty", "entry", "strike", "expiry", "delta", "gamma", "theta", "vega"))
        for e in c["events"]:
            fields(e, ("id", "node", "reason", "states"))
            pattern(e["id"], r"event-\d+")
            pattern(e["node"], "|".join(NODES))
            if e["reason"] != "…":
                raise ValueError("Private event prose is not publishable")
            states(e["states"])
    return data


def write_public_snapshot(portfolio_path=ROOT / "data/portfolio.json", workflow_path=PRIVATE / "workflow.json",
                          output=ROOT / "data/public-dashboard.json", aliases_path=PRIVATE / "public_aliases.json", workflow=None):
    aliases_path, output = Path(aliases_path), Path(output)
    # Never permit the private reverse mapping to be written under the public checkout.
    if aliases_path.resolve().is_relative_to(ROOT):
        raise ValueError("Alias mapping must stay outside the public repository")
    portfolio = json.loads(Path(portfolio_path).read_text())
    workflow = workflow if workflow is not None else json.loads(Path(workflow_path).read_text())
    aliases = Aliases(json.loads(aliases_path.read_text()) if aliases_path.exists() else None)
    result = export_snapshot(portfolio, workflow, aliases)
    atomic_json(aliases_path, aliases.book, private=True)
    atomic_json(output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portfolio", type=Path, default=ROOT / "data/portfolio.json")
    parser.add_argument("--workflow", type=Path, default=PRIVATE / "workflow.json")
    parser.add_argument("--aliases", type=Path, default=PRIVATE / "public_aliases.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/public-dashboard.json")
    args = parser.parse_args()
    result = write_public_snapshot(args.portfolio, args.workflow, args.output, args.aliases)
    print(f"Anonymous snapshot: {len(result['portfolio']['positions'])} positions / {len(result['workflow']['cases'])} Nebulae")


if __name__ == "__main__":
    main()
