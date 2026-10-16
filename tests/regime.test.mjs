import test from "node:test";
import assert from "node:assert/strict";
import { REGIME_DIMENSIONS, defaultRegimeValues, isRegimeFriday, mergeRegimeStores, radarPoint, radarValueFromPoint, regimeFriday, saveRegimeSnapshot } from "../assets/regime.mjs";

test("regime defaults all seven dimensions to five", () => {
  const values = defaultRegimeValues();
  assert.equal(Object.keys(values).length, 7);
  assert.deepEqual(Object.values(values), new Array(7).fill(5));
});

test("drag projection maps each axis to integer values from one to ten", () => {
  for (let index = 0; index < REGIME_DIMENSIONS.length; index++) {
    for (const value of [1, 5, 10]) {
      const point = radarPoint(index, value);
      assert.equal(radarValueFromPoint(index, point.x, point.y), value);
    }
  }
});

test("snapshots save by Friday date and newer copies win during merge", () => {
  const first = saveRegimeSnapshot(null, "2026-10-09", { Trend: 8 }, "2026-10-10T12:00:00Z");
  const second = saveRegimeSnapshot(null, "2026-10-09", { Trend: 3 }, "2026-10-10T13:00:00Z");
  const merged = mergeRegimeStores(first, second);
  assert.equal(merged.snapshots["2026-10-09"].values.Trend, 3);
  assert.equal(merged.snapshots["2026-10-09"].values.Liquidity, 5);
});

test("legacy week and daily snapshots migrate to their Friday", () => {
  assert.equal(regimeFriday("2026-W41"), "2026-10-09");
  assert.equal(regimeFriday("2026-10-11"), "2026-10-09");
  assert.equal(regimeFriday("2026-10-05"), "2026-10-09");
  assert.equal(isRegimeFriday("2026-10-09"), true);
  assert.equal(isRegimeFriday("2026-10-10"), false);
  const migrated = mergeRegimeStores({ snapshots: {
    "2026-10-05": { values: { Trend: 4 }, saved_at: "2026-10-05T12:00:00Z" },
    "2026-10-11": { values: { Trend: 9 }, saved_at: "2026-10-11T12:00:00Z" },
  } });
  assert.deepEqual(Object.keys(migrated.snapshots), ["2026-10-09"]);
  assert.equal(migrated.snapshots["2026-10-09"].values.Trend, 9);
});
