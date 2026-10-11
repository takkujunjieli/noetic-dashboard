const SIDE_KIND = new Map([
  ['buy', 'buy'], ['buy_back', 'buy'], ['buy_to_cover', 'buy'], ['buy_to_close', 'buy'],
  ['sell', 'sell'], ['sell_short', 'sell'], ['sell_to_open', 'sell'], ['sell_to_close', 'sell'],
]);

export function fillMarkerKind(fill) {
  if (fill?.kind === 'option') return 'option';
  return SIDE_KIND.get(String(fill?.side || '').toLowerCase()) || null;
}

export function dedupeTradeFills(fills) {
  const rows = Array.isArray(fills) ? fills : [];
  const groups = new Map();
  for (const fill of rows) {
    const key = [fill?.broker, fill?.account, fill?.timestamp, fill?.symbol,
      fill?.kind, fill?.side, fill?.price].join('\u0000');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fill);
  }
  return [...groups.values()].flatMap(group => {
    const executions = group.filter(fill => fill?.identity_quality === 'broker_execution' || fill?.execution_id);
    const fingerprints = group.filter(fill => !executions.includes(fill));
    if (!executions.length || !fingerprints.length) return group;
    const executedQty = executions.reduce((sum, fill) => sum + Math.abs(Number(fill?.qty) || 0), 0);
    const shadow = fingerprints.find(fill => Math.abs(Math.abs(Number(fill?.qty) || 0) - executedQty) < 1e-9);
    return shadow ? group.filter(fill => fill !== shadow) : group;
  });
}

export function groupTradeFills({ fills, bars, tf, dayOf, sessionDayOf = dayOf }) {
  if (!Array.isArray(fills) || !Array.isArray(bars) || !bars.length) return [];
  const daily = tf === '1d';
  const barDays = daily ? bars.map(bar => ({ day: dayOf(bar[0]), ms: bar[0] })) : null;
  const width = tf === '1m' ? 60_000 : tf === '5m' ? 300_000 : 900_000;
  const groups = new Map();
  for (const fill of fills) {
    const ms = Date.parse(fill.timestamp), kind = fillMarkerKind(fill);
    if (!Number.isFinite(ms) || !kind) continue;
    let barMs;
    if (daily) {
      const sessionDay = sessionDayOf(ms);
      if (sessionDay < barDays[0].day) continue;
      const match = barDays.find(bar => bar.day >= sessionDay);
      if (!match) continue;
      barMs = match.ms;
    } else {
      // Map executions in a hidden overnight/weekend gap to the first visible bar
      // after them. This keeps marker changes aligned with the position series.
      let lo = 0, hi = bars.length - 1, found = bars.length;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] + width > ms) { found = mid; hi = mid - 1; } else lo = mid + 1; }
      if (found >= bars.length || (found === 0 && ms < bars[0][0])) continue;
      barMs = bars[found][0];
    }
    const key = `${barMs}:${kind}`;
    if (!groups.has(key)) groups.set(key, { key, barMs, kind, fills: [] });
    groups.get(key).fills.push(fill);
  }
  return [...groups.values()].map(group => {
    const priced = group.fills.filter(fill => Number.isFinite(Number(fill.price)) && Number(fill.qty) > 0);
    const totalQty = priced.reduce((sum, fill) => sum + Math.abs(Number(fill.qty)), 0);
    const averagePrice = totalQty ? priced.reduce((sum, fill) => sum + Math.abs(Number(fill.qty)) * Number(fill.price), 0) / totalQty : null;
    return { ...group, averagePrice, tradeIds: [...new Set(group.fills.map(fill => fill.trade_id))] };
  }).sort((a, b) => a.barMs - b.barMs || ['buy', 'sell', 'option'].indexOf(a.kind) - ['buy', 'sell', 'option'].indexOf(b.kind));
}

