const ratio = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
  ? numerator / denominator : null;

const VARIABLE_KEYS = ["revenue", "margin", "below", "shares"];

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
    .map((tail) => [value, ...tail]));
}

const VARIABLE_ORDERS = permutations(VARIABLE_KEYS);

function stateFromSnapshot(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.revenue) || snapshot.revenue <= 0
    || !Number.isFinite(snapshot.diluted_shares) || snapshot.diluted_shares <= 0
    || !Number.isFinite(snapshot.operating_income) || !Number.isFinite(snapshot.net_income)) return null;
  return {
    revenue: snapshot.revenue,
    margin: snapshot.operating_income / snapshot.revenue,
    below: (snapshot.net_income - snapshot.operating_income) / snapshot.revenue,
    shares: snapshot.diluted_shares,
  };
}

const epsFromState = (state) => state.revenue / state.shares * (state.margin + state.below);

function shapleyEps(prior, current) {
  const contributions = Object.fromEntries(VARIABLE_KEYS.map((key) => [key, 0]));
  for (const order of VARIABLE_ORDERS) {
    const state = { ...prior };
    for (const key of order) {
      const before = epsFromState(state);
      state[key] = current[key];
      contributions[key] += epsFromState(state) - before;
    }
  }
  for (const key of VARIABLE_KEYS) contributions[key] /= VARIABLE_ORDERS.length;
  return contributions;
}

function positivePe(snapshot) {
  const eps = ratio(snapshot?.net_income, snapshot?.diluted_shares);
  return eps > 0 && snapshot?.price > 0 ? snapshot.price / eps : null;
}

export function referenceMultipleForRows(rows, fallback = 20) {
  const values = rows
    .filter((row) => row?.status === "ok" && row.prior)
    .map((row) => positivePe(row.prior))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.max(10, Math.min(40, value)))
    .sort((a, b) => a - b);
  if (!values.length) return fallback;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function decomposeFiveFactor(row, referenceMultiple = 20) {
  if (!row || row.status !== "ok" || !row.current || !row.prior
    || !Number.isFinite(referenceMultiple) || referenceMultiple <= 0) return null;
  const current = row.current, prior = row.prior;
  const currentState = stateFromSnapshot(current), priorState = stateFromSnapshot(prior);
  if (!currentState || !priorState || !Number.isFinite(current.price) || !Number.isFinite(prior.price) || prior.price <= 0) return null;

  const epsContributions = shapleyEps(priorState, currentState);
  const priorEps = epsFromState(priorState), currentEps = epsFromState(currentState);
  const epsChange = currentEps - priorEps;
  const priceChange = current.price - prior.price;
  const priceContributions = Object.fromEntries(VARIABLE_KEYS.map((key) => [key, epsContributions[key] * referenceMultiple]));
  const fundamentalPriceChange = Object.values(priceContributions).reduce((sum, value) => sum + value, 0);
  const reportAnchor = current.post_report_price;
  const reportPrice = Number.isFinite(reportAnchor?.value) ? reportAnchor.value : current.price;
  const valuationComponents = {
    throughReport: reportPrice - prior.price - fundamentalPriceChange,
    postReportDrift: current.price - reportPrice,
    hasReportAnchor: Number.isFinite(reportAnchor?.value),
    reportPrice,
    reportDate: reportAnchor?.report_date || current.filed || null,
    priceDates: Array.isArray(reportAnchor?.dates) ? [...reportAnchor.dates] : [],
  };
  priceContributions.valuation = valuationComponents.throughReport + valuationComponents.postReportDrift;
  const returnContributions = Object.fromEntries(Object.entries(priceContributions)
    .map(([key, value]) => [key, value / prior.price]));
  const attributedPriceChange = Object.values(priceContributions).reduce((sum, value) => sum + value, 0);

  return {
    referenceMultiple,
    priceRatio: current.price / prior.price,
    priceReturn: priceChange / prior.price,
    priceChange,
    epsChange,
    epsContributions,
    priceContributions,
    returnContributions,
    valuationComponents: {
      ...valuationComponents,
      throughReportReturn: valuationComponents.throughReport / prior.price,
      postReportDriftReturn: valuationComponents.postReportDrift / prior.price,
    },
    checkError: attributedPriceChange - priceChange,
    raw: {
      revenue: { prior: priorState.revenue, current: currentState.revenue },
      margin: { prior: priorState.margin, current: currentState.margin },
      below: { prior: priorState.below, current: currentState.below },
      buyback: { prior: priorState.shares, current: currentState.shares },
      valuation: { prior: positivePe(prior), current: positivePe(current) },
      eps: { prior: priorEps, current: currentEps },
    },
  };
}
