import assert from "node:assert/strict";
import { monthlyLogStats } from "../assets/portfolio-monthly.mjs";

const stats = monthlyLogStats([
  { ym: "2026-06", value: 0.01 },
  { ym: "2026-07", value: 0.03 },
  { ym: "2026-08", value: -0.02 },
  { ym: "2026-09", value: 9 },       // current month: excluded
  { ym: "2026-10", value: 9 },       // future/invalid for this run: excluded
  { ym: "bad", value: 9 },
  { ym: "2026-05", value: null },
], "2026-09");

assert.equal(stats.n, 3);
assert.ok(Math.abs(stats.mean - (0.02 / 3)) < 1e-12);
assert.ok(Math.abs(stats.volatility - 0.025166114784235832) < 1e-12);
assert.deepEqual(monthlyLogStats([{ ym: "2026-08", value: 0.1 }], "2026-09"), {
  n: 1, mean: 0.1, volatility: null,
});
assert.deepEqual(monthlyLogStats([{ ym: "2026-09", value: 0.1 }], "2026-09"), {
  n: 0, mean: null, volatility: null,
});

console.log("PASS portfolio monthly log-return stats");