export function aggregateTradeDetails(fills, dayOf) {
  const groups = new Map();
  for (const fill of fills || []) {
    const account = fill.account || '未知账户';
    const broker = fill.broker || '未知券商';
    const instrument = fill.kind === 'option'
      ? `${fill.instrument?.expiry || '?'} ${fill.instrument?.strike ?? '?'}${fill.instrument?.right || ''}`
      : '';
    const key = [broker, account, instrument].join('\u0000');
    if (!groups.has(key)) groups.set(key, { broker, account, instrument, fills: [], sides: new Set(), tradeIds: new Set() });
    const group = groups.get(key);
    group.fills.push(fill);
    group.sides.add(fill.side || 'unknown');
    if (fill.trade_id) group.tradeIds.add(fill.trade_id);
  }
  return [...groups.values()].map(group => {
    const priced = group.fills.filter(fill => Number.isFinite(Number(fill.price)) && Number.isFinite(Number(fill.qty)));
    const qty = priced.reduce((sum, fill) => sum + Math.abs(Number(fill.qty)), 0);
    const averagePrice = qty
      ? priced.reduce((sum, fill) => sum + Math.abs(Number(fill.qty)) * Number(fill.price), 0) / qty
      : null;
    const dates = [...new Set(group.fills.map(fill => dayOf(Date.parse(fill.timestamp))))].sort();
    return { ...group, sides: [...group.sides], tradeIds: [...group.tradeIds], qty, averagePrice, dates };
  }).sort((a, b) => a.account.localeCompare(b.account) || a.instrument.localeCompare(b.instrument));
}

export function equityPositionDelta(fill) {
  if (fill?.kind !== 'equity') return 0;
  const qty = Math.abs(Number(fill.qty));
  if (!Number.isFinite(qty)) return 0;
  const side = String(fill.side || '').toLowerCase();
  if (['buy', 'buy_back', 'buy_to_cover', 'buy_to_close'].includes(side)) return qty;
  if (['sell', 'sell_short', 'sell_to_open', 'sell_to_close'].includes(side)) return -qty;
  return 0;
}

export function equityPositionsAtBars({ fills, bars, daily, dayOf, sessionDayOf = dayOf, barWidth,
  endingPosition, anchorMs }) {
  const ordered = dedupeTradeFills(fills).map(fill => ({ fill, ms: Date.parse(fill.timestamp) }))
    .filter(item => Number.isFinite(item.ms)).sort((a, b) => a.ms - b.ms);
  const anchored = Number.isFinite(Number(endingPosition)) && Number.isFinite(Number(anchorMs));
  let position = anchored
    ? Number(endingPosition) - ordered.reduce((sum, item) => item.ms <= Number(anchorMs) ? sum + equityPositionDelta(item.fill) : sum, 0)
    : 0;
  let index = 0;
  return (bars || []).map(bar => {
    if (daily) {
      const day = dayOf(bar[0]);
      while (index < ordered.length && sessionDayOf(ordered[index].ms) <= day) position += equityPositionDelta(ordered[index++].fill);
    } else {
      const cutoff = bar[0] + barWidth;
      while (index < ordered.length && ordered[index].ms < cutoff) position += equityPositionDelta(ordered[index++].fill);
    }
    return position;
  });
}

const legSign = side => ['buy', 'buy_back', 'buy_to_cover', 'buy_to_close'].includes(String(side || '').toLowerCase()) ? '+' : '−';
export function optionMarkerText(group) {
  if (!group?.fills?.length) return 'O';
  if (group.tradeIds.length !== 1) return `O ×${group.tradeIds.length}`;
  const legs = group.fills.filter(fill => fill.instrument?.contract_details_complete);
  if (!legs.length) return 'O';
  const expiries = new Set(legs.map(fill => fill.instrument.expiry));
  const expiry = expiries.size === 1 ? legs[0].instrument.expiry.slice(5).replace('-', '') + ' ' : '';
  const description = legs
    .slice().sort((a, b) => Number(a.instrument.strike) - Number(b.instrument.strike))
    .map(fill => `${legSign(fill.side)}${fill.instrument.strike}${fill.instrument.right}`).join('/');
  return `O ${expiry}${description}`;
}
