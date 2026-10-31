import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decomposeFiveFactor, referenceMultipleForRows } from "../assets/five-factor.mjs";

const row = {
  status: "ok",
  prior: { revenue: 100, operating_income: 10, net_income: 8, diluted_shares: 10, price: 16 },
  current: { revenue: 120, operating_income: 18, net_income: 12, diluted_shares: 8, price: 45,
    filed: "2026-10-20", post_report_price: { value: 30, report_date: "2026-10-20", dates: ["2026-10-22", "2026-10-23", "2026-10-26"] } },
};
const result = decomposeFiveFactor(row);
assert.ok(Math.abs(result.epsChange - 0.7) < 1e-12);
assert.ok(result.epsContributions.revenue > 0);
assert.ok(result.epsContributions.margin > 0);
assert.ok(result.epsContributions.below < 0);
assert.ok(result.epsContributions.shares > 0);
assert.ok(Math.abs(Object.values(result.epsContributions).reduce((sum, value) => sum + value, 0) - result.epsChange) < 1e-12);
assert.ok(Math.abs(Object.values(result.returnContributions).reduce((sum, value) => sum + value, 0) - result.priceReturn) < 1e-12);
assert.equal(result.valuationComponents.hasReportAnchor, true);
assert.ok(Math.abs(result.valuationComponents.throughReport + result.valuationComponents.postReportDrift
  - result.priceContributions.valuation) < 1e-12);
assert.equal(result.valuationComponents.postReportDrift, 15);
assert.ok(Math.abs(result.checkError) < 1e-12);

const loss = decomposeFiveFactor({ ...row, current: { ...row.current, operating_income: -2, net_income: -3 } });
assert.ok(loss);
assert.ok(Object.values(loss.returnContributions).every(Number.isFinite));
assert.ok(Math.abs(Object.values(loss.returnContributions).reduce((sum, value) => sum + value, 0) - loss.priceReturn) < 1e-12);
assert.equal(decomposeFiveFactor({ status: "unavailable" }), null);

const highMultiple = { ...row, prior: { ...row.prior, price: 80 } };
assert.equal(referenceMultipleForRows([row, highMultiple]), 30);

const data = JSON.parse(readFileSync(new URL("../data/five_factor.json", import.meta.url)));
const tickerConfig = JSON.parse(readFileSync(new URL("../config/tickers.json", import.meta.url)));
const expectedTickers = tickerConfig.watchlist;
for (const period of ["1y", "3y", "5y"]) {
  const rows = data.periods[period];
  assert.deepEqual(rows.map((item) => item.ticker), expectedTickers, `${period} ticker coverage/order mismatch`);
  for (const item of rows.filter((candidate) => candidate.status === "ok")) {
    const referenceMultiple = referenceMultipleForRows(rows);
    const decomposition = decomposeFiveFactor(item, referenceMultiple);
    assert.ok(decomposition, `${period} ${item.ticker} failed to decompose`);
    assert.ok(Math.abs(decomposition.checkError) < 1e-9, `${period} ${item.ticker} identity error`);
    assert.ok(Math.abs(Object.values(decomposition.returnContributions).reduce((sum, value) => sum + value, 0) - decomposition.priceReturn) < 1e-9,
      `${period} ${item.ticker} return attribution error`);
    for (const snapshot of [item.prior, item.current]) {
      assert.ok(snapshot.revenue > 0, `${period} ${item.ticker} has nonpositive revenue`);
      assert.ok(snapshot.diluted_shares > 0, `${period} ${item.ticker} has nonpositive shares`);
      assert.ok(snapshot.price > 0, `${period} ${item.ticker} has nonpositive price`);
    }
    assert.notEqual(item.prior.ttm_end, item.current.ttm_end, `${period} ${item.ticker} reused one TTM snapshot`);
    assert.ok(item.prior.ttm_end < item.current.ttm_end, `${period} ${item.ticker} has reversed TTM snapshots`);
  }
}
console.log("PASS: Shapley EPS bridge, split valuation residual, unavailable and loss-state handling");
