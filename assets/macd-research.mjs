/* Research / MACD return study. Pure functions live here so the signal and
   return conventions can be tested independently from the DOM. */

export function ema(values, length) {
  const k = 2 / (length + 1);
  let previous = null;
  return values.map((value, index) => {
    previous = previous == null ? value : value * k + previous * (1 - k);
    return index < length - 1 ? null : previous;
  });
}

export function macd(values, fast = 12, slow = 26, signalLength = 9) {
  const fastEma = ema(values, fast), slowEma = ema(values, slow);
  const main = fastEma.map((value, index) => value == null || slowEma[index] == null ? null : value - slowEma[index]);
  const signal = new Array(main.length).fill(null), histogram = new Array(main.length).fill(null);
  const k = 2 / (signalLength + 1);
  let previous = null, count = 0;
  for (let index = 0; index < main.length; index++) {
    if (main[index] == null) continue;
    previous = previous == null ? main[index] : main[index] * k + previous * (1 - k);
    if (++count >= signalLength) {
      signal[index] = previous;
      histogram[index] = main[index] - previous;
    }
  }
  return { main, signal, histogram };
}

const crossing = (previous, current) => {
  if (previous == null || current == null) return 0;
  if (previous <= 0 && current > 0) return 1;
  if (previous >= 0 && current < 0) return -1;
  return 0;
};

export function subtractCalendar(dateString, period) {
  if (period === "all") return null;
  const [year, month, day] = dateString.split("-").map(Number);
  const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
  const targetMonth = month - 1 - months;
  const first = new Date(Date.UTC(year, targetMonth, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

export function completePairStats(closes, values, startIndex = 0) {
  let entry = null, totalReturn = 0, trades = 0;
  for (let index = Math.max(1, startIndex); index < values.length; index++) {
    const side = crossing(values[index - 1], values[index]);
    if (side > 0 && entry == null) entry = closes[index];
    if (side < 0 && entry != null) {
      totalReturn += closes[index] / entry - 1;
      trades++;
      entry = null;
    }
  }
  return { totalReturn, trades };
}

export function analyzeBars(bars, period = "all") {
  const clean = (bars || [])
    .filter((bar) => Array.isArray(bar) && Number.isFinite(bar[0]) && Number.isFinite(bar[4]) && bar[4] > 0)
    .slice().sort((a, b) => a[0] - b[0]);
  if (!clean.length) return null;
  const dates = clean.map((bar) => new Date(bar[0]).toISOString().slice(0, 10));
  const closes = clean.map((bar) => bar[4]);
  const { main, signal, histogram } = macd(closes);
  const validIndex = histogram.findIndex((value) => value != null);
  if (validIndex < 0) return null;

  const cutoff = subtractCalendar(dates.at(-1), period);
  let startIndex = validIndex;
  if (cutoff) while (startIndex < dates.length && dates[startIndex] < cutoff) startIndex++;
  if (startIndex >= dates.length) return null;

  const slope = histogram.map((value, index) => index > 0 && value != null && histogram[index - 1] != null
    ? value - histogram[index - 1] : null);
  const crossover = main.map((value, index) => value == null || signal[index] == null ? null : value - signal[index]);
  return {
    latest: dates.at(-1),
    validFrom: dates[validIndex],
    rangeFrom: dates[startIndex],
    histogramSlope: completePairStats(closes, slope, startIndex),
    zeroLine: completePairStats(closes, main, startIndex),
    crossover: completePairStats(closes, crossover, startIndex),
  };
}

export function analyzeUniverse(tickers, research, period = "all") {
  const data = research && research.tickers ? research.tickers : {};
  return (tickers || []).map((ticker) => ({
    ticker,
    result: analyzeBars(data[ticker] && data[ticker].bars_d, period),
  }));
}

export function buildSnapshot(tickers, research, generatedAt = new Date().toISOString()) {
  const periods = {};
  for (const period of ["3m", "6m", "1y", "all"]) periods[period] = analyzeUniverse(tickers, research, period);
  return {
    version: 1,
    generated_at: generatedAt,
    source_updated_at: research && research.updated_at || null,
    tickers: [...(tickers || [])],
    periods,
  };
}
