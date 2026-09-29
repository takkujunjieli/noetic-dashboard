const ratio = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
  ? numerator / denominator : null;

export function decomposeFiveFactor(row) {
  if (!row || row.status !== "ok" || !row.current || !row.prior) return null;
  const current = row.current, prior = row.prior;
  const currentMargin = ratio(current.operating_income, current.revenue);
  const priorMargin = ratio(prior.operating_income, prior.revenue);
  const currentConversion = ratio(current.net_income, current.operating_income);
  const priorConversion = ratio(prior.net_income, prior.operating_income);
  const currentEps = ratio(current.net_income, current.diluted_shares);
  const priorEps = ratio(prior.net_income, prior.diluted_shares);
  const currentPe = ratio(current.price, currentEps);
  const priorPe = ratio(prior.price, priorEps);
  const factors = {
    revenue: ratio(current.revenue, prior.revenue),
    margin: ratio(currentMargin, priorMargin),
    conversion: ratio(currentConversion, priorConversion),
    buyback: ratio(prior.diluted_shares, current.diluted_shares),
    multiple: ratio(currentPe, priorPe),
  };
  const values = Object.values(factors);
  const product = values.every(Number.isFinite) ? values.reduce((result, value) => result * value, 1) : null;
  const priceRatio = ratio(current.price, prior.price);
  const checkError = Number.isFinite(product) && Number.isFinite(priceRatio) && priceRatio !== 0 ? product / priceRatio - 1 : null;
  const unstable = [];
  if (current.operating_income <= 0 || prior.operating_income <= 0) unstable.push("operating income 非正，Margin/Conversion 倍数仅具代数意义");
  if (current.net_income <= 0 || prior.net_income <= 0) unstable.push("net income 非正，Conversion/PE 倍数不具常规估值意义");
  return {
    factors, product, priceRatio, checkError, unstable,
    raw: {
      revenue: { prior: prior.revenue, current: current.revenue },
      margin: { prior: priorMargin, current: currentMargin },
      conversion: { prior: priorConversion, current: currentConversion },
      buyback: { prior: prior.diluted_shares, current: current.diluted_shares },
      multiple: { prior: priorPe, current: currentPe },
    },
  };
}
