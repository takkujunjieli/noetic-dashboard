# Retail investment usefulness — PIT v1

This protocol replaces pooled historical correlations. Existing raw history has no
frozen signal timestamps and is **not** relabeled as a point-in-time backtest.

## Formation and execution

`build_retailflow.py` observes the current raw store, selects the latest completed
XNYS session, and freezes a signal snapshot with its actual UTC formation time.
The execution session is the first session whose open is strictly after formation.
Snapshots are append-only (one per execution session and protocol version), persist
outside the 30-day raw rolling window, and are not rewritten by reruns or backfills.
No snapshot is created if the latest completed session has no raw observations.
Partial universes remain partial and are not later enlarged using hindsight.

The primary signal is `z(netbuy) * z(intensity)`. Each z-score uses only the previous
20 XNYS sessions, excluding the source day, with at least 5 valid observations and
nonzero sample variance. The raw observations used for normalization need only be
available at the actual formation timestamp; they do not create historical signals.
Google Trends is display-only because the existing retrieval process does not
preserve historical availability/vintages. Raw netbuy is a prespecified comparator.
The sign of the product is not necessarily the sign of net buying.

## Forward labels

XNYS sessions account for holidays, daylight saving time, and early closes. Both
the tick collector and evaluator use this calendar. Given entry session e:

- 1D: close(e) / open(e) - 1.
- 5D: close(e+4) / open(e) - 1.

Only closed exit sessions receive labels. Daily bars are collected independently
from flow observations, including tickers subsequently removed from the watchlist.
The whole evaluation range for a ticker is refreshed together for consistent split
adjustments. These are split-adjusted price returns, not dividend-inclusive total
returns. Provider corrections can revise outcome labels, but not frozen signals.
API failures are recorded without falling back to stale split-adjustment regimes.

## IC and ICIR

For each entry date, Spearman correlation is computed across stocks with paired
signals and returns, using average ranks for ties and a minimum of 10 names.
Coverage counts are shown; missing outcomes can still bias available-case IC.
Constant signal/return cross sections yield no IC. Mean IC is the equally weighted
mean across valid dates; ICIR is mean IC divided by sample standard deviation of
those daily ICs. ICIR is not annualized and is not a significance test. Under 60
valid IC dates is labeled insufficient; 60 or more is still descriptive only.

## Quantile portfolios

Five groups are assigned using frozen signals alone, before accessing outcome
prices. There must be at least 10 eligible names. Each group is equal-weighted.
If tied signals cross a group boundary, the portfolio observation is omitted rather
than resolving the economic portfolio arbitrarily by ticker. Missing any frozen
constituent return invalidates the entire portfolio batch, with no re-sorting or
renormalizing surviving constituents. Membership and coverage remain in the output.

Gross spread is Q5 minus Q1: 100% long and 100% short (200% gross exposure).
A fixed illustrative 5 bp per leg per side reduces each completed batch by 20 bp.
This assumes opening and closing the whole batch and excludes borrow costs,
borrow availability, market impact, and dividend cash flows. Cost-adjusted return
is not evidence that these portfolios are executable at the observed open/close.

5D batches overlap. We show mean batch returns, not a compounded equity curve,
annualized Sharpe, or independent-observation p-values. Capital allocation across
staggered sleeves and overlap-robust inference are outside this first protocol.

## Files and operation

- `data/retail_pit.json`: permanent frozen signal/universe ledger.
- `data/retail_prices.json`: refreshed outcome bars and fetch errors.
- `data/retailflow.json`: raw observations, frozen signal display, daily research.
- `scripts/retail_pit.py`: formation, calendar, IC, quantile evaluation.
- `tests/test_retail_pit.py`: deterministic temporal and portfolio invariants.

Workflow: collect ticks → optional Trends → freeze → fetch outcome prices →
rebuild research → commit artifacts → deploy. Workflow concurrency is serialized.
A separate ledger protects frozen signals from the raw data retention policy.
The original filtered watchlist is a selected universe, not an unbiased historical
market universe. Current results cannot establish usefulness until enough actual
out-of-sample sessions have accumulated.

Run locally with the repository requirements installed:

```sh
python -m unittest discover -s tests -p 'test_retail_pit.py' -v
python scripts/build_retailflow.py
python scripts/fetch_retail_prices.py
python scripts/build_retailflow.py
```
