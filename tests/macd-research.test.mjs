import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBars, analyzeUniverse, buildSnapshot, completePairStats, macd, subtractCalendar } from "../assets/macd-research.mjs";

const DAY = 86400000;
const bars = (closes, start = Date.UTC(2026, 2, 24)) => closes.map((close, index) => [start + index * DAY, close, close, close, close, 1, close]);

test("MACD uses the same 12/26/9 warm-up as the trading chart", () => {
  const result = macd(Array.from({ length: 40 }, (_, index) => 100 + index));
  assert.equal(result.main.slice(0, 25).every((value) => value == null), true);
  assert.equal(result.histogram.slice(0, 33).every((value) => value == null), true);
  assert.equal(Number.isFinite(result.histogram[33]), true);
});

test("calendar period cutoffs preserve month-end semantics", () => {
  assert.equal(subtractCalendar("2026-09-30", "3m"), "2026-06-30");
  assert.equal(subtractCalendar("2026-05-31", "3m"), "2026-02-28");
  assert.equal(subtractCalendar("2026-09-23", "all"), null);
});

test("total return sums complete long pairs and resets at the selected range", () => {
  const closes = [100, 110, 121, 100, 120];
  const signal = [-1, 1, -1, 1, -1];
  const all = completePairStats(closes, signal), later = completePairStats(closes, signal, 2);
  assert.equal(all.trades, 2);
  assert.ok(Math.abs(all.totalReturn - 0.3) < 1e-12);
  assert.equal(later.trades, 1);
  assert.ok(Math.abs(later.totalReturn - 0.2) < 1e-12);
});

test("6m, 1y and all share the same result when MACD becomes valid inside six months", () => {
  const closes = Array.from({ length: 130 }, (_, index) => 100 + index * 0.08 + Math.sin(index / 4) * 5);
  const source = bars(closes);
  const six = analyzeBars(source, "6m"), year = analyzeBars(source, "1y"), all = analyzeBars(source, "all");
  assert.deepEqual(six.histogramSlope, year.histogramSlope);
  assert.deepEqual(six.histogramSlope, all.histogramSlope);
  assert.deepEqual(six.zeroLine, all.zeroLine);
  assert.deepEqual(six.crossover, all.crossover);
});

test("universe keeps Trading Desk tickers that do not yet have bars", () => {
  const rows = analyzeUniverse(["AMD", "MOD"], { tickers: { AMD: { bars_d: bars(Array.from({ length: 40 }, (_, i) => 100 + i)) } } });
  assert.equal(rows.length, 2);
  assert.ok(rows[0].result);
  assert.equal(rows[1].result, null);
});

test("one sync freezes all four periods into a reusable snapshot", () => {
  const source = { updated_at: "2026-09-23T20:00:00Z", tickers: { AMD: { bars_d: bars(Array.from({ length: 130 }, (_, i) => 100 + i + Math.sin(i))) } } };
  const snapshot = buildSnapshot(["AMD", "MOD"], source, "2026-09-25T12:00:00Z");
  assert.equal(snapshot.generated_at, "2026-09-25T12:00:00Z");
  assert.deepEqual(Object.keys(snapshot.periods), ["3m", "6m", "1y", "all"]);
  assert.equal(snapshot.periods.all.length, 2);
  assert.equal(snapshot.periods.all[1].result, null);
});
