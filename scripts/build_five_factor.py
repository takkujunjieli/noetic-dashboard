#!/usr/bin/env python3
"""Build a static five-factor equity-return decomposition snapshot.

Financial statements come from SEC Company Facts. Prices come from Yahoo Finance
through the public Tigzig wrapper because Yahoo's direct chart endpoint is often
rate-limited. The output is static JSON consumed by the Research page.

The decomposition is:
  P1/P0 = R1/R0 × (OM1/OM0) × ((NI/OI)1/(NI/OI)0)
          × Shares0/Shares1 × PE1/PE0

Only reported GAAP/IFRS values are used. Funds and issuers without enough history
remain in the output with an explicit reason instead of estimated fundamentals.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import ssl
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEC_CACHE = ROOT / "data" / ".five_factor_sec_cache"
SEC_UA = "Noetic Research Desk five-factor study data-quality@example.com"
PRICE_URL = "https://yfin-h.tigzig.com/v1/get-all-prices/"
FORMS = {"10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "6-K"}
PERIODS = {"1y": 1, "3y": 3, "5y": 5}
FUND_TICKERS = {"SOXX", "IGV"}

CONCEPTS = {
    "us-gaap": {
        "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"],
        "operating_income": ["OperatingIncomeLoss"],
        "net_income": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
        "diluted_shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    },
    "ifrs-full": {
        "revenue": ["Revenue", "RevenueFromContractsWithCustomers"],
        "operating_income": ["ProfitLossFromOperatingActivities", "OperatingProfitLoss"],
        "net_income": ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
        "diluted_shares": ["AdjustedWeightedAverageShares", "WeightedAverageNumberOfDilutedSharesOutstanding"],
    },
}


def ssl_context():
    cert = Path("/etc/ssl/cert.pem")
    return ssl.create_default_context(cafile=str(cert) if cert.exists() else None)


def get_bytes(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": SEC_UA})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as response:
        return response.read()


def get_json(url, headers=None):
    return json.loads(get_bytes(url, headers).decode("utf-8"))


def day(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def days_between(start, end):
    return (day(end) - day(start)).days + 1


def valid_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def facts_for(company, namespace, concept, unit):
    facts = company.get("facts", {}).get(namespace, {}).get(concept, {})
    units = facts.get("units", {})
    rows = units.get(unit, [])
    if not rows and unit == "shares":
        rows = units.get("shares", [])
    return [row for row in rows if row.get("form") in FORMS and row.get("start") and row.get("end") and valid_number(row.get("val"))]


def dedupe_periods(rows):
    chosen = {}
    for row in rows:
        key = (row["start"], row["end"])
        rank = (row.get("filed", ""), row.get("accn", ""))
        if key not in chosen or rank > (chosen[key].get("filed", ""), chosen[key].get("accn", "")):
            chosen[key] = row
    return list(chosen.values())


def choose_concept(company, metric):
    unit = "shares" if metric == "diluted_shares" else "USD"
    best = None
    for namespace, groups in CONCEPTS.items():
        for priority, concept in enumerate(groups[metric]):
            rows = dedupe_periods(facts_for(company, namespace, concept, unit))
            direct = sum(1 for row in rows if 60 <= days_between(row["start"], row["end"]) <= 125)
            annual = sum(1 for row in rows if 300 <= days_between(row["start"], row["end"]) <= 430)
            # Companies often retire one revenue/net-income concept and start another.
            # Freshness must dominate row count, otherwise a long but obsolete series can
            # silently turn a 2026 comparison into a 2018 comparison.
            latest = max((row["end"] for row in rows), default="")
            score = (latest, direct + annual * 3, -priority)
            if rows and (best is None or score > best[0]):
                best = (score, namespace, concept, rows)
    return None if best is None else {"namespace": best[1], "concept": best[2], "rows": best[3]}


def quarter_series(selection, average=False):
    rows = selection["rows"]
    direct = {}
    annual = []
    for row in rows:
        duration = days_between(row["start"], row["end"])
        record = {"start": row["start"], "end": row["end"], "value": float(row["val"]),
                  "filed": row.get("filed"), "accn": row.get("accn"), "days": duration, "derived": False}
        if 60 <= duration <= 125:
            old = direct.get(row["end"])
            rank = (abs(duration - 91), -(day(row.get("filed", "1900-01-01")).toordinal()))
            old_rank = (abs(old["days"] - 91), -(day(old.get("filed") or "1900-01-01").toordinal())) if old else None
            if old is None or rank < old_rank:
                direct[row["end"]] = record
        elif 300 <= duration <= 430:
            annual.append(record)

    # Q4 is normally not reported separately. Derive it from FY less Q1-Q3.
    for year in sorted(annual, key=lambda x: x["end"]):
        inside = [q for q in direct.values() if day(year["start"]) <= day(q["start"]) and day(q["end"]) < day(year["end"])]
        inside.sort(key=lambda x: x["end"])
        nonoverlap = []
        for q in inside:
            if not nonoverlap or day(q["start"]) > day(nonoverlap[-1]["end"]):
                nonoverlap.append(q)
        if len(nonoverlap) < 3:
            continue
        qs = nonoverlap[-3:]
        missing_start = day(qs[-1]["end"]) + timedelta(days=1)
        missing_days = (day(year["end"]) - missing_start).days + 1
        if not 60 <= missing_days <= 125 or year["end"] in direct:
            continue
        if average:
            numerator = year["value"] * year["days"] - sum(q["value"] * q["days"] for q in qs)
            value = numerator / missing_days
        else:
            value = year["value"] - sum(q["value"] for q in qs)
        direct[year["end"]] = {"start": missing_start.isoformat(), "end": year["end"], "value": value,
                               "filed": year["filed"], "accn": year["accn"], "days": missing_days, "derived": True}
    return direct


def split_factor_after(splits, filed):
    if not filed:
        return 1.0
    factor = 1.0
    for split_date, ratio in splits:
        if split_date > filed and ratio > 0:
            factor *= ratio
    return factor


def ttm_series(quarters, average=False, splits=None):
    out = []
    ordered = [quarters[key] for key in sorted(quarters)]
    for index in range(3, len(ordered)):
        window = ordered[index - 3:index + 1]
        if any((day(window[i]["start"]) - day(window[i - 1]["end"])).days not in range(1, 12) for i in range(1, 4)):
            continue
        span = days_between(window[0]["start"], window[-1]["end"])
        if not 320 <= span <= 430:
            continue
        values = []
        for q in window:
            value = q["value"]
            if average and splits:
                value *= split_factor_after(splits, q.get("filed"))
            values.append(value)
        value = (sum(v * q["days"] for v, q in zip(values, window)) / sum(q["days"] for q in window)) if average else sum(values)
        out.append({"end": window[-1]["end"], "value": value,
                    "filed": max((q.get("filed") or "") for q in window),
                    "accessions": sorted({q.get("accn") for q in window if q.get("accn")})})
    return {row["end"]: row for row in out}


def annual_series(selection, average=False, splits=None):
    """Annual filings are valid TTM observations and cover semiannual foreign filers."""
    out = {}
    for row in selection["rows"]:
        duration = days_between(row["start"], row["end"])
        if not 300 <= duration <= 430:
            continue
        value = float(row["val"])
        if average and splits:
            value *= split_factor_after(splits, row.get("filed"))
        record = {"end": row["end"], "value": value, "filed": row.get("filed") or "",
                  "accessions": [row["accn"]] if row.get("accn") else []}
        old = out.get(row["end"])
        if old is None or record["filed"] > old["filed"]:
            out[row["end"]] = record
    return out


def parse_prices(raw):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    prices, splits = {}, {}
    for row in reader:
        ticker = row.get("Ticker")
        if not ticker:  # Single ticker responses omit the Ticker column; not used by the batch builder.
            continue
        close = row.get("C")
        if close:
            prices.setdefault(ticker, {})[row["Date"]] = float(close)
        ratio = row.get("Split")
        if ratio and float(ratio):
            splits.setdefault(ticker, []).append((row["Date"], float(ratio)))
    return prices, splits


def fetch_prices(tickers, start, end):
    prices, splits = {}, {}
    for offset in range(0, len(tickers), 10):
        batch = tickers[offset:offset + 10]
        query = urllib.parse.urlencode({"tickers": ",".join(batch), "start_date": start, "end_date": end, "format": "csv"})
        raw = get_bytes(f"{PRICE_URL}?{query}", {"User-Agent": "Mozilla/5.0 (Noetic Research Desk)"}, timeout=180)
        batch_prices, batch_splits = parse_prices(raw)
        prices.update(batch_prices)
        splits.update(batch_splits)
        time.sleep(0.2)
    return prices, splits


def price_at(series, target):
    eligible = [value for key, value in series.items() if key <= target]
    dates = [key for key in series if key <= target]
    if not dates:
        return None
    best = max(dates)
    return {"date": best, "value": series[best]}


def shift_year(value, years):
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, day=28)


def select_ttm(series, target):
    keys = [key for key in series if key <= target]
    return series[max(keys)] if keys else None


def ttm_is_fresh(snapshot, target, max_age_days=550):
    """Allow reporting lag, but reject obsolete facts and same-snapshot comparisons."""
    return snapshot is not None and 0 <= (target - day(snapshot["ttm_end"])).days <= max_age_days


def company_snapshots(company, split_events):
    chosen = {metric: choose_concept(company, metric) for metric in CONCEPTS["us-gaap"]}
    if any(value is None for value in chosen.values()):
        missing = [key for key, value in chosen.items() if value is None]
        return None, chosen, f"SEC facts missing: {', '.join(missing)}"
    series = {}
    for metric, selection in chosen.items():
        quarters = quarter_series(selection, average=metric == "diluted_shares")
        annual = annual_series(selection, average=metric == "diluted_shares", splits=split_events)
        quarterly_ttm = ttm_series(quarters, average=metric == "diluted_shares", splits=split_events)
        series[metric] = {**annual, **quarterly_ttm}
    common = set.intersection(*(set(values) for values in series.values())) if series else set()
    snapshots = {}
    for end in sorted(common):
        values = {metric: series[metric][end]["value"] for metric in series}
        if values["revenue"] <= 0 or values["diluted_shares"] <= 0:
            continue
        snapshots[end] = {"ttm_end": end, **values,
                          "filed": max(series[metric][end]["filed"] for metric in series),
                          "accessions": sorted(set(sum((series[metric][end]["accessions"] for metric in series), [])))}
    if not snapshots:
        return None, chosen, "No four-quarter SEC TTM history with aligned concepts"
    return snapshots, chosen, None


def build(as_of):
    cfg = json.loads((ROOT / "config" / "tickers.json").read_text())
    tickers = cfg["watchlist"]
    mapping = get_json("https://www.sec.gov/files/company_tickers.json", {"User-Agent": SEC_UA})
    by_ticker = {value["ticker"].upper(): value for value in mapping.values()}
    start = shift_year(as_of, 6) - timedelta(days=45)
    prices, splits = fetch_prices(tickers, start.isoformat(), (as_of + timedelta(days=1)).isoformat())
    periods = {period: [] for period in PERIODS}
    SEC_CACHE.mkdir(parents=True, exist_ok=True)

    for number, ticker in enumerate(tickers, 1):
        print(f"[{number}/{len(tickers)}] {ticker}", flush=True)
        mapping_row = by_ticker.get(ticker)
        company = None
        reason = None
        concepts = {}
        snapshots = None
        cik = None
        entity = None
        if ticker in FUND_TICKERS:
            reason = "Investment fund: issuer-level revenue decomposition is not applicable"
        elif not mapping_row:
            reason = "Ticker not present in SEC company mapping"
        else:
            cik = str(mapping_row["cik_str"]).zfill(10)
            entity = mapping_row["title"]
            cache = SEC_CACHE / f"CIK{cik}.json"
            if cache.exists():
                company = json.loads(cache.read_text())
            else:
                try:
                    company = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", {"User-Agent": SEC_UA})
                    cache.write_text(json.dumps(company))
                    time.sleep(0.12)
                except Exception as error:  # noqa: BLE001
                    reason = f"SEC Company Facts unavailable: {error}"
            if company:
                snapshots, concepts, reason = company_snapshots(company, splits.get(ticker, []))

        current_price = price_at(prices.get(ticker, {}), as_of.isoformat())
        for period, years in PERIODS.items():
            target = shift_year(as_of, years)
            prior_price = price_at(prices.get(ticker, {}), target.isoformat())
            row = {"ticker": ticker, "entity": entity, "cik": cik, "status": "ok", "reason": None,
                   "current": None, "prior": None}
            if reason:
                row.update(status="unavailable", reason=reason)
            elif not current_price or not prior_price:
                row.update(status="unavailable", reason=f"Split-adjusted price history unavailable for {period.upper()}")
            else:
                current_ttm = select_ttm(snapshots, as_of.isoformat())
                prior_ttm = select_ttm(snapshots, target.isoformat())
                if not current_ttm or not prior_ttm:
                    row.update(status="unavailable", reason=f"Insufficient four-quarter SEC history for {period.upper()}")
                elif not ttm_is_fresh(current_ttm, as_of) or not ttm_is_fresh(prior_ttm, target):
                    row.update(status="unavailable", reason=f"SEC TTM snapshot is stale for {period.upper()}")
                elif current_ttm["ttm_end"] == prior_ttm["ttm_end"]:
                    row.update(status="unavailable", reason=f"Distinct SEC TTM snapshots unavailable for {period.upper()}")
                else:
                    row["current"] = {**current_ttm, "price": current_price["value"], "price_date": current_price["date"]}
                    row["prior"] = {**prior_ttm, "price": prior_price["value"], "price_date": prior_price["date"]}
                    row["concepts"] = {metric: f"{item['namespace']}:{item['concept']}" for metric, item in concepts.items()}
            periods[period].append(row)

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": as_of.isoformat(),
        "methodology": "Latest available SEC-filed TTM on or before each comparison date; split-adjusted closes; currently restated facts.",
        "sources": {
            "financials": "https://data.sec.gov/api/xbrl/companyfacts/",
            "prices": "Yahoo Finance via https://yfin-h.tigzig.com/v1/get-all-prices/",
            "ticker_mapping": "https://www.sec.gov/files/company_tickers.json",
        },
        "periods": periods,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--output", default=str(ROOT / "data" / "five_factor.json"))
    args = parser.parse_args()
    result = build(day(args.as_of))
    output = Path(args.output)
    output.write_text(json.dumps(result, indent=2) + "\n")
    for period, rows in result["periods"].items():
        ok = sum(row["status"] == "ok" for row in rows)
        print(f"{period}: {ok}/{len(rows)} complete")
    print(output)


if __name__ == "__main__":
    main()
