export function monthlyLogStats(rows, currentYm) {
  const samples = rows
    .filter((row) => /^\d{4}-\d{2}$/.test(row?.ym || "") && row.ym < currentYm)
    .filter((row) => row.value != null && row.value !== "")
    .map((row) => Number(row.value))
    .filter(Number.isFinite);
  if (!samples.length) return { n: 0, mean: null, volatility: null };
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.length < 2
    ? null
    : samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1);
  return {
    n: samples.length,
    mean,
    volatility: variance == null ? null : Math.sqrt(variance),
  };
}
