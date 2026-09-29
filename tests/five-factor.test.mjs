import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decomposeFiveFactor } from "../assets/five-factor.mjs";

const row = {
  status: "ok",
  prior: { revenue: 100, operating_income: 10, net_income: 8, diluted_shares: 10, price: 16 },
  current: { revenue: 120, operating_income: 18, net_income: 12, diluted_shares: 8, price: 45 },
};
const result = decomposeFiveFactor(row);
const expected = { revenue: 1.2, margin: 1.5, conversion: 5 / 6, buyback: 1.25, multiple: 1.5 };
for (const [key, value] of Object.entries(expected)) {
  assert.ok(Math.abs(result.factors[key] - value) < 1e-12, `${key} factor mismatch`);
}
assert.ok(Math.abs(result.product - 2.8125) < 1e-12);
assert.ok(Math.abs(result.product - result.priceRatio) < 1e-12);
assert.ok(Math.abs(result.checkError) < 1e-12);
assert.deepEqual(result.unstable, []);

const loss = decomposeFiveFactor({ ...row, current: { ...row.current, operating_income: -2, net_income: -3 } });
assert.equal(loss.unstable.length, 2);
assert.equal(decomposeFiveFactor({ status: "unavailable" }), null);

const data = JSON.parse(readFileSync(new URL("../data/five_factor.json", import.meta.url)));
const tickerConfig = JSON.parse(readFileSync(new URL("../config/tickers.json", import.meta.url)));
const expectedTickers = tickerConfig.watchlist;
for (const period of ["1y", "3y", "5y"]) {
  const rows = data.periods[period];
  assert.deepEqual(rows.map((item) => item.ticker), expectedTickers, `${period} ticker coverage/order mismatch`);
  for (const item of rows.filter((candidate) => candidate.status === "ok")) {
    const decomposition = decomposeFiveFactor(item);
    assert.ok(decomposition, `${period} ${item.ticker} failed to decompose`);
    assert.ok(Math.abs(decomposition.checkError) < 1e-9, `${period} ${item.ticker} identity error`);
    for (const snapshot of [item.prior, item.current]) {
      assert.ok(snapshot.revenue > 0, `${period} ${item.ticker} has nonpositive revenue`);
      assert.ok(snapshot.diluted_shares > 0, `${period} ${item.ticker} has nonpositive shares`);
      assert.ok(snapshot.price > 0, `${period} ${item.ticker} has nonpositive price`);
    }
    assert.notEqual(item.prior.ttm_end, item.current.ttm_end, `${period} ${item.ticker} reused one TTM snapshot`);
    assert.ok(item.prior.ttm_end < item.current.ttm_end, `${period} ${item.ticker} has reversed TTM snapshots`);
  }
}
console.log("PASS: five-factor ratios, raw identity, unavailable and loss-state handling");
