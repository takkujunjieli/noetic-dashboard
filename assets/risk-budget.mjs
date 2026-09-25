// Shared, DOM-free calculations. Stop risk is an estimate, not a maximum-loss bound.
export const positiveNum = v => v !== '' && v != null && Number.isFinite(+v) && +v > 0;
export const finiteNum = v => v !== '' && v != null && Number.isFinite(+v);
export function calculateManualSizing({ equity, riskPct, entry, stop, maxPositionPct = '' }) {
  if (!positiveNum(equity) || !positiveNum(riskPct) || !positiveNum(entry) || !finiteNum(stop)) return { error: '账户净值、单笔风险%、买入价和止损价均须有效' };
  const perShare = +entry - +stop;
  if (+stop < 0 || !(perShare > 0)) return { error: '止损价须低于买入价且不得为负' };
  const budget = +equity * +riskPct / 100;
  const derivedMaxPositionPct = +riskPct * +entry / perShare;
  const cap = positiveNum(maxPositionPct) ? +maxPositionPct : derivedMaxPositionPct;
  let shares = Math.floor(budget / perShare), capped = false;
  if (shares * +entry / +equity * 100 > cap) {
    shares = Math.floor(+equity * cap / 100 / +entry);
    capped = true;
  }
  const positionValue = shares * +entry;
  const positionPct = positionValue / +equity * 100;
  const actualRisk = shares * perShare;
  return { budget, perShare, shares, positionValue, positionPct, actualRisk, derivedMaxPositionPct, cap, capped };
}
export function calculateSizing({ equity, entry, stop: manualStop, atr, mode = 'manual', side = 'long', ...b }) {
  const riskPct = positiveNum(b.risk_pct) ? +b.risk_pct : null;
  const mult = positiveNum(b.atr_mult) ? +b.atr_mult : null;
  if (riskPct == null || mult == null || !positiveNum(b.total_risk_pct)) return { error: '先填写单笔风险%、总风险%、ATR倍数（均须大于 0）' };
  if (!positiveNum(equity) || !positiveNum(entry)) return { error: '账户净值和参考价格须大于 0' };
  if (!['long', 'short'].includes(side) || !['manual', 'atr'].includes(mode)) return { error: '方向或止损方法无效' };
  if (mode === 'atr' && !positiveNum(atr)) return { error: 'ATR 须大于 0' };
  const stop = mode === 'atr' ? +entry + (side === 'short' ? 1 : -1) * mult * +atr : (finiteNum(manualStop) ? +manualStop : NaN);
  const perShare = side === 'short' ? stop - +entry : +entry - stop;
  if (!Number.isFinite(stop) || stop < 0 || !(perShare > 0)) return { error: side === 'short' ? '止损须高于卖空价' : '止损须在买入价下方且非负' };
  const budget = +equity * riskPct / 100, derivedMaxPos = riskPct * +entry / perShare;
  const maxPos = positiveNum(b.max_position_pct) ? +b.max_position_pct : derivedMaxPos;
  let shares = Math.floor(budget / perShare), capped = false;
  if (shares * +entry / +equity * 100 > maxPos) { shares = Math.floor(+equity * maxPos / 100 / +entry); capped = true; }
  const posDollar = shares * +entry, posPct = posDollar / +equity * 100, actualRisk = shares * perShare;
  return { stop, perShare, budget, shares, posDollar, posPct, actualRisk, derivedMaxPos, maxPos, capped,
    totalBudget: +equity * +b.total_risk_pct / 100,
    totalPositionPct: positiveNum(b.total_position_pct) ? +b.total_position_pct : maxPos * +b.total_risk_pct / riskPct };
}
export function mergePolicy(file = {}, local = {}) {
  return { ...file, ...local, bundles: local.bundles || file.bundles || {}, assignments: file.assignments || {} };
}
export function readStored(storage, key, fallback) {
  const raw = storage.getItem(key);
  return raw == null ? fallback : JSON.parse(raw);
}
// Preserve all legacy bundles and fields. Only the explicit shared account field changes.
export function saveAccountField(storage, field, value) {
  if (!positiveNum(value)) throw Error('账户净值与总风险上限须大于 0');
  if (field === 'equity') {
    const latest = readStored(storage, 'riskPolicy', {});
    storage.setItem('riskPolicy', JSON.stringify({ ...latest, account_equity: +value }));
  } else if (field === 'maxHeat') storage.setItem('riskMaxHeat', JSON.stringify(+value));
  else throw Error('未知账户字段');
  storage.setItem('riskPolicyDirty', 'true');
}
export const emptySizing = () => ({ risk_pct: '', total_risk_pct: '', atr_mult: '', max_position_pct: '', total_position_pct: '', entry: '', stop: '', atr: '', mode: 'manual', side: 'long', template: '', optionRisk: '' });
export function estimatePositionRisk({ position: p, atr, bundle = {}, stop: override, price = p.price }) {
  const stop = finiteNum(override) ? +override : positiveNum(atr) && finiteNum(price) && positiveNum(bundle.atr_mult)
    ? +price + (+p.qty > 0 ? -1 : 1) * +bundle.atr_mult * +atr : null;
  if (p.kind !== 'equity') return { risk: finiteNum(p.mkt_value) ? Math.abs(+p.mkt_value) : null, proxy: true, stop };
  const distance = stop != null && finiteNum(price) ? (+p.qty > 0 ? +price - stop : stop - +price) : null;
  return { stop, risk: distance == null ? null : Math.abs(+p.qty) * Math.max(0, distance), proxy: false };
}
export function accountContext({ policy, portfolio, atr = {}, groups = {}, stops = {}, maxHeat }) {
  const equity = positiveNum(policy.account_equity) ? +policy.account_equity : null;
  const assignments = { ...(policy.assignments || {}), ...groups }, bundles = policy.bundles || {};
  const fallback = bundles[policy.default_bundle] || bundles[Object.keys(bundles)[0]] || {};
  const ignored = new Set((portfolio?.accounts || []).filter(a => /agentic/i.test(a.label || a.name || a.nickname || '')).map(a => a.id));
  let knownRisk = 0, unknown = 0, optionProxies = 0, count = 0;
  const available = Array.isArray(portfolio?.positions);
  for (const p of portfolio?.positions || []) {
    if (ignored.has(p.account) || !+p.qty || (p.kind === 'equity' && Math.abs(+p.qty) <= 1)) continue;
    count++;
    const r = estimatePositionRisk({ position: p, atr: atr[p.sym], bundle: bundles[assignments[p.sym]] || fallback, stop: stops[p.sym] });
    if (r.risk == null) unknown++; else knownRisk += r.risk;
    if (r.proxy) optionProxies++;
  }
  const heat = positiveNum(maxHeat) ? +maxHeat : null;
  return { equity, maxHeat: heat, budget: equity != null && heat != null ? equity * heat / 100 : null,
    used: available && !unknown ? knownRisk : null, knownRisk, unknown, optionProxies, count,
    scope: '全部可用账户 · 沿用原热力图过滤口径', sourceAt: portfolio?.source_updated_at || '', builtAt: portfolio?.updated_at || '',
    atrAt: atr.__updated_at || '', available };
}
export function candidateRisk(sizing, legs) {
  if(new Set(legs.map(l=>l.underlying||'')).size>1)return {risk:null,error:'多标的结构需要分别配置风险参数，当前单标的仓位计算不适用'};
  const stock = legs.filter(l => l.type === 'stock');
  const hasOptions = legs.some(l => l.type !== 'stock');
  if (!legs.length) return { risk: null, error: '组合尚无候选持仓' };
  let stockRisk = 0;
  for (const l of stock) {
    const result = calculateSizing({ ...sizing, entry: l.entry, side: l.side });
    if (result.error) return { risk: null, error: result.error };
    stockRisk += result.perShare * +l.qty;
  }
  if (hasOptions && (!finiteNum(sizing.optionRisk) || +sizing.optionRisk < 0)) return { risk: null, error: '期权组合需手工填写管理情景损失，不能用到期最大损失代替' };
  return { risk: stockRisk + (hasOptions ? +sizing.optionRisk : 0), stockRisk, hasOptions };
}
export function accountFingerprint(context) { return JSON.stringify(context); }
export function allocationIssues(sizing, context, legs) {
  const calc = calculateSizing({ ...sizing, equity: context?.equity });
  const candidate = candidateRisk({ ...sizing, equity: context?.equity }, legs);
  const issues = [];
  if (calc.error) issues.push(calc.error);
  if (candidate.error) issues.push(candidate.error);
  if (context?.used == null || context?.budget == null) issues.push('账户已用风险或总预算不完整');
  if (candidate.risk != null && context?.used != null && context?.budget != null && context.used + candidate.risk > context.budget) issues.push('增量方案超过账户剩余止损风险预算');
  if (candidate.risk != null && calc.totalBudget != null && candidate.risk > calc.totalBudget) issues.push('候选方案超过本实例总风险预算');
  if (candidate.risk != null && calc.budget != null && candidate.risk > calc.budget) issues.push('候选方案超过本实例单笔风险预算');
  const gross = legs.reduce((s,l) => s + +l.qty * +l.entry * (l.type === 'stock' ? 1 : 100), 0);
  if (calc.totalPositionPct != null && positiveNum(context?.equity) && gross / context.equity * 100 > calc.totalPositionPct) issues.push('候选方案超过本实例总仓位上限（成本毛额口径）');
  if (positiveNum(sizing.max_position_pct) && positiveNum(context?.equity) && gross / context.equity * 100 > +sizing.max_position_pct) issues.push('候选方案超过手工单笔仓位上限（成本毛额口径）');
  return [...new Set(issues)];
}
