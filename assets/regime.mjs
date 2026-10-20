export const REGIME_DIMENSIONS = [
  "Trend", "Volatility", "Dispersion", "Correlation", "Liquidity", "Positioning", "Participation",
];

export const defaultRegimeValues = () => Object.fromEntries(REGIME_DIMENSIONS.map((name) => [name, 5]));

const dateString = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export function regimeFriday(value) {
  const weekMatch = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value || "");
  if (weekMatch) {
    const year = Number(weekMatch[1]), week = Number(weekMatch[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
    monday.setUTCDate(monday.getUTCDate() + 4);
    return dateString(monday);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + ({ 0: -2, 1: 4, 2: 3, 3: 2, 4: 1, 5: 0, 6: -1 })[date.getUTCDay()]);
  return dateString(date);
}

export function isRegimeFriday(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && regimeFriday(value) === value;
}

export function normalizeRegimeValues(values) {
  const fallback = defaultRegimeValues();
  return Object.fromEntries(REGIME_DIMENSIONS.map((name) => {
    const value = Number(values && values[name]);
    return [name, Number.isFinite(value) ? Math.max(1, Math.min(10, Math.round(value))) : fallback[name]];
  }));
}

export function normalizeRegimeStore(store) {
  const snapshots = {};
  for (const [date, snapshot] of Object.entries(store?.snapshots || {})) {
    const friday = regimeFriday(date);
    if (!friday) continue;
    const normalized = {
      values: normalizeRegimeValues(snapshot?.values),
      saved_at: typeof snapshot?.saved_at === "string" ? snapshot.saved_at : `${friday}T00:00:00Z`,
    };
    if (!snapshots[friday] || normalized.saved_at >= snapshots[friday].saved_at) snapshots[friday] = normalized;
  }
  return { version: 2, updated_at: store?.updated_at || null, snapshots };
}

export function mergeRegimeStores(...stores) {
  const merged = normalizeRegimeStore(null);
  for (const source of stores) {
    const store = normalizeRegimeStore(source);
    for (const [date, snapshot] of Object.entries(store.snapshots)) {
      if (!merged.snapshots[date] || snapshot.saved_at >= merged.snapshots[date].saved_at) merged.snapshots[date] = snapshot;
    }
    if (store.updated_at && (!merged.updated_at || store.updated_at > merged.updated_at)) merged.updated_at = store.updated_at;
  }
  return merged;
}

export function latestRegimeSnapshotBefore(store, date) {
  if (!isRegimeFriday(date)) return null;
  const normalized = normalizeRegimeStore(store);
  const anchorDate = Object.keys(normalized.snapshots)
    .filter((snapshotDate) => snapshotDate < date)
    .sort()
    .at(-1);
  if (!anchorDate) return null;
  return { date: anchorDate, values: { ...normalized.snapshots[anchorDate].values } };
}

export function saveRegimeSnapshot(store, date, values, savedAt = new Date().toISOString()) {
  const next = mergeRegimeStores(store);
  if (!isRegimeFriday(date)) return next;
  next.snapshots[date] = { values: normalizeRegimeValues(values), saved_at: savedAt };
  next.updated_at = savedAt;
  return next;
}

export function radarPoint(index, value, center = 250, radius = 180) {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / REGIME_DIMENSIONS.length;
  const distance = radius * Math.max(1, Math.min(10, Number(value))) / 10;
  return { x: center + Math.cos(angle) * distance, y: center + Math.sin(angle) * distance };
}

export function radarValueFromPoint(index, x, y, center = 250, radius = 180) {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / REGIME_DIMENSIONS.length;
  const projection = (x - center) * Math.cos(angle) + (y - center) * Math.sin(angle);
  return Math.max(1, Math.min(10, Math.round(projection / radius * 10)));
}
