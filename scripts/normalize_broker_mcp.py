#!/usr/bin/env python3
"""Normalize saved MCP responses for one real brokerage account.

Input JSON contains source_updated_at and the broker responses captured in
the same run. Missing prices or incomplete pages are errors, never zeroes.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def number(value, field):
    if value is None or value == "":
        raise ValueError(f"Missing {field}")
    return float(value)


def moomoo_time(value):
    return datetime.fromtimestamp(int(value) / 1_000_000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def transaction(account, kind, symbol, side, quantity, price, timestamp, execution_id, order_id):
    if not all((symbol, side, timestamp, execution_id)):
        raise ValueError("Incomplete broker execution")
    return {"account": account, "kind": kind, "sym": symbol, "side": side,
            "qty": number(quantity, "execution quantity"), "price": number(price, "execution price"),
            "ts": timestamp, "execution_id": str(execution_id), "order_id": str(order_id),
            "state": "filled"}


def robinhood(data, account):
    quotes = {x["quote"]["symbol"]: x["quote"] for x in data["equity_quotes"] if x and x.get("quote")}
    positions = []
    for item in data["equity_positions"]:
        symbol = item["symbol"]
        quote = quotes.get(symbol)
        if not quote or not quote.get("last_trade_price") or not quote.get("venue_last_trade_time"):
            raise ValueError(f"Missing Robinhood quote for {symbol}")
        quantity = number(item["quantity"], "position quantity")
        cost = number(item["average_buy_price"], "average buy price")
        price = number(quote["last_trade_price"], "last trade price")
        positions.append({"account": account, "kind": "equity", "sym": symbol,
                          "qty": quantity, "avg_cost": cost, "price": price,
                          "mkt_value": round(quantity * price, 2),
                          "pnl": round(quantity * (price - cost), 2),
                          "price_as_of": quote["venue_last_trade_time"], "price_source": "Robinhood MCP"})
    option_positions = data.get("option_positions", [])
    if option_positions:
        instruments = {x["id"]: x for x in data.get("option_instruments", [])}
        option_quotes = {x["quote"]["instrument_id"]: x["quote"] for x in data.get("option_quotes", []) if x and x.get("quote")}
        for item in option_positions:
            instrument = instruments.get(item["option_id"])
            quote = option_quotes.get(item["option_id"])
            if not instrument or not quote:
                raise ValueError(f"Missing option instrument/quote for {item['option_id']}")
            multiplier = number(item["trade_value_multiplier"], "option multiplier")
            quantity = number(item["quantity"], "option quantity")
            cost = number(item["average_price"], "option cost") * multiplier
            price = number(quote["mark_price"], "option mark") * multiplier
            suffix = "C" if instrument["type"].lower() == "call" else "P"
            symbol = f"{item['chain_symbol']} {instrument['expiration_date']} {number(instrument['strike_price'], 'strike'):g}{suffix}"
            positions.append({"account": account, "kind": "option", "sym": symbol,
                              "instrument_id": item["option_id"], "multiplier": multiplier,
                              "qty": quantity, "avg_cost": cost, "price": price,
                              "mkt_value": round(quantity * price, 2),
                              "pnl": round(quantity * (price - cost), 2),
                              "price_as_of": quote["updated_at"], "price_source": "Robinhood MCP"})
    transactions = []
    for order in data["equity_orders"]:
        for execution in order.get("executions") or []:
            transactions.append(transaction(account, "equity", order["symbol"], order["side"],
                                            execution["quantity"], execution["price"], execution["timestamp"],
                                            execution["id"], order["id"]))
    for order in data.get("option_orders", []):
        for leg in order.get("legs") or []:
            suffix = "C" if leg["option_type"].lower() == "call" else "P"
            symbol = f"{order['chain_symbol']} {leg['expiration_date']} {number(leg['strike_price'], 'strike'):g}{suffix}"
            multiplier = number(order["trade_value_multiplier"], "option multiplier")
            for execution in leg.get("executions") or []:
                transactions.append(transaction(account, "option", symbol, leg["side"],
                                                execution["quantity"], number(execution["price"], "option execution price") * multiplier,
                                                execution["timestamp"], execution["id"], order["id"]))
    portfolio = data.get("portfolio", {})
    summary = None
    if portfolio:
        summary = {"total_value": number(portfolio["total_value"], "total value"),
                   "cash": number(portfolio["cash"], "cash"),
                   "buying_power": number(portfolio["buying_power"]["buying_power"], "buying power")}
    return positions, transactions, summary


def moomoo(data, account):
    positions = []
    for item in data["positions"]:
        if item.get("currency") != "USD":
            raise ValueError(f"Unexpected Moomoo position currency: {item.get('currency')}")
        quantity = number(item["qty"], "position quantity")
        price = number(item["nominal_price"], "position price")
        cost = number(item["cost_price"], "position cost")
        symbol = item["code"].removeprefix("US.")
        kind = "option" if item.get("security_type") == "OPTION" else "equity"
        positions.append({"account": account, "kind": kind, "sym": symbol, "qty": quantity,
                          "avg_cost": cost, "price": price, "mkt_value": number(item["market_val"], "market value"),
                          "pnl": number(item["unrealized_pl"], "unrealized P&L"),
                          "price_as_of": data["source_updated_at"], "price_source": "Moomoo MCP"})
    transactions = []
    for fill in data["fills"]:
        if fill.get("status") != "OK":
            continue
        symbol = fill["code"].removeprefix("US.")
        transactions.append(transaction(account, "equity", symbol, fill["trd_side"].lower(),
                                        fill["qty"], fill["price"], moomoo_time(fill["create_time"]),
                                        fill["deal_id"], fill["order_id"]))
    funds = data.get("funds", {})
    summary = None
    if funds:
        summary = {"total_assets": number(funds["total_assets"], "total assets"),
                   "cash": number(funds["cash"], "cash"),
                   "buying_power": number(funds["power"], "buying power")}
    return positions, transactions, summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--broker", choices=("robinhood", "moomoo"), required=True)
    parser.add_argument("--account", required=True, help="Private dashboard account ID, never an agentic account")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.input.read_text())
    if not data.get("source_updated_at"):
        raise SystemExit("Missing broker read timestamp")
    if data.get("account_id") != args.account:
        raise SystemExit("Account ID mismatch")
    if data.get("incomplete_pages"):
        raise SystemExit("Broker result pagination is incomplete")
    required = ("equity_positions", "equity_quotes", "equity_orders") if args.broker == "robinhood" else ("positions", "fills")
    if any(not isinstance(data.get(name), list) for name in required):
        raise SystemExit(f"Missing broker data list: {required}")
    positions, transactions, summary = (robinhood(data, args.account) if args.broker == "robinhood"
                                        else moomoo(data, args.account))
    if not positions:
        raise SystemExit("Empty positions snapshot; check account before replacing")
    output = {"broker": "rh" if args.broker == "robinhood" else "moomoo",
              "accounts": [{"id": args.account, "source_updated_at": data["source_updated_at"]}],
              "positions": positions, "transactions": transactions,
              "source_updated_at": data["source_updated_at"],
              "sync_metadata": {"normalizer": "normalize_broker_mcp.py"}}
    if summary:
        output["portfolio_summary"] = summary
        output["accounts"][0]["equity"] = summary.get("total_value", summary.get("total_assets"))
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"positions": len(positions), "transactions": len(transactions)}))


if __name__ == "__main__":
    main()
